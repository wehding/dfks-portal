import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { validateContractImportFile } from "@/lib/contract-import";
import { intakeContractFile, type ContractImportActor } from "@/lib/server/contract-import-intake";
import { downloadProviderFile, listProviderFiles } from "@/lib/server/import-provider-files";
import type { ImportProvider } from "@/lib/server/import-connection-oauth";

const DRIVE_SYNC_CHUNK_SIZE = 20;

export async function syncImportSource(sourceId: string, actor: ContractImportActor) {
  const db = createServiceClient({ audit: { actorUserId: actor.userId, actorOrgId: actor.orgId, actorRole: actor.role, source: "admin", correlationId: crypto.randomUUID(), mode: "summary" } });
  const { data: source } = await db.from("import_sources")
    .select("id,import_type,provider_folder_id,recursive,enabled,connection_id,import_connections!inner(provider,credentials_encrypted,status)")
    .eq("id", sourceId).eq("org_id", actor.orgId).maybeSingle();
  const connectionRelation = source?.import_connections as unknown;
  const connection = (Array.isArray(connectionRelation) ? connectionRelation[0] : connectionRelation) as { provider?: ImportProvider; credentials_encrypted?: string; status?: string } | null;
  if (!source || !source.enabled || !connection?.provider || !connection.credentials_encrypted || connection.status !== "connected") {
    return { ok: false as const, status: 404, error: "Importmappen eller drevforbindelsen er ikke aktiv" };
  }
  if (source.import_type !== "contracts") {
    return { ok: false as const, status: 409, error: "Synkronisering er endnu kun aktiv for kontrakter" };
  }
  try {
    const { token, files } = await listProviderFiles({ provider: connection.provider, encryptedCredentials: connection.credentials_encrypted, folderId: source.provider_folder_id, recursive: source.recursive });
    const supported = files.filter(file => !validateContractImportFile({ name: file.name, size: file.size || 1 }));
    const { data: imported } = await db.from("contract_import_items")
      .select("id,provider_file_id,provider_revision,status,contract_id")
      .eq("source_id", source.id)
      .not("provider_file_id", "is", null);
    const replaceableFailures = (imported ?? [])
      .filter(item => !item.contract_id && ["retryable_error", "dead"].includes(item.status))
      .map(item => item.id);
    if (replaceableFailures.length) await db.from("contract_import_items").delete().in("id", replaceableFailures);
    const replaceableSet = new Set(replaceableFailures);
    const known = new Set((imported ?? []).filter(item => !replaceableSet.has(item.id)).map(item => `${item.provider_file_id}:${item.provider_revision}`));
    const pending = supported.filter(file => !known.has(`${file.id}:${file.revision}`));
    const chunk = pending.slice(0, DRIVE_SYNC_CHUNK_SIZE);
    if (!chunk.length) {
      await db.from("import_sources").update({ last_synced_at: new Date().toISOString(), last_error: null }).eq("id", source.id);
      return { ok: true as const, imported: 0, duplicates: 0, failed: 0, remaining: 0 };
    }
    const { data: batch, error: batchError } = await db.from("contract_import_batches").insert({ org_id: actor.orgId, created_by: actor.userId, source: connection.provider, connection_id: source.connection_id, status: "processing", discovered_count: chunk.length }).select("id").single();
    if (batchError || !batch) throw new Error("Importbatch kunne ikke oprettes");
    let importedCount = 0;
    let duplicates = 0;
    let failed = 0;
    for (const file of chunk) {
      try {
        const buffer = await downloadProviderFile(connection.provider, token, file);
        const result = await intakeContractFile({ batchId: batch.id, actor, file: { name: file.name, contentType: file.contentType, buffer, clientToken: crypto.randomUUID(), sourceId: source.id, providerFileId: file.id, providerRevision: file.revision } });
        if (result.ok && result.duplicate) duplicates += 1;
        else if (result.ok) importedCount += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    await db.from("import_sources").update({ last_synced_at: new Date().toISOString(), last_error: failed ? `${failed} fil(er) kunne ikke importeres i denne kørsel` : null }).eq("id", source.id);
    return { ok: true as const, imported: importedCount, duplicates, failed, remaining: Math.max(0, pending.length - chunk.length), batchId: batch.id };
  } catch (error) {
    const safeError = error instanceof Error ? error.message : "Drevimporten fejlede";
    await db.from("import_sources").update({ last_error: safeError }).eq("id", source.id);
    return { ok: false as const, status: 502, error: safeError };
  }
}
