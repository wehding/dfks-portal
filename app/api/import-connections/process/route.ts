import { after, NextRequest, NextResponse } from "next/server";
import { requireInternalSecretApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { validateContractImportFile } from "@/lib/contract-import";
import { browseGoogleDrive, downloadProviderFile, getProviderFile, providerAccessToken } from "@/lib/server/import-provider-files";
import { intakeContractFile } from "@/lib/server/contract-import-intake";
import { triggerDriveImportWorker } from "@/lib/drive-import-worker";
import { processPendingContractJobs } from "@/app/api/contracts/jobs/process/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function uuid(value: unknown) {
  const text = typeof value === "string" ? value : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

async function refreshRun(runId: string) {
  const db = createServiceClient();
  const [runResult, folderPendingResult, folderErrorResult, itemTotalResult, itemPendingResult, importedResult, duplicateResult, itemErrorResult] = await Promise.all([
    db.from("drive_import_runs").select("source_id,batch_id").eq("id", runId).maybeSingle(),
    db.from("drive_import_folders").select("id", { count: "exact", head: true }).eq("run_id", runId).in("status", ["queued", "processing"]),
    db.from("drive_import_folders").select("id", { count: "exact", head: true }).eq("run_id", runId).eq("status", "error"),
    db.from("drive_import_queue_items").select("id", { count: "exact", head: true }).eq("run_id", runId),
    db.from("drive_import_queue_items").select("id", { count: "exact", head: true }).eq("run_id", runId).in("status", ["queued", "processing"]),
    db.from("drive_import_queue_items").select("id", { count: "exact", head: true }).eq("run_id", runId).eq("status", "imported"),
    db.from("drive_import_queue_items").select("id", { count: "exact", head: true }).eq("run_id", runId).eq("status", "duplicate"),
    db.from("drive_import_queue_items").select("id", { count: "exact", head: true }).eq("run_id", runId).eq("status", "error"),
  ]);
  const pendingFolders = (folderPendingResult.count ?? 0) > 0;
  const pendingItems = (itemPendingResult.count ?? 0) > 0;
  const imported = importedResult.count ?? 0;
  const duplicates = duplicateResult.count ?? 0;
  const failures = (folderErrorResult.count ?? 0) + (itemErrorResult.count ?? 0);
  const discovered = itemTotalResult.count ?? 0;
  const remaining = pendingFolders || pendingItems;
  await db.from("drive_import_runs").update({
    status: remaining ? (pendingFolders ? "discovering" : "processing") : failures ? "partially_failed" : "completed",
    discovered_count: discovered,
    imported_count: imported,
    duplicate_count: duplicates,
    failed_count: failures,
    completed_at: remaining ? null : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", runId);
  if (!remaining && runResult.data?.batch_id && discovered === 0) {
    await db.from("contract_import_batches").update({ status: failures ? "partially_failed" : "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", runResult.data.batch_id);
  }
  if (!remaining && runResult.data?.source_id) {
    await db.from("import_sources").update({
      last_synced_at: new Date().toISOString(),
      last_error: failures ? `${failures} mappe(r) eller fil(er) kunne ikke importeres` : null,
      updated_at: new Date().toISOString(),
    }).eq("id", runResult.data.source_id);
  }
  return { remaining, imported, duplicates, failures };
}

export async function POST(request: NextRequest) {
  if (!requireInternalSecretApi(request, "drive-import")) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const body = await request.json().catch(() => null) as { runId?: unknown } | null;
  const runId = uuid(body?.runId);
  if (!runId) return NextResponse.json({ error: "Ugyldigt importjob" }, { status: 400 });
  const db = createServiceClient();
  const { data: run } = await db.from("drive_import_runs")
    .select("id,org_id,connection_id,source_id,batch_id,connection_kind,started_by,rights_holder_id,recursive,status,import_connections!inner(provider,credentials_encrypted,status)")
    .eq("id", runId).maybeSingle();
  const relation = run?.import_connections as unknown;
  const connection = (Array.isArray(relation) ? relation[0] : relation) as { provider?: string; credentials_encrypted?: string; status?: string } | null;
  if (!run || !run.started_by || !run.batch_id || connection?.provider !== "google_drive" || !connection.credentials_encrypted || connection.status !== "connected") {
    return NextResponse.json({ error: "Importjobbet eller Google Drive-forbindelsen blev ikke fundet" }, { status: 404 });
  }
  if (["completed", "partially_failed", "failed", "cancelled"].includes(run.status)) {
    return NextResponse.json({ runId, status: run.status });
  }

  const { data: claimedFolders } = await db.rpc("claim_drive_import_folder", { p_run_id: runId });
  const folder = claimedFolders?.[0] as { id: string; provider_folder_id: string; page_token: string; attempts: number } | undefined;
  if (folder) {
    try {
      const page = await browseGoogleDrive({
        encryptedCredentials: connection.credentials_encrypted,
        connectionKind: "organisation",
        folderId: folder.provider_folder_id,
        pageToken: folder.page_token || undefined,
        pageSize: 100,
      });
      const supportedFiles = page.entries.filter(entry => entry.kind === "file" && !validateContractImportFile({ name: entry.name, size: entry.size || 1 }));
      if (supportedFiles.length) await db.from("drive_import_queue_items").upsert(supportedFiles.map(file => ({
        run_id: runId, provider_file_id: file.id, provider_revision: file.revision,
        file_name: file.name, content_type: file.contentType, file_size_bytes: file.size,
      })), { onConflict: "run_id,provider_file_id,provider_revision", ignoreDuplicates: true });
      if (run.recursive) {
        const children = page.entries.filter(entry => entry.kind === "folder");
        if (children.length) await db.from("drive_import_folders").upsert(children.map(child => ({ run_id: runId, provider_folder_id: child.id, page_token: "" })), { onConflict: "run_id,provider_folder_id,page_token", ignoreDuplicates: true });
      }
      if (page.nextPageToken) await db.from("drive_import_folders").upsert({ run_id: runId, provider_folder_id: folder.provider_folder_id, page_token: page.nextPageToken }, { onConflict: "run_id,provider_folder_id,page_token", ignoreDuplicates: true });
      await db.from("drive_import_folders").update({ status: "done", locked_at: null, error_message: null, updated_at: new Date().toISOString() }).eq("id", folder.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mappen kunne ikke læses";
      await db.from("drive_import_folders").update({ status: folder.attempts < 3 ? "queued" : "error", locked_at: null, error_message: message.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", folder.id);
    }
  }

  const { data: claimedItems } = await db.rpc("claim_drive_import_item", { p_run_id: runId });
  const item = claimedItems?.[0] as { id: string; provider_file_id: string; provider_revision: string; attempts: number } | undefined;
  if (item) {
    try {
      if (run.source_id) {
        const { data: known } = await db.from("contract_import_items").select("id").eq("source_id", run.source_id)
          .eq("provider_file_id", item.provider_file_id).eq("provider_revision", item.provider_revision).maybeSingle();
        if (known) {
          await db.from("drive_import_queue_items").update({ status: "duplicate", locked_at: null, updated_at: new Date().toISOString() }).eq("id", item.id);
        } else {
          const token = await providerAccessToken("google_drive", connection.credentials_encrypted, run.connection_kind);
          const file = await getProviderFile("google_drive", token, item.provider_file_id);
          const buffer = await downloadProviderFile("google_drive", token, file);
          const result = await intakeContractFile({
            batchId: run.batch_id,
            actor: { userId: run.started_by, orgId: run.org_id, role: run.connection_kind === "member" ? "member" : "admin" },
            rightsHolderId: run.rights_holder_id,
            file: { name: file.name, contentType: file.contentType, buffer, clientToken: crypto.randomUUID(), sourceId: run.source_id, providerFileId: file.id, providerRevision: file.revision },
          });
          if (!result.ok) throw new Error(result.error);
          await db.from("drive_import_queue_items").update({ status: result.duplicate ? "duplicate" : "imported", locked_at: null, error_message: null, updated_at: new Date().toISOString() }).eq("id", item.id);
        }
      } else {
        const token = await providerAccessToken("google_drive", connection.credentials_encrypted, "member");
        const file = await getProviderFile("google_drive", token, item.provider_file_id);
        const buffer = await downloadProviderFile("google_drive", token, file);
        const result = await intakeContractFile({
          batchId: run.batch_id,
          actor: { userId: run.started_by, orgId: run.org_id, role: "member" },
          rightsHolderId: run.rights_holder_id,
          file: { name: file.name, contentType: file.contentType, buffer, clientToken: crypto.randomUUID(), providerFileId: file.id, providerRevision: file.revision },
        });
        if (!result.ok) throw new Error(result.error);
        await db.from("drive_import_queue_items").update({ status: result.duplicate ? "duplicate" : "imported", locked_at: null, error_message: null, updated_at: new Date().toISOString() }).eq("id", item.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Filen kunne ikke importeres";
      await db.from("drive_import_queue_items").update({ status: item.attempts < 3 ? "queued" : "error", locked_at: null, error_message: message.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", item.id);
    }
  }

  const progress = await refreshRun(runId);
  if (progress.remaining) after(() => triggerDriveImportWorker(runId));
  else if (progress.imported) after(() => processPendingContractJobs(run.org_id));
  return NextResponse.json({ runId, ...progress });
}
