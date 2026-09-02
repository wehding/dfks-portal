import assert from "node:assert/strict";
import test from "node:test";
import {
  affectedPagesText,
  CONTRACT_DOCUMENT_REVIEW_DESCRIPTORS,
  contractDocumentReviewActions,
  contractDocumentReviewDescriptor,
  sanitizeAffectedPageNumbers,
  sanitizeContractDocumentReviewErrorCode,
  sanitizeContractDocumentReviewDetails,
} from "../lib/contract-document-review";

const WORKER_SAFE_CODES = [
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
  "vision_response_too_large",
  "vision_word_limit_exceeded",
  "document_page_limit_exceeded",
  "document_raster_budget_exceeded",
  "dlp_request_too_large",
  "dlp_too_many_locations",
  "vision_page_too_large",
  "vision_request_too_large",
  "google_access_token_failed",
  "google_endpoint_rejected",
  "google_request_failed",
  "google_request_timeout",
  "google_response_invalid",
  "google_tls_version_rejected",
  "invalid_google_ocr_configuration",
  "invalid_pdf",
  "file_too_large",
  "invalid_download_origin",
  "original_sha256_mismatch",
  "processing_deadline_exceeded",
  "document_processing_failed",
] as const;

test("alle sikre worker-fejl har en konkret dansk beskrivelse og handling", () => {
  for (const code of WORKER_SAFE_CODES) {
    assert.ok(CONTRACT_DOCUMENT_REVIEW_DESCRIPTORS[code], `${code} mangler en beskrivelse`);
    const descriptor = contractDocumentReviewDescriptor(code);
    assert.notEqual(descriptor.title, "PDF'en kræver kontrol");
    assert.ok(descriptor.reason.length >= 20);
    assert.ok(["retry", "rescan", "technical"].includes(descriptor.recommendedAction));
  }
  assert.equal(contractDocumentReviewDescriptor("vision_api_503").recommendedAction, "technical");
  assert.equal(contractDocumentReviewDescriptor("ukendt hemmelig leverandørtekst").title, "PDF'en kræver kontrol");
  assert.equal(sanitizeContractDocumentReviewErrorCode("vision_api_503"), "vision_api_503");
  assert.equal(sanitizeContractDocumentReviewErrorCode("ukendt hemmelig leverandørtekst"), null);
});

test("sidehenvisninger er sorterede, afgrænsede og formuleret på dansk", () => {
  assert.deepEqual(sanitizeAffectedPageNumbers([7, 4, 7, 0, 13, "2"], 12), [4, 7]);
  assert.equal(affectedPagesText([]), "Kontrollen gælder hele dokumentet.");
  assert.equal(affectedPagesText([4]), "Side 4");
  assert.equal(affectedPagesText([7, 4]), "Side 4 og 7");
  assert.equal(affectedPagesText([11, 4, 7]), "Sider 4, 7 og 11");
});

test("review_details accepterer kun den kanoniske, dataminimerede shape", () => {
  assert.deepEqual(sanitizeContractDocumentReviewDetails({
    schemaVersion: 1,
    reasons: [
      { code: "orientation_uncertain", pageNumbers: [3, 1, 3, 8], ignoredText: "må ikke læses" },
      { code: "orientation_uncertain", pageNumbers: [2] },
      { code: "ocr_unreadable_page", pageNumbers: [4] },
      { code: "CPR 010101-1234", pageNumbers: [1] },
    ],
    rawText: "må ikke returneres",
  }, 4), {
    schemaVersion: 1,
    reasons: [
      { code: "orientation_uncertain", pageNumbers: [1, 2, 3] },
      { code: "ocr_unreadable_page", pageNumbers: [4] },
    ],
  });
  assert.deepEqual(sanitizeContractDocumentReviewDetails({
    error_code: "orientation_uncertain",
    page_numbers: [1],
  }, 4), { schemaVersion: 1, reasons: [] });
  assert.deepEqual(sanitizeContractDocumentReviewDetails({ schemaVersion: 2, reasons: [] }, 4), {
    schemaVersion: 1,
    reasons: [],
  });
});

test("action matrix forhindrer gentagelse efter rescan og beskytter validerede kontrakter", () => {
  assert.deepEqual(contractDocumentReviewActions({
    status: "needs_review",
    errorCode: "ocr_spatial_quality",
    contractStatus: "kladde",
    hasRightsHolder: true,
    hasJob: true,
  }), { recommendedAction: "retry", canRetry: true, canRequestRescan: false });

  assert.deepEqual(contractDocumentReviewActions({
    status: "needs_review",
    errorCode: "ocr_unreadable_page",
    contractStatus: "kladde",
    hasRightsHolder: true,
    hasJob: true,
  }), { recommendedAction: "rescan", canRetry: false, canRequestRescan: true });

  assert.deepEqual(contractDocumentReviewActions({
    status: "needs_review",
    errorCode: "orientation_uncertain",
    contractStatus: "kladde",
    hasRightsHolder: true,
    hasJob: true,
  }), { recommendedAction: "rescan", canRetry: false, canRequestRescan: true });

  for (const code of [
    "ocr_spatial_quality",
    "dlp_location_invalid",
    "processed_file_too_large",
    "vision_page_too_large",
    "vision_response_too_large",
  ]) {
    assert.equal(contractDocumentReviewActions({
      status: "needs_review",
      errorCode: code,
      contractStatus: "kladde",
      hasRightsHolder: true,
      hasJob: true,
    }).canRetry, true, `${code} skal kunne prøves igen`);
  }

  for (const code of ["page_geometry_unavailable", "vision_request_too_large", "document_text_limit_exceeded"]) {
    assert.equal(contractDocumentReviewActions({
      status: "needs_review",
      errorCode: code,
      contractStatus: "kladde",
      hasRightsHolder: true,
      hasJob: true,
    }).canRetry, false, `${code} må ikke sættes i automatisk genkø`);
  }

  assert.deepEqual(contractDocumentReviewActions({
    status: "needs_review",
    errorCode: "ocr_spatial_quality",
    reviewDisposition: "rescan_requested",
    contractStatus: "kladde",
    hasRightsHolder: true,
    hasJob: true,
  }), { recommendedAction: "retry", canRetry: false, canRequestRescan: false });

  assert.deepEqual(contractDocumentReviewActions({
    status: "needs_review",
    errorCode: "ocr_unreadable_page",
    reviewDisposition: "manual_review_required",
    contractStatus: "kladde",
    hasRightsHolder: true,
    hasJob: true,
  }), { recommendedAction: "rescan", canRetry: false, canRequestRescan: true });

  assert.deepEqual(contractDocumentReviewActions({
    status: "needs_review",
    errorCode: "ocr_spatial_quality",
    reviewDisposition: "manual_review_required",
    contractStatus: "kladde",
    hasRightsHolder: true,
    hasJob: true,
  }), { recommendedAction: "retry", canRetry: false, canRequestRescan: false });

  assert.equal(contractDocumentReviewActions({
    status: "needs_review",
    errorCode: "ocr_spatial_quality",
    contractStatus: "valideret",
    hasRightsHolder: true,
    hasJob: true,
  }).canRequestRescan, false);

  assert.deepEqual(contractDocumentReviewActions({
    status: "failed",
    errorCode: "ocr_spatial_quality",
    contractStatus: "kladde",
    hasRightsHolder: true,
    hasJob: true,
  }), { recommendedAction: "retry", canRetry: false, canRequestRescan: false });
});
