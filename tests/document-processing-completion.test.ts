import assert from "node:assert/strict";
import test from "node:test";

import {
  completionFailure,
  isIdempotentReplay,
} from "../app/api/internal/document-processing/complete/route";

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
  assert.equal(isIdempotentReplay(completed, {
    status: "completed",
    processedSha256: "a".repeat(64),
    spatialSha256: "b".repeat(64),
  }), true);
  assert.equal(isIdempotentReplay(completed, {
    status: "completed",
    processedSha256: "c".repeat(64),
    spatialSha256: "b".repeat(64),
  }), false);
  assert.equal(isIdempotentReplay({ ...completed, lease_token: "active" }, {
    status: "completed",
    processedSha256: "a".repeat(64),
    spatialSha256: "b".repeat(64),
  }), false);
});

test("ikke-OCR og fejlreplays kræver samme terminale resultat", () => {
  assert.equal(isIdempotentReplay({
    ...completed,
    status: "not_required",
    document_classification: "native_text",
    ocr_applied: false,
    processed_sha256: null,
    spatial_sha256: null,
  }, { status: "not_required" }), true);
  assert.equal(isIdempotentReplay({
    ...completed,
    status: "needs_review",
    ocr_applied: false,
    processed_sha256: null,
    spatial_sha256: null,
    error_code: "dlp_location_missing",
  }, { status: "needs_review", errorCode: "dlp_location_missing" }), true);
});

test("databasefejl bliver til faste ufølsomme callbackkoder", () => {
  assert.deepEqual(completionFailure("P0002"), {
    code: "completion_lease_inactive",
    status: 409,
  });
  assert.deepEqual(completionFailure("22023"), {
    code: "completion_integrity_rejected",
    status: 409,
  });
  assert.deepEqual(completionFailure("23505"), {
    code: "completion_generation_conflict",
    status: 409,
  });
  assert.deepEqual(completionFailure("unknown"), {
    code: "completion_persistence_failed",
    status: 503,
  });
});
