export type DocumentCompletion = {
  status?: "completed" | "failed" | "needs_review" | "not_required";
  documentClassification?: "native_text" | "image_only" | "mixed" | "unreadable";
  ocrApplied?: boolean;
  processedSha256?: string | null;
  spatialSha256?: string | null;
  errorCode?: string | null;
};

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
