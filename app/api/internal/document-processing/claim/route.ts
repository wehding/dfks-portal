import { NextResponse } from "next/server";

import { verifyOcrCloudRunRequest } from "@/lib/server/cloud-run-identity";
import { processContractDocumentArtifactDeletions } from "@/lib/server/contract-document-artifact-deletions";
import { parseContractDocumentLeaseArtifactPath } from "@/lib/server/contract-document-lease-artifacts";
import { createServiceClient } from "@/lib/supabase/service";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ServiceClient = ReturnType<typeof createServiceClient>;
const CLEANUP_TIMEOUT_MS = 2_000;

function createCleanupFetch(signal: AbortSignal): typeof globalThis.fetch {
  return (input, init) => globalThis.fetch(input, {
    ...init,
    redirect: "error",
    signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
  });
}

async function cleanupAbandonedLeaseArtifacts(db: ServiceClient) {
  const { data, error } = await db.rpc(
    "list_abandoned_contract_document_lease_artifacts",
    { p_limit: 25 },
  );
  if (error) return;
  const entries = Array.isArray(data)
    ? data as Array<{ storage_path?: unknown }>
    : [];
  const paths = entries
    .map((entry): string | null => typeof entry.storage_path === "string" ? entry.storage_path : null)
    .filter((path): path is string => Boolean(path && parseContractDocumentLeaseArtifactPath(path)));
  if (paths.length > 0) await db.storage.from("kontrakter").remove(paths);
}

