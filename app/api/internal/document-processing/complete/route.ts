import { NextResponse } from "next/server";

import {
  classifyDocumentCompletionFailure,
  isContractDocumentClassification,
  isIdempotentDocumentCompletionReplay,
  type StoredDocumentCompletion,
} from "@/lib/contract-document-completion";
import { verifyOcrCloudRunRequest } from "@/lib/server/cloud-run-identity";
import { processContractDocumentArtifactDeletions } from "@/lib/server/contract-document-artifact-deletions";
import { createServiceClient } from "@/lib/supabase/service";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_DOCUMENT_PAGES = 200;

type Completion = {
  jobId?: string;
  leaseToken?: string;
  status?: "completed" | "failed" | "needs_review" | "not_required";
  documentClassification?: "native_text" | "image_only" | "mixed" | "unreadable";
  ocrEngine?: string | null;
  orientationCorrections?: Array<{ page: number; degrees: 90 | 180 | 270 }>;
  ocrApplied?: boolean;
  pageCount?: number | null;
  textCharCount?: number | null;
  nativePageCount?: number;
  ocrPageCount?: number;
  unreadablePageCount?: number;
  processingProfile?: string | null;
  spatialSchemaVersion?: string | null;
  spatialAccuracyScore?: number | null;
  spatialMedianIou?: number | null;
  spatialCenterInsideRatio?: number | null;
  originalSha256?: string | null;
  processedSha256?: string | null;
  spatialSha256?: string | null;
  errorCode?: string | null;
  safeErrorMessage?: string | null;
};

