import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyDocumentCompletionFailure,
  isContractDocumentClassification,
  isIdempotentDocumentCompletionReplay,
} from "../lib/contract-document-completion";

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
