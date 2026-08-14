import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { classifyPdfSignatureIndicators, detectPdfSignature } from "../lib/pdf-signature-detection";
import { renderPdfPageText } from "../lib/pdf-parse";

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

test("PDF worker loads locally for a generated PDF", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.addPage();
  const buffer = Buffer.from(await pdf.save({ useObjectStreams: false }));

  const signature = await detectPdfSignature(buffer);
  assert.equal(signature.status, "unknown");
});

test("PDF page renderer preserves line and page boundaries", async () => {
  const first = await renderPdfPageText({
    pageIndex: 0,
    getTextContent: async () => ({ items: [
      { str: "Foerste ", transform: [1, 0, 0, 1, 0, 700] },
      { str: "linje", transform: [1, 0, 0, 1, 40, 700] },
      { str: "Anden linje", transform: [1, 0, 0, 1, 0, 680] },
    ] }),
  });
  const second = await renderPdfPageText({
    pageIndex: 1,
    getTextContent: async () => ({ items: [{ str: "Sidste side", transform: [1, 0, 0, 1, 0, 700] }] }),
  });
  assert.equal(first, "Foerste linje\nAnden linje");
  assert.equal(second, "\fSidste side");
});