export async function POST(request: Request) {
  try {
    await verifyOcrCloudRunRequest(request);
  } catch {
    return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  }

  let body: Completion;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig statusbesked" }, { status: 400 });
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!body.jobId || !uuidPattern.test(body.jobId)
    || !body.leaseToken || !uuidPattern.test(body.leaseToken)
    || !["completed", "failed", "needs_review", "not_required"].includes(body.status ?? "")
    || (body.documentClassification != null
      && !isContractDocumentClassification(body.documentClassification))) {
    return NextResponse.json({ error: "Ugyldig jobstatus" }, { status: 400 });
  }
  const corrections = Array.isArray(body.orientationCorrections)
    ? body.orientationCorrections.slice(0, MAX_DOCUMENT_PAGES).filter((entry) =>
      Number.isInteger(entry.page) && entry.page > 0 && [90, 180, 270].includes(entry.degrees))
    : [];
  const db = createServiceClient({ audit: { source: "cron", correlationId: body.jobId, mode: "summary" } });
  const safeCount = (value: unknown) => Number.isInteger(value)
    && Number(value) >= 0 && Number(value) <= MAX_DOCUMENT_PAGES ? Number(value) : 0;
  const safeRatio = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  const safeHash = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
  const safeProfile = (value: unknown) => typeof value === "string"
    && /^[a-z0-9][a-z0-9._-]{2,79}$/.test(value) ? value : null;

  const completionResult = await db.rpc("finish_contract_document_job_v6", {
    p_job_id: body.jobId,
    p_lease_token: body.leaseToken,
    p_status: body.status,
    p_document_classification: body.documentClassification ?? null,
    p_ocr_engine: body.ocrEngine?.slice(0, 80) || null,
    p_orientation_corrections: corrections,
    p_ocr_applied: Boolean(body.ocrApplied),
    p_page_count: Number.isInteger(body.pageCount)
      && Number(body.pageCount) >= 1 && Number(body.pageCount) <= MAX_DOCUMENT_PAGES ? body.pageCount : null,
    p_text_char_count: Number.isInteger(body.textCharCount) && Number(body.textCharCount) >= 0 && Number(body.textCharCount) <= 100_000_000 ? body.textCharCount : null,
    p_native_page_count: safeCount(body.nativePageCount),
    p_ocr_page_count: safeCount(body.ocrPageCount),
    p_unreadable_page_count: safeCount(body.unreadablePageCount),
    p_spatial_accuracy_score: safeRatio(body.spatialAccuracyScore),
    p_spatial_median_iou: safeRatio(body.spatialMedianIou),
    p_spatial_center_inside_ratio: safeRatio(body.spatialCenterInsideRatio),
    p_original_sha256: safeHash(body.originalSha256),
    p_processed_sha256: safeHash(body.processedSha256),
    p_processing_profile: safeProfile(body.processingProfile),
    p_spatial_schema_version: safeProfile(body.spatialSchemaVersion),
    p_spatial_sha256: safeHash(body.spatialSha256),
    p_error_code: body.errorCode?.slice(0, 80) || null,
    p_safe_error_message: body.safeErrorMessage?.slice(0, 500) || null,
  });
  let finished = completionResult.data;
  const { error } = completionResult;
  if (error || !finished?.contract_id) {
    const { data: stored } = await db.from("contract_document_jobs")
      .select("contract_id,status,lease_token,document_classification,ocr_applied,processed_sha256,spatial_sha256,error_code")
      .eq("id", body.jobId)
      .maybeSingle<StoredDocumentCompletion>();
    if (isIdempotentDocumentCompletionReplay(stored, body)) {
      finished = stored;
    } else {
      const failure = classifyDocumentCompletionFailure(error?.code);
      return NextResponse.json({
        error: "Dokumentjobbet kunne ikke afsluttes",
        code: failure.code,
      }, { status: failure.status });
    }
  }

  const { data: contract } = await db.from("contracts")
    .select("org_id,rights_holder_id")
    .eq("id", finished.contract_id)
    .maybeSingle();
  await recordSensitiveFlow({
    actor: { orgId: contract?.org_id ?? null, source: "cron" },
    action: "ai_analysis",
    component: "internal.document-processing.complete",
    entityType: "contracts",
    entityId: finished.contract_id,
    targetMemberUuid: contract?.rights_holder_id ?? null,
    orgIds: contract?.org_id ? [contract.org_id] : [],
    purposeCode: "document_ocr_processing",
    legalBasis: "GDPR Art. 6(1)(b)/(f) og 9(2)(d)",
    dataCategories: ["contract_data", "document_data", "ai_analysis"],
    outcome: body.status === "completed" || body.status === "not_required" ? "success" : body.status === "needs_review" ? "partial" : "failed",
    correlationId: body.jobId,
    counts: {
      pageCount: Number.isInteger(body.pageCount) ? Number(body.pageCount) : null,
      ocrApplied: Boolean(body.ocrApplied),
      promoted: body.status === "completed"
        && body.processingProfile === "google-vision-direct-v1" ? 1 : 0,
    },
  });

  const deletions = await processContractDocumentArtifactDeletions(db, {
    limit: 2,
    replacementJobId: body.jobId,
  });
  if (deletions.length > 0) {
    const deleted = deletions.filter((entry) => entry.succeeded).length;
    await recordSensitiveFlow({
      actor: { orgId: contract?.org_id ?? null, source: "cron" },
      action: "delete",
      component: "internal.document-processing.delete-superseded-artifacts",
      entityType: "contracts",
      entityId: finished.contract_id,
      targetMemberUuid: contract?.rights_holder_id ?? null,
      orgIds: contract?.org_id ? [contract.org_id] : [],
      purposeCode: "document_ocr_replacement_cleanup",
      legalBasis: "GDPR Art. 6(1)(b)/(f) og 9(2)(d)",
      dataCategories: ["contract_data", "document_data"],
      outcome: deleted === deletions.length ? "success" : "partial",
      correlationId: body.jobId,
      counts: { attempted: deletions.length, deleted, pendingRetry: deletions.length - deleted },
    });
  }

  return NextResponse.json({ ok: true, replayed: Boolean(error) });
}
