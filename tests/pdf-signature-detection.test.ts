import test from "node:test";
import assert from "node:assert/strict";
import { classifyPdfSignatureIndicators } from "../lib/pdf-signature-detection";

test("digital PDF signature takes precedence", () => {
  assert.deepEqual(classifyPdfSignatureIndicators({
    hasCryptographicSignature: true,
    hasSignatureWidget: false,
    digitalSignatureTextPage: null,
    handwrittenPathPage: 2,
  }), {
    status: "yes",
    method: "digital",
    page: null,
    evidence: "Digital underskrift registreret lokalt i PDF'en.",
  });
});

test("handwritten PDF strokes identify page", () => {
  assert.deepEqual(classifyPdfSignatureIndicators({
    hasCryptographicSignature: false,
    hasSignatureWidget: false,
    digitalSignatureTextPage: null,
    handwrittenPathPage: 2,
  }), {
    status: "yes",
    method: "handwritten",
    page: 2,
    evidence: "Håndskrevet underskrift registreret lokalt på side 2.",
  });
});

test("absence of reliable signature evidence remains unknown", () => {
  assert.equal(classifyPdfSignatureIndicators({
    hasCryptographicSignature: false,
    hasSignatureWidget: false,
    digitalSignatureTextPage: null,
    handwrittenPathPage: null,
  }).status, "unknown");
});
