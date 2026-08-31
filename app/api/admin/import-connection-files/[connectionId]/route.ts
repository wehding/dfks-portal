import { NextRequest, NextResponse, after } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { browseGoogleDrive } from "@/lib/server/import-provider-files";
import { driveImportWorkerSecret, triggerDriveImportWorker } from "@/lib/drive-import-worker";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

export const dynamic = "force-dynamic";

async function organisationConnection(connectionId: string, orgId: string) {
  const db = createServiceClient();
  const { data } = await db.from("import_connections")
    .select("id,org_id,provider,credentials_encrypted,status")
    .eq("id", connectionId).eq("org_id", orgId).eq("connection_kind", "organisation").maybeSingle();
  return data;
}

export async function GET(request: NextRequest, context: { params: Promise<{ connectionId: string }> }) {
  const caller = await assertAdminRole(await createClient(), ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const connection = await organisationConnection((await context.params).connectionId, caller.orgId);
  if (!connection || connection.status !== "connected") return NextResponse.json({ error: "Forbindelsen blev ikke fundet" }, { status: 404 });
  const runId = request.nextUrl.searchParams.get("runId");
  if (runId) {
    const { data: run } = await createServiceClient().from("drive_import_runs")
      .select("id,status,discovered_count,imported_count,duplicate_count,failed_count,last_error")
      .eq("id", runId).eq("connection_id", connection.id).eq("org_id", caller.orgId).maybeSingle();
    return run ? NextResponse.json({ run }) : NextResponse.json({ error: "Importjobbet blev ikke fundet" }, { status: 404 });
  }
  if (connection.provider !== "google_drive") return NextResponse.json({ error: "Kun Google Drive understøttes her" }, { status: 409 });
  try {
    const result = await browseGoogleDrive({
      encryptedCredentials: connection.credentials_encrypted,
      connectionKind: "organisation",
      folderId: request.nextUrl.searchParams.get("folderId") || "root",
      pageToken: request.nextUrl.searchParams.get("cursor") || undefined,
      sharedWithMe: request.nextUrl.searchParams.get("view") === "shared",
      pageSize: 100,
    });
    await recordSensitiveFlow({ actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" }, action: "search", component: "admin.import-connections.files", entityType: "import_connections", entityId: connection.id, orgIds: [caller.orgId], purposeCode: "contract_import_source_selection", legalBasis: "GDPR Art. 6(1)(c)/(f) og 9(2)(d)", dataCategories: ["document_metadata", "contract_data"], counts: { folders: result.entries.filter(entry => entry.kind === "folder").length, files: result.entries.filter(entry => entry.kind === "file").length } });
    return NextResponse.json({
      folders: result.entries.filter(entry => entry.kind === "folder"),
      files: result.entries.filter(entry => entry.kind === "file" && /\.(pdf|doc|docx|txt)$/i.test(entry.name)),
      nextCursor: result.nextPageToken,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("[drive-picker] Google Drive kunne ikke gennemses", error instanceof Error ? error.message : "ukendt fejl");
    return NextResponse.json({ error: "Google Drive kunne ikke åbnes. Kontrollér forbindelsen og prøv igen." }, { status: 502 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ connectionId: string }> }) {
  const caller = await assertAdminRole(await createClient(), ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const connection = await organisationConnection((await context.params).connectionId, caller.orgId);
  if (!connection || connection.status !== "connected") return NextResponse.json({ error: "Forbindelsen blev ikke fundet" }, { status: 404 });
  if (connection.provider !== "google_drive") return NextResponse.json({ error: "Kun Google Drive understøttes her" }, { status: 409 });
  const body = await request.json().catch(() => ({})) as { fileIds?: unknown };
  const fileIds = Array.isArray(body.fileIds)
    ? [...new Set(body.fileIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 1024))].slice(0, 500)
    : [];
  if (!fileIds.length) return NextResponse.json({ error: "Vælg mindst én kontrakt" }, { status: 400 });
  if (!driveImportWorkerSecret()) return NextResponse.json({ error: "Baggrundsimport er ikke konfigureret" }, { status: 503 });

  const db = createServiceClient({ audit: { actorUserId: caller.userId, actorOrgId: caller.orgId, actorRole: caller.role, source: "admin", correlationId: crypto.randomUUID(), mode: "summary" } });
  const { data: batch, error: batchError } = await db.from("contract_import_batches").insert({
    org_id: caller.orgId, created_by: caller.userId, source: "google_drive", connection_id: connection.id,
    status: "processing", discovered_count: fileIds.length,
  }).select("id").single();
  if (batchError || !batch) return NextResponse.json({ error: "Importen kunne ikke startes" }, { status: 500 });
  const { data: run, error: runError } = await db.from("drive_import_runs").insert({
    org_id: caller.orgId, connection_id: connection.id, batch_id: batch.id,
    connection_kind: "organisation", started_by: caller.userId, rights_holder_id: null,
    status: "queued", recursive: false, discovered_count: fileIds.length,
  }).select("id,status").single();
  if (runError || !run) return NextResponse.json({ error: "Importkøen kunne ikke oprettes" }, { status: 500 });
  const queued = await db.from("drive_import_queue_items").insert(fileIds.map(id => ({
    run_id: run.id, provider_file_id: id, provider_revision: "selected", file_name: id, file_size_bytes: 0,
  })));
  if (queued.error) return NextResponse.json({ error: "Filerne kunne ikke sættes i kø" }, { status: 500 });
  await recordSensitiveFlow({ actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" }, action: "import", component: "admin.import-connections.queue", entityType: "drive_import_runs", entityId: run.id, orgIds: [caller.orgId], purposeCode: "contract_import", legalBasis: "GDPR Art. 6(1)(c)/(f) og 9(2)(d)", dataCategories: ["document_metadata", "contract_data"], counts: { queued: fileIds.length } });
  after(() => triggerDriveImportWorker(run.id));
  return NextResponse.json({ batchId: batch.id, runId: run.id, queued: fileIds.length }, { status: 202 });
}
