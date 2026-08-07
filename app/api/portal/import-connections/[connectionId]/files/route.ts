import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireMemberDriveContext } from "@/lib/server/member-drive-context";
import { downloadProviderFile, getProviderFile, listProviderFiles, providerAccessToken } from "@/lib/server/import-provider-files";
import { intakeContractFile } from "@/lib/server/contract-import-intake";
import { processPendingContractJobs } from "@/app/api/contracts/jobs/process/route";
import type { ImportProvider } from "@/lib/server/import-connection-oauth";

async function ownedConnection(connectionId: string, userId: string) {
  const db = createServiceClient();
  const { data } = await db.from("import_connections")
    .select("id,org_id,provider,credentials_encrypted,status,rights_holder_id")
    .eq("id", connectionId).eq("connection_kind", "member").eq("owner_user_id", userId).maybeSingle();
  return data;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ connectionId: string }> }) {
  const member = await requireMemberDriveContext();
  if (!member) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const connection = await ownedConnection((await context.params).connectionId, member.userId);
  if (!connection || connection.org_id !== member.orgId || connection.status !== "connected") return NextResponse.json({ error: "Forbindelsen blev ikke fundet" }, { status: 404 });
  try {
    const root = connection.provider === "dropbox" ? "/" : "root";
    const result = await listProviderFiles({ provider: connection.provider as ImportProvider, encryptedCredentials: connection.credentials_encrypted, folderId: root, recursive: true, connectionKind: "member" });
    const files = result.files.filter(file => /\.(pdf|doc|docx)$/i.test(file.name)).slice(0, 500);
    return NextResponse.json({ files, truncated: result.files.length > 500 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Filerne kunne ikke hentes" }, { status: 502 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ connectionId: string }> }) {
  const member = await requireMemberDriveContext();
  if (!member) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const connection = await ownedConnection((await context.params).connectionId, member.userId);
  if (!connection || connection.org_id !== member.orgId || connection.status !== "connected" || connection.rights_holder_id !== member.rightsHolderId) return NextResponse.json({ error: "Forbindelsen blev ikke fundet" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { fileIds?: unknown };
  const fileIds = Array.isArray(body.fileIds) ? [...new Set(body.fileIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 1024))].slice(0, 100) : [];
  if (!fileIds.length) return NextResponse.json({ error: "Vælg mindst én kontrakt" }, { status: 400 });
  const provider = connection.provider as ImportProvider;
  const db = createServiceClient({ audit: { actorUserId: member.userId, actorOrgId: member.orgId, actorRole: "member", source: "portal", correlationId: crypto.randomUUID(), mode: "summary" } });
  const { data: batch, error: batchError } = await db.from("contract_import_batches").insert({ org_id: member.orgId, created_by: member.userId, source: provider, connection_id: connection.id, status: "processing", discovered_count: fileIds.length }).select("id").single();
  if (batchError || !batch) return NextResponse.json({ error: "Importen kunne ikke startes" }, { status: 500 });
  const token = await providerAccessToken(provider, connection.credentials_encrypted, "member");
  const results: Array<{ id: string; name?: string; status: string; error?: string }> = [];
  for (const id of fileIds) {
    try {
      const file = await getProviderFile(provider, token, id);
      const buffer = await downloadProviderFile(provider, token, file);
      const result = await intakeContractFile({ batchId: batch.id, actor: { userId: member.userId, orgId: member.orgId, role: "member" }, rightsHolderId: member.rightsHolderId, file: { name: file.name, contentType: file.contentType, buffer, clientToken: crypto.randomUUID(), providerFileId: file.id, providerRevision: file.revision } });
      results.push(result.ok ? { id, name: file.name, status: result.duplicate ? "duplicate" : "queued" } : { id, name: file.name, status: "error", error: result.error });
    } catch (error) { results.push({ id, status: "error", error: error instanceof Error ? error.message : "Filen kunne ikke importeres" }); }
  }
  if (results.some(result => result.status === "queued")) after(async () => { await processPendingContractJobs(member.orgId); });
  return NextResponse.json({ batchId: batch.id, results });
}
