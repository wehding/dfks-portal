import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { contractFileHash, safeContractFileName, validateContractImportFile } from "@/lib/contract-import";

export type ContractImportActor = {
  userId: string;
  orgId: string;
  role?: string;
};

export type ContractImportFile = {
  name: string;
  contentType?: string | null;
  buffer: Buffer;
  clientToken: string;
  sourceId?: string | null;
  providerFileId?: string | null;
  providerRevision?: string | null;
};

export async function intakeContractFile(input: {
  batchId: string;
  actor: ContractImportActor;
  file: ContractImportFile;
  rightsHolderId?: string | null;
  workId?: string | null;
}) {
  const validationError = validateContractImportFile({ name: input.file.name, size: input.file.buffer.byteLength });
  if (validationError) return { ok: false as const, status: 400, error: validationError };
  if (!/^[0-9a-f-]{36}$/i.test(input.file.clientToken)) return { ok: false as const, status: 400, error: "Ugyldig filreference" };

  const { actor } = input;
  const db = createServiceClient({ audit: {
    actorUserId: actor.userId,
    actorOrgId: actor.orgId,
    actorRole: actor.role,
    source: actor.role === "member" ? "portal" : "admin",
    correlationId: input.batchId,
    mode: "summary",
  } });
  const { data: batch } = await db.from("contract_import_batches")
    .select("id,status")
    .eq("id", input.batchId)
    .eq("org_id", actor.orgId)
    .maybeSingle();
  if (!batch || batch.status === "cancelled") return { ok: false as const, status: 404, error: "Importbatch blev ikke fundet eller er annulleret" };

  const preferredWorkId = input.workId
    ? (await db.from("works").select("id").eq("id", input.workId).maybeSingle()).data?.id ?? null
    : null;
  const safeRightsHolderId = input.rightsHolderId
    ? (await db.from("rettighedshavere").select("id,org_affiliations!inner(org_id)").eq("id", input.rightsHolderId).eq("org_affiliations.org_id", actor.orgId).maybeSingle()).data?.id ?? null
    : null;
  const fileHash = contractFileHash(input.file.buffer);
  const { data: duplicate } = await db.from("contract_file_fingerprints")
    .select("contract_id")
    .eq("org_id", actor.orgId)
    .eq("file_hash", fileHash)
    .maybeSingle();
  const commonItem = {
    batch_id: input.batchId,
    org_id: actor.orgId,
    source_id: input.file.sourceId ?? null,
    client_token: input.file.clientToken,
    original_file_name: safeContractFileName(input.file.name),
    content_type: input.file.contentType || null,
    file_size_bytes: input.file.buffer.byteLength,
    file_hash: fileHash,
    provider_file_id: input.file.providerFileId ?? null,
    provider_revision: input.file.providerRevision ?? null,
  };
  if (duplicate) {
    const { data: item } = await db.from("contract_import_items").insert({
      ...commonItem, contract_id: duplicate.contract_id, status: "duplicate",
    }).select("id,status,contract_id").single();
    return { ok: true as const, item, duplicate: true };
  }

  const { data: item, error: itemError } = await db.from("contract_import_items")
    .insert({ ...commonItem, status: "uploaded" }).select("id").single();
  if (itemError || !item) return { ok: false as const, status: 500, error: "Filen kunne ikke registreres" };

  const storagePath = `${actor.orgId}/imports/${input.batchId}/${item.id}/${safeContractFileName(input.file.name)}`;
  const uploadResult = await db.storage.from("kontrakter").upload(storagePath, input.file.buffer, {
    contentType: input.file.contentType || "application/octet-stream",
    upsert: false,
  });
  if (uploadResult.error) {
    await db.from("contract_import_items").update({ status: "retryable_error", error_code: "storage_upload", error_message: "Filen kunne ikke gemmes" }).eq("id", item.id);
    return { ok: false as const, status: 500, error: "Filen kunne ikke gemmes" };
  }

  const { data: contract, error: contractError } = await db.from("contracts").insert({
    org_id: actor.orgId,
    type: "a-løn",
    overenskomst: null,
    status: "kladde",
    pdf_url: storagePath,
    working_title: input.file.name.replace(/\.[^.]+$/, ""),
    rights_holder_id: safeRightsHolderId,
    work_id: preferredWorkId,
  }).select("id").single();
  if (contractError || !contract) {
    await db.storage.from("kontrakter").remove([storagePath]);
    await db.from("contract_import_items").update({ status: "dead", error_code: "contract_create", error_message: "Kontrakten kunne ikke oprettes" }).eq("id", item.id);
    return { ok: false as const, status: 500, error: "Kontrakten kunne ikke oprettes" };
  }

  const { data: job, error: jobError } = await db.from("contract_ai_jobs").insert({
    contract_id: contract.id,
    org_id: actor.orgId,
    created_by: actor.userId,
    status: "queued",
    priority: 100,
  }).select("id").single();
  if (jobError || !job) {
    await db.from("contracts").delete().eq("id", contract.id);
    await db.storage.from("kontrakter").remove([storagePath]);
    await db.from("contract_import_items").update({ status: "dead", error_code: "job_create", error_message: "Analysejobbet kunne ikke oprettes" }).eq("id", item.id);
    return { ok: false as const, status: 500, error: "Analysejobbet kunne ikke oprettes" };
  }

  const fingerprint = await db.from("contract_file_fingerprints").insert({
    org_id: actor.orgId,
    file_hash: fileHash,
    contract_id: contract.id,
    import_item_id: item.id,
  });
  if (fingerprint.error) {
    const { data: raced } = await db.from("contract_file_fingerprints").select("contract_id")
      .eq("org_id", actor.orgId).eq("file_hash", fileHash).maybeSingle();
    await db.from("contracts").delete().eq("id", contract.id);
    await db.storage.from("kontrakter").remove([storagePath]);
    await db.from("contract_import_items").update({
      status: "duplicate",
      contract_id: raced?.contract_id ?? null,
      error_code: null,
      error_message: null,
    }).eq("id", item.id);
    return { ok: true as const, item: { id: item.id, status: "duplicate", contract_id: raced?.contract_id ?? null }, duplicate: true };
  }

  await db.from("contract_import_items").update({
    storage_path: storagePath,
    contract_id: contract.id,
    ai_job_id: job.id,
    status: "queued",
  }).eq("id", item.id);
  return { ok: true as const, item: { id: item.id, status: "queued", contract_id: contract.id }, duplicate: false };
}
