import { NextResponse } from "next/server";

import { verifyOcrCloudRunRequest } from "@/lib/server/cloud-run-identity";
import { parseContractDocumentLeaseArtifactPath } from "@/lib/server/contract-document-lease-artifacts";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ServiceClient = ReturnType<typeof createServiceClient>;
const CLEANUP_TIMEOUT_MS = 2_000;

function sourceFormatFromStoragePath(path: unknown) {
  const match = typeof path === "string" ? path.match(/\.([a-z0-9]+)$/i) : null;
  const extension = match?.[1]?.toLocaleLowerCase("en-US") ?? "";
  return ["pdf", "doc", "docx"].includes(extension) ? extension : null;
}

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
  const cleanup = cleanupAbandonedLeaseArtifacts(cleanupDb)
    .catch(() => undefined)
    .finally(() => clearTimeout(cleanupTimer));
  const claim = db.rpc("claim_next_contract_document_job", { p_lease_minutes: 30 });
  const [{ data: job, error }] = await Promise.all([claim, cleanup]);
  if (error) return NextResponse.json({ error: "Dokumentkøen kunne ikke læses" }, { status: 500 });
  if (!job?.id || !job.lease_token) return new NextResponse(null, { status: 204 });

  const sourceFormat = sourceFormatFromStoragePath(job.original_storage_path);
  if (!sourceFormat) {
    await db.rpc("finish_contract_document_job_v5", {
      p_job_id: job.id,
      p_lease_token: job.lease_token,
      p_status: "needs_review",
      p_error_code: "unsupported_document_format",
      p_safe_error_message: "Dokumenttypen kan ikke behandles automatisk.",
    });
    return new NextResponse(null, { status: 204 });
  }

  const download = await db.storage.from("kontrakter").createSignedUrl(job.original_storage_path, 10 * 60, {
    download: false,
  });
  // Every lease writes to its own immutable derivative namespace. A stale
  // worker may retain a short-lived signed token, but it can then only write
  // to its abandoned lease path and can never overwrite the active result.
  // finish_contract_document_job_v5 promotes only the paths belonging to the
  // currently locked lease into the contract row.
  const leasePrefix = `${job.org_id}/processed/${job.contract_id}/leases/${job.lease_token}`;
  const outputUploadPath = `${leasePrefix}/normalised.pdf`;
  const originalViewUploadPath = sourceFormat === "pdf" ? null : `${leasePrefix}/original-view.pdf`;
  const spatialUploadPath = `${leasePrefix}/vision-layout.json.gz`;
  const { data: leasedJob, error: derivativePathError } = await db.from("contract_document_jobs")
    .update({
      output_storage_path: outputUploadPath,
      original_view_storage_path: originalViewUploadPath,
      spatial_data_path: spatialUploadPath,
    })
    .eq("id", job.id)
    .eq("status", "processing")
    .eq("lease_token", job.lease_token)
    .select("id")
    .maybeSingle();
  if (download.error || derivativePathError || !leasedJob?.id) {
    await db.rpc("finish_contract_document_job_v5", {
      p_job_id: job.id,
      p_lease_token: job.lease_token,
      p_status: "failed",
      p_error_code: "signed_url_failed",
      p_safe_error_message: "Midlertidig filadgang kunne ikke oprettes.",
    });
    return NextResponse.json({ error: "Midlertidig filadgang kunne ikke oprettes" }, { status: 500 });
  }
  return NextResponse.json({
    jobId: job.id,
    leaseToken: job.lease_token,
    expectedOriginalSha256: typeof job.original_sha256 === "string"
      && /^[0-9a-f]{64}$/i.test(job.original_sha256)
      ? job.original_sha256.toLowerCase()
      : null,
    sourceFormat,
    downloadUrl: download.data.signedUrl,
    uploadPath: outputUploadPath,
    originalViewUploadPath,
    spatialUploadPath,
    maxBytes: 25 * 1024 * 1024,
  }, { headers: { "Cache-Control": "no-store" } });
}
