import { NextResponse } from "next/server";

import { verifyOcrCloudRunRequest } from "@/lib/server/cloud-run-identity";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Completion = {
  jobId?: string;
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
  redactionCounts?: Record<string, number>;
  spatialAccuracyScore?: number | null;
  spatialMedianIou?: number | null;
  spatialCenterInsideRatio?: number | null;
  originalSha256?: string | null;
  processedSha256?: string | null;
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
  if (!body.jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.jobId)
    || !["completed", "failed", "needs_review", "not_required"].includes(body.status ?? "")) {
    return NextResponse.json({ error: "Ugyldig jobstatus" }, { status: 400 });
  }
  const corrections = Array.isArray(body.orientationCorrections)
    ? body.orientationCorrections.slice(0, 500).filter((entry) =>
      Number.isInteger(entry.page) && entry.page > 0 && [90, 180, 270].includes(entry.degrees))
    : [];
  const db = createServiceClient({ audit: { source: "cron", correlationId: body.jobId, mode: "summary" } });
  const safeCount = (value: unknown) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10_000 ? Number(value) : 0;
  const safeRatio = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  const safeHash = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
  const redactionCounts = Object.fromEntries(Object.entries(body.redactionCounts ?? {})
    .filter(([key, value]) => /^[A-Z_]{2,60}$/.test(key) && Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100_000)
    .slice(0, 20));
  const { data: finished, error } = await db.rpc("finish_contract_document_job_v2", {
    p_job_id: body.jobId,
    p_status: body.status,
    p_document_classification: body.documentClassification ?? null,
    p_ocr_engine: body.ocrEngine?.slice(0, 80) || null,
    p_orientation_corrections: corrections,
    p_ocr_applied: Boolean(body.ocrApplied),
    p_page_count: Number.isInteger(body.pageCount) && Number(body.pageCount) >= 1 && Number(body.pageCount) <= 10_000 ? body.pageCount : null,
    p_text_char_count: Number.isInteger(body.textCharCount) && Number(body.textCharCount) >= 0 && Number(body.textCharCount) <= 100_000_000 ? body.textCharCount : null,
    p_native_page_count: safeCount(body.nativePageCount),
    p_ocr_page_count: safeCount(body.ocrPageCount),
    p_unreadable_page_count: safeCount(body.unreadablePageCount),
    p_redaction_counts: redactionCounts,
    p_spatial_accuracy_score: safeRatio(body.spatialAccuracyScore),
    p_spatial_median_iou: safeRatio(body.spatialMedianIou),
    p_spatial_center_inside_ratio: safeRatio(body.spatialCenterInsideRatio),
    p_original_sha256: safeHash(body.originalSha256),
    p_processed_sha256: safeHash(body.processedSha256),
    p_error_code: body.errorCode?.slice(0, 80) || null,
    p_safe_error_message: body.safeErrorMessage?.slice(0, 500) || null,
  });
  if (error || !finished?.contract_id) {
    return NextResponse.json({ error: "Dokumentjobbet kunne ikke afsluttes" }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
