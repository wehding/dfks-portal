import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { driveImportWorkerSecret, triggerDriveImportWorker } from "@/lib/drive-import-worker";

export async function GET(_request: NextRequest, context: { params: Promise<{ sourceId: string }> }) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const sourceId = (await context.params).sourceId;
  const db = createServiceClient();
  const { data: run } = await db.from("drive_import_runs")
    .select("id,status,discovered_count,imported_count,duplicate_count,failed_count,last_error,created_at,completed_at")
    .eq("source_id", sourceId).eq("org_id", caller.orgId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return NextResponse.json({ run: run ?? null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(_request: NextRequest, context: { params: Promise<{ sourceId: string }> }) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  if (!driveImportWorkerSecret()) return NextResponse.json({ error: "Baggrundsimport er ikke konfigureret" }, { status: 503 });
  const sourceId = (await context.params).sourceId;
  const db = createServiceClient({ audit: { actorUserId: caller.userId, actorOrgId: caller.orgId, actorRole: caller.role, source: "admin", correlationId: crypto.randomUUID(), mode: "summary" } });
  const { data: source } = await db.from("import_sources")
    .select("id,connection_id,import_type,provider_folder_id,recursive,enabled,import_connections!inner(provider,status,connection_kind)")
    .eq("id", sourceId).eq("org_id", caller.orgId).maybeSingle();
  const relation = source?.import_connections as unknown;
  const connection = (Array.isArray(relation) ? relation[0] : relation) as { provider?: string; status?: string; connection_kind?: string } | null;
  if (!source || !source.enabled || source.import_type !== "contracts" || connection?.provider !== "google_drive" || connection.status !== "connected" || connection.connection_kind !== "organisation") {
    return NextResponse.json({ error: "Importmappen eller Google Drive-forbindelsen er ikke aktiv" }, { status: 404 });
  }
  const { data: active } = await db.from("drive_import_runs").select("id,status")
    .eq("source_id", source.id).in("status", ["queued", "discovering", "processing"]).maybeSingle();
  if (active) {
    after(() => triggerDriveImportWorker(active.id));
    return NextResponse.json({ runId: active.id, status: active.status, resumed: true }, { status: 202 });
  }
  const { data: batch, error: batchError } = await db.from("contract_import_batches").insert({
    org_id: caller.orgId, created_by: caller.userId, source: "google_drive", connection_id: source.connection_id, status: "processing",
  }).select("id").single();
  if (batchError || !batch) return NextResponse.json({ error: "Importbatch kunne ikke oprettes" }, { status: 500 });
  const { data: run, error: runError } = await db.from("drive_import_runs").insert({
    org_id: caller.orgId, connection_id: source.connection_id, source_id: source.id, batch_id: batch.id,
    connection_kind: "organisation", started_by: caller.userId, status: "queued",
    root_folder_id: source.provider_folder_id, recursive: source.recursive,
  }).select("id,status").single();
  if (runError || !run) return NextResponse.json({ error: "Importkøen kunne ikke oprettes" }, { status: 500 });
  const { error: folderError } = await db.from("drive_import_folders").insert({ run_id: run.id, provider_folder_id: source.provider_folder_id, page_token: "" });
  if (folderError) return NextResponse.json({ error: "Importmappen kunne ikke sættes i kø" }, { status: 500 });
  after(() => triggerDriveImportWorker(run.id));
  return NextResponse.json({ runId: run.id, status: run.status }, { status: 202 });
}