async function retrySupersededArtifactDeletions(db: ServiceClient) {
  const results = await processContractDocumentArtifactDeletions(db, { limit: 25 });
  const grouped = new Map<string, typeof results>();
  for (const result of results) {
    const key = `${result.orgId}:${result.contractId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), result]);
  }
  for (const entries of grouped.values()) {
    const first = entries[0];
    const { data: contract } = await db.from("contracts")
      .select("rights_holder_id")
      .eq("id", first.contractId)
      .eq("org_id", first.orgId)
      .maybeSingle();
    const deleted = entries.filter((entry) => entry.succeeded).length;
    await recordSensitiveFlow({
      actor: { orgId: first.orgId, source: "cron" },
      action: "delete",
      component: "internal.document-processing.retry-artifact-deletion",
      entityType: "contracts",
      entityId: first.contractId,
      targetMemberUuid: contract?.rights_holder_id ?? null,
      orgIds: [first.orgId],
      purposeCode: "document_ocr_replacement_cleanup",
      legalBasis: "GDPR Art. 6(1)(b)/(f) og 9(2)(d)",
      dataCategories: ["contract_data", "document_data"],
      outcome: deleted === entries.length ? "success" : "partial",
      counts: { attempted: entries.length, deleted, pendingRetry: entries.length - deleted },
    });
  }
}

export async function POST(request: Request) {
  try {
    await verifyOcrCloudRunRequest(request);
  } catch {
    return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  }

  const audit = { source: "cron" as const, mode: "summary" as const };
  const db = createServiceClient({ audit });
  const cleanupAbortController = new AbortController();
  const cleanupTimer = setTimeout(() => cleanupAbortController.abort(), CLEANUP_TIMEOUT_MS);
  cleanupTimer.unref?.();
  const cleanupDb = createServiceClient({
    audit,
    fetch: createCleanupFetch(cleanupAbortController.signal),
  });
  // Best effort and non-blocking for the authoritative queue: claim starts at
  // once, while abandoned lease artifacts are removed in parallel. Cleanup is
  // bounded and abortable, so a slow Storage request cannot stall the worker.
  const cleanup = Promise.all([
    cleanupAbandonedLeaseArtifacts(cleanupDb),
    retrySupersededArtifactDeletions(cleanupDb),
  ])
    .catch(() => undefined)
    .finally(() => clearTimeout(cleanupTimer));
  const claim = db.rpc("claim_next_contract_document_job", { p_lease_minutes: 30 });
  let [{ data: job, error }] = await Promise.all([claim, cleanup]);
  if (error) return NextResponse.json({ error: "Dokumentkøen kunne ikke læses" }, { status: 500 });

  // An empty ordinary queue is also the bounded recovery trigger for older
  // technical needs-review results. Supabase remains the only queue and the
  // service-only RPC applies the immutable-source, generation and retry caps
  // before creating at most one recovery generation. Rescan requests are
  // explicitly excluded by the database policy.
  if (!job?.id || !job.lease_token) {
    const recovery = await db.rpc(
      "queue_contract_document_job_automatic_recovery_batch",
      { p_limit: 1 },
    );
    if (recovery.error) {
      return NextResponse.json({ error: "Dokumentkøens genbehandling kunne ikke planlægges" }, { status: 500 });
    }
    const retriedClaim = await db.rpc("claim_next_contract_document_job", { p_lease_minutes: 30 });
    job = retriedClaim.data;
    error = retriedClaim.error;
    if (error) return NextResponse.json({ error: "Dokumentkøen kunne ikke læses" }, { status: 500 });
  }
  if (!job?.id || !job.lease_token) return new NextResponse(null, { status: 204 });
  const expectedOriginalSha256 = typeof job.original_sha256 === "string"
    && /^[0-9a-f]{64}$/i.test(job.original_sha256)
    ? job.original_sha256.toLowerCase()
    : null;

  const download = await db.storage.from("kontrakter").createSignedUrl(job.original_storage_path, 10 * 60, {
    download: false,
  });
  // Every lease writes to its own immutable derivative namespace. A stale
  // worker may retain a short-lived signed token, but it can then only write
  // to its abandoned lease path and can never overwrite the active result.
  // finish_contract_document_job_v7 promotes only the paths belonging to the
  // currently locked lease into the contract row.
  const leasePrefix = `${job.org_id}/processed/${job.contract_id}/leases/${job.lease_token}`;
  const outputUploadPath = `${leasePrefix}/normalised.pdf`;
  const spatialUploadPath = `${leasePrefix}/vision-layout.json.gz`;
  const { data: leasedJob, error: derivativePathError } = await db.from("contract_document_jobs")
    .update({
      output_storage_path: outputUploadPath,
      spatial_data_path: spatialUploadPath,
    })
    .eq("id", job.id)
    .eq("status", "processing")
    .eq("lease_token", job.lease_token)
    .select("id")
    .maybeSingle();
  if (download.error || derivativePathError || !leasedJob?.id) {
    await db.rpc("finish_contract_document_job_v7", {
      p_job_id: job.id,
      p_lease_token: job.lease_token,
      p_status: "failed",
      p_error_code: "signed_url_failed",
      p_safe_error_message: "Midlertidig filadgang kunne ikke oprettes.",
      p_original_sha256: expectedOriginalSha256,
    });
    return NextResponse.json({ error: "Midlertidig filadgang kunne ikke oprettes" }, { status: 500 });
  }
  const { data: contract } = await db.from("contracts")
    .select("rights_holder_id")
    .eq("id", job.contract_id)
    .eq("org_id", job.org_id)
    .maybeSingle();
  await recordSensitiveFlow({
    actor: { orgId: job.org_id, source: "cron" },
    action: "read",
    component: "internal.document-processing.claim",
    entityType: "contracts",
    entityId: job.contract_id,
    targetMemberUuid: contract?.rights_holder_id ?? null,
    orgIds: [job.org_id],
    purposeCode: "document_ocr_processing",
    legalBasis: "GDPR Art. 6(1)(b)/(f) og 9(2)(d)",
    dataCategories: ["contract_data", "document_data", "ai_analysis"],
    correlationId: job.id,
  });
  return NextResponse.json({
    jobId: job.id,
    leaseToken: job.lease_token,
    expectedOriginalSha256,
    downloadUrl: download.data.signedUrl,
    uploadPath: outputUploadPath,
    spatialUploadPath,
    maxBytes: 25 * 1024 * 1024,
  }, { headers: { "Cache-Control": "no-store" } });
}
