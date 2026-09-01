import assert from "node:assert/strict";
import test from "node:test";

import {
  CURRENT_SPATIAL_VERIFICATION_PROFILE,
  classifyDocumentCompletionFailure,
  isContractDocumentClassification,
  isIdempotentDocumentCompletionReplay,
  isSpatialVerificationCompletionValid,
  normaliseDocumentReviewDetails,
} from "../lib/contract-document-completion";
import {
  SPATIAL_VERIFICATION_PROFILE,
  V2_SPATIAL_VERIFICATION_PROFILE,
} from "../cloud-run/contract-document-worker/spatial-ocr.mjs";

test("worker og portal bruger samme faste spatial-verifikationsprofil", () => {
  assert.equal(CURRENT_SPATIAL_VERIFICATION_PROFILE, SPATIAL_VERIFICATION_PROFILE);
  assert.equal(isSpatialVerificationCompletionValid({
    processingProfile: "google-vision-direct-v1",
    spatialSchemaVersion: "google-vision-spatial-v3",
    spatialVerificationProfile: CURRENT_SPATIAL_VERIFICATION_PROFILE,
  }), true);
  for (const spatialVerificationProfile of [
    undefined,
    null,
    "dfks-spatial-verification-legacy-v1",
    V2_SPATIAL_VERIFICATION_PROFILE,
    "ukendt",
  ] as const) {
    assert.equal(isSpatialVerificationCompletionValid({
      processingProfile: "google-vision-direct-v1",
      spatialSchemaVersion: "google-vision-spatial-v3",
      spatialVerificationProfile,
    }), false);
  }
  assert.equal(isSpatialVerificationCompletionValid({
    processingProfile: null,
    spatialSchemaVersion: null,
    spatialVerificationProfile: null,
  }), true);
  assert.equal(isSpatialVerificationCompletionValid({
    processingProfile: null,
    spatialSchemaVersion: null,
    spatialVerificationProfile: CURRENT_SPATIAL_VERIFICATION_PROFILE,
  }), false);
});

test("completion accepterer kun databasegodkendte dokumentklasser", () => {
  for (const value of ["native_text", "image_only", "mixed", "unreadable"]) {
    assert.equal(isContractDocumentClassification(value), true);
  }
  for (const value of ["orientation_uncertain", "", null, undefined, 42]) {
    assert.equal(isContractDocumentClassification(value), false);
  }
});

const completed = {
  contract_id: "contract",
  status: "completed",
  lease_token: null,
  document_classification: "image_only",
  ocr_applied: true,
  processed_sha256: "a".repeat(64),
  spatial_sha256: "b".repeat(64),
  error_code: null,
};

test("completion-replay kræver samme terminale integritetsbevis", () => {
  assert.equal(isIdempotentDocumentCompletionReplay(completed, {
    status: "completed",
    processedSha256: "a".repeat(64),
    spatialSha256: "b".repeat(64),
  }), true);
  assert.equal(isIdempotentDocumentCompletionReplay(completed, {
    status: "completed",
    processedSha256: "c".repeat(64),
    spatialSha256: "b".repeat(64),
  }), false);
  assert.equal(isIdempotentDocumentCompletionReplay({ ...completed, lease_token: "active" }, {
    status: "completed",
    processedSha256: "a".repeat(64),
    spatialSha256: "b".repeat(64),
  }), false);
});

test("ikke-OCR og fejlreplays kræver samme terminale resultat", () => {
  assert.equal(isIdempotentDocumentCompletionReplay({
    ...completed,
    status: "not_required",
    document_classification: "native_text",
    ocr_applied: false,
    processed_sha256: null,
    spatial_sha256: null,
  }, { status: "not_required" }), true);
  assert.equal(isIdempotentDocumentCompletionReplay({
    ...completed,
    status: "needs_review",
    ocr_applied: false,
    processed_sha256: null,
    spatial_sha256: null,
    error_code: "dlp_location_missing",
  }, { status: "needs_review", errorCode: "dlp_location_missing" }), true);
});

test("databasefejl bliver til faste ufølsomme callbackkoder", () => {
  assert.deepEqual(classifyDocumentCompletionFailure("P0002"), {
    code: "completion_lease_inactive",
    status: 409,
  });
  assert.deepEqual(classifyDocumentCompletionFailure("22023"), {
    code: "completion_integrity_rejected",
    status: 409,
  });
  assert.deepEqual(classifyDocumentCompletionFailure("23505"), {
    code: "completion_generation_conflict",
    status: 409,
  });
  assert.deepEqual(classifyDocumentCompletionFailure("unknown"), {
    code: "completion_persistence_failed",
    status: 503,
  });
});

test("sidediagnostik gemmer kun sikre koder og gyldige sidenumre", () => {
  assert.deepEqual(normaliseDocumentReviewDetails({
    schemaVersion: 1,
    reasons: [{
      code: "ocr_unreadable_page",
      pageNumbers: [7, 2, 7],
    }],
  }, 8), {
    schemaVersion: 1,
    reasons: [{ code: "ocr_unreadable_page", pageNumbers: [2, 7] }],
  });
  assert.deepEqual(normaliseDocumentReviewDetails(undefined, 8), {
    schemaVersion: 1,
    reasons: [],
  });
  assert.deepEqual(normaliseDocumentReviewDetails(undefined, 8, "dlp_request_too_large"), {
    schemaVersion: 1,
    reasons: [{ code: "dlp_request_too_large", pageNumbers: [] }],
  });
  assert.deepEqual(normaliseDocumentReviewDetails({
    schemaVersion: 1,
    reasons: [{ code: "ocr_unreadable_page", pageNumbers: [2] }],
  }, 8, "ocr_unreadable_page"), {
    schemaVersion: 1,
    reasons: [{ code: "ocr_unreadable_page", pageNumbers: [2] }],
  });
});

test("sidediagnostik afviser tekst, ukendte koder og sider uden for dokumentet", () => {
  for (const invalid of [
    { schemaVersion: 1, reasons: [{ code: "ocr_unreadable_page", pageNumbers: [0] }] },
    { schemaVersion: 1, reasons: [{ code: "ocr_unreadable_page", pageNumbers: [9] }] },
    { schemaVersion: 1, reasons: [{ code: "document_text", pageNumbers: [1] }] },
    { schemaVersion: 1, reasons: [{ code: "ocr_unreadable_page", pageNumbers: [1], text: "hemmelig" }] },
  ]) {
    assert.throws(
      () => normaliseDocumentReviewDetails(invalid, 8),
      /invalid_document_review_details/,
    );
  }
  assert.throws(
    () => normaliseDocumentReviewDetails(undefined, 8, "ukendt_fejl"),
    /invalid_document_review_details/,
  );
});
