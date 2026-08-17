import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireMemberDriveContext } from "@/lib/server/member-drive-context";
import { browseGoogleDrive } from "@/lib/server/import-provider-files";
import { driveImportWorkerSecret, triggerDriveImportWorker } from "@/lib/drive-import-worker";

async function ownedConnection(connectionId: string, userId: string) {
  const db = createServiceClient();
  const { data } = await db.from("import_connections")
    .select("id,org_id,provider,credentials_encrypted,status,rights_holder_id")
    .eq("id", connectionId).eq("connection_kind", "member").eq("owner_user_id", userId).maybeSingle();
  return data;
}

export async function GET(request: NextRequest, context: { params: Promise<{ connectionId: string }> }) {
  const member = await requireMemberDriveContext();
  if (!member) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const connection = await ownedConnection((await context.params).connectionId, member.userId);
  if (!connection || connection.org_id !== member.orgId || connection.status !== "connected") return NextResponse.json({ error: "Forbindelsen blev ikke fundet" }, { status: 404 });
  const runId = request.nextUrl.searchParams.get("runId");
  if (runId) {
    const db = createServiceClient();
    const { data: run } = await db.from("drive_import_runs")
      .select("id,status,discovered_count,imported_count,duplicate_count,failed_count,last_error")
      .eq("id", runId).eq("connection_id", connection.id).eq("started_by", member.userId).maybeSingle();
    if (!run) return NextResponse.json({ error: "Importjobbet blev ikke fundet" }, { status: 404 });
    return NextResponse.json({ run }, { headers: { "Cache-Control": "no-store" } });
  }
  if (connection.provider !== "google_drive") return NextResponse.json({ error: "Kun Google Drive er tilgængelig i denne version" }, { status: 409 });
  try {
    const result = await browseGoogleDrive({
      encryptedCredentials: connection.credentials_encrypted,
      connectionKind: "member",
      folderId: request.nextUrl.searchParams.get("folderId") || "root",
      pageToken: request.nextUrl.searchParams.get("cursor") || undefined,
      sharedWithMe: request.nextUrl.searchParams.get("view") === "shared",
      pageSize: 100,
    });
    const folders = result.entries.filter(entry => entry.kind === "folder");
    const files = result.entries.filter(entry => entry.kind === "file" && /\.(pdf|doc|docx)$/i.test(entry.name));
    return NextResponse.json({ folders, files, nextCursor: result.nextPageToken }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Filerne kunne ikke hentes";
    const requiresReauthorization = message.includes("godkendes igen")
    if (requiresReauthorization) {
      await createServiceClient().from("import_connections").update({ status: "reauthorization_required", last_error: "Google Drive-forbindelsen skal godkendes igen." }).eq("id", connection.id);
    }
    console.error("[member-drive-files] provider lookup failed", error instanceof Error ? error.name : "unknown")
    return NextResponse.json({ error: requiresReauthorization ? "Google Drive-forbindelsen skal godkendes igen." : "Filerne kunne ikke hentes" }, { status: 502 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ connectionId: string }> }) {
  const member = await requireMemberDriveContext();
  if (!member) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const connection = await ownedConnection((await context.params).connectionId, member.userId);
  if (!connection || connection.org_id !== member.orgId || connection.status !== "connected" || connection.rights_holder_id !== member.rightsHolderId) return NextResponse.json({ error: "Forbindelsen blev ikke fundet" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { fileIds?: unknown };
  const fileIds = Array.isArray(body.fileIds) ? [...new Set(body.fileIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 1024))].slice(0, 500) : [];
  if (!fileIds.length) return NextResponse.json({ error: "Vælg mindst én kontrakt" }, { status: 400 });
  if (connection.provider !== "google_drive") return NextResponse.json({ error: "Kun Google Drive er tilgængelig i denne version" }, { status: 409 });
  if (!driveImportWorkerSecret()) return NextResponse.json({ error: "Baggrundsimport er ikke konfigureret" }, { status: 503 });
  const db = createServiceClient({ audit: { actorUserId: member.userId, actorOrgId: member.orgId, actorRole: "member", source: "portal", correlationId: crypto.randomUUID(), mode: "summary" } });
  const { data: batch, error: batchError } = await db.from("contract_import_batches").insert({ org_id: member.orgId, created_by: member.userId, source: "google_drive", connection_id: connection.id, status: "processing", discovered_count: fileIds.length }).select("id").single();
  if (batchError || !batch) return NextResponse.json({ error: "Importen kunne ikke startes" }, { status: 500 });
  const { data: run, error: runError } = await db.from("drive_import_runs").insert({
    org_id: member.orgId, connection_id: connection.id, batch_id: batch.id,
    connection_kind: "member", started_by: member.userId, rights_holder_id: member.rightsHolderId,
    status: "queued", recursive: false, discovered_count: fileIds.length,
  }).select("id,status").single();
  if (runError || !run) return NextResponse.json({ error: "Importkøen kunne ikke oprettes" }, { status: 500 });
  const { error: queueError } = await db.from("drive_import_queue_items").insert(fileIds.map(id => ({
    run_id: run.id, provider_file_id: id, provider_revision: "selected", file_name: id, file_size_bytes: 0,
  })));
  if (queueError) return NextResponse.json({ error: "De valgte filer kunne ikke sættes i kø" }, { status: 500 });
  after(() => triggerDriveImportWorker(run.id));
  return NextResponse.json({ batchId: batch.id, runId: run.id, status: run.status, queued: fileIds.length }, { status: 202 });
}
