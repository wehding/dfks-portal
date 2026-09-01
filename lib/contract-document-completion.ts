export type DocumentCompletion = {
  status?: "completed" | "failed" | "needs_review" | "not_required";
  documentClassification?: "native_text" | "image_only" | "mixed" | "unreadable";
  ocrApplied?: boolean;
  processingProfile?: string | null;
  spatialSchemaVersion?: string | null;
  spatialVerificationProfile?: string | null;
  processedSha256?: string | null;
  spatialSha256?: string | null;
  errorCode?: string | null;
  reviewDetails?: unknown;
};

export const CURRENT_SPATIAL_VERIFICATION_PROFILE = "dfks-spatial-verification-v2-poppler22.12";

/**
 * A direct Vision v3 completion is promotable only when the worker explicitly
 * proves which deterministic geometry matcher produced the stored metrics.
 * Non-spatial callbacks must not smuggle an unrelated matcher claim.
 */
export function isSpatialVerificationCompletionValid(body: DocumentCompletion) {
  const directVisionV3 = body.processingProfile === "google-vision-direct-v1"
    && body.spatialSchemaVersion === "google-vision-spatial-v3";
  if (directVisionV3) {
    return body.spatialVerificationProfile === CURRENT_SPATIAL_VERIFICATION_PROFILE;
  }
  return body.spatialVerificationProfile == null;
}

export type ContractDocumentReviewDetails = {
  schemaVersion: 1;
  reasons: Array<{
    code: string;
    pageNumbers: number[];
  }>;
};

const CONTRACT_DOCUMENT_REVIEW_CODES = new Set([
  "ocr_no_readable_text",
  "ocr_unreadable_page",
  "ocr_spatial_quality",
  "orientation_uncertain",
  "page_geometry_unavailable",
  "dlp_response_too_large",
  "dlp_location_invalid",
  "dlp_location_out_of_bounds",
  "dlp_location_missing",
  "dlp_redacted_image_missing",
  "dlp_redacted_image_invalid",
  "dlp_redaction_not_applied",
  "dlp_image_dimensions_changed",
  "dlp_canonical_image_invalid",
  "document_text_limit_exceeded",
  "processed_file_too_large",
  "spatial_artifact_too_large",
  "vision_page_too_large",
  "vision_page_invalid",
  "vision_request_too_large",
  "vision_response_too_large",
  "vision_word_limit_exceeded",
  "document_page_limit_exceeded",
  "document_raster_budget_exceeded",
  "dlp_request_too_large",
  "dlp_too_many_locations",
  "file_too_large",
  "invalid_pdf",
  "invalid_download_origin",
  "original_sha256_mismatch",
  "processing_deadline_exceeded",
  "low_text_quality",
]);

export function isContractDocumentReviewCode(value: unknown): value is string {
  return typeof value === "string" && CONTRACT_DOCUMENT_REVIEW_CODES.has(value);
}

/**
 * Normalises the worker's page diagnostics to metadata that is safe to keep.
 * Contract text, geometry, filenames and storage identifiers are deliberately
 * not part of this type. Invalid diagnostics reject the completion callback
 * instead of being silently persisted.
 */
export function normaliseDocumentReviewDetails(
  value: unknown,
  pageCount: number | null,
  errorCode?: string | null,
): ContractDocumentReviewDetails {
  if (errorCode != null && !isContractDocumentReviewCode(errorCode)) {
    throw new TypeError("invalid_document_review_details");
  }
  if (value == null) {
    return {
      schemaVersion: 1,
      reasons: errorCode ? [{ code: errorCode, pageNumbers: [] }] : [],
    };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("invalid_document_review_details");
  }
  const input = value as { schemaVersion?: unknown; reasons?: unknown };
  if (Object.keys(input).some((key) => key !== "schemaVersion" && key !== "reasons")
    || input.schemaVersion !== 1 || !Array.isArray(input.reasons) || input.reasons.length > 20) {
    throw new TypeError("invalid_document_review_details");
  }
  const seenCodes = new Set<string>();
  const reasons = input.reasons.map((reason) => {
    if (typeof reason !== "object" || reason == null || Array.isArray(reason)) {
      throw new TypeError("invalid_document_review_details");
    }
    const candidate = reason as { code?: unknown; pageNumbers?: unknown };
    if (Object.keys(candidate).some((key) => key !== "code" && key !== "pageNumbers")
      || !isContractDocumentReviewCode(candidate.code)
      || seenCodes.has(candidate.code)
      || !Array.isArray(candidate.pageNumbers)
      || candidate.pageNumbers.length > 200) {
      throw new TypeError("invalid_document_review_details");
    }
    seenCodes.add(candidate.code);
    const pageNumbers = [...new Set(candidate.pageNumbers.map((pageNumber) => {
      if (!Number.isSafeInteger(pageNumber) || Number(pageNumber) < 1 || Number(pageNumber) > 200
        || (pageCount != null && Number(pageNumber) > pageCount)) {
        throw new TypeError("invalid_document_review_details");
      }
      return Number(pageNumber);
    }))].sort((first, second) => first - second);
    return { code: candidate.code, pageNumbers };
  });
  if (errorCode && !seenCodes.has(errorCode)) {
    reasons.push({ code: errorCode, pageNumbers: [] });
  }
  return { schemaVersion: 1, reasons };
}

const CONTRACT_DOCUMENT_CLASSIFICATIONS = new Set([
  "native_text",
  "image_only",
  "mixed",
  "unreadable",
]);

export function isContractDocumentClassification(value: unknown): value is NonNullable<DocumentCompletion["documentClassification"]> {
  return typeof value === "string" && CONTRACT_DOCUMENT_CLASSIFICATIONS.has(value);
}

export type StoredDocumentCompletion = {
  contract_id: string;
  status: string;
  lease_token: string | null;
  document_classification: string | null;
  ocr_applied: boolean;
  processed_sha256: string | null;
  spatial_sha256: string | null;
  error_code: string | null;
};

export function isIdempotentDocumentCompletionReplay(
  stored: StoredDocumentCompletion | null,
  body: DocumentCompletion,
) {
  if (!stored?.contract_id || stored.lease_token !== null || stored.status !== body.status) return false;
  if (body.status === "completed") {
    return stored.ocr_applied === true
      && stored.processed_sha256 === body.processedSha256
      && stored.spatial_sha256 === body.spatialSha256;
  }
  if (body.status === "not_required") {
    return stored.document_classification === "native_text";
  }
  return stored.error_code === (body.errorCode || null);
}

export function classifyDocumentCompletionFailure(errorCode?: string) {
  if (errorCode === "P0002") return { code: "completion_lease_inactive", status: 409 } as const;
  if (errorCode === "22023") return { code: "completion_integrity_rejected", status: 409 } as const;
  if (errorCode === "23505") return { code: "completion_generation_conflict", status: 409 } as const;
  return { code: "completion_persistence_failed", status: 503 } as const;
}
