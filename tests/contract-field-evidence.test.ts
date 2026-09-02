import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { mergeContractEvidence, resolveNativeLayoutEvidence, resolveSpatialV3Evidence, type SpatialV3Artifact } from "../lib/contract-field-evidence";
import { evidenceBboxToViewportRect } from "../lib/contract-workbench";
import { parseVerifiedSpatialV3Artifact } from "../lib/server/contract-spatial-artifact";

test("Spatial v3 finder et entydigt, kompakt kildeudsnit", () => {
  const artifact: SpatialV3Artifact = {
    schemaVersion: "google-vision-spatial-v3",
    spatialVerification: { passed: true, score: 0.99 },
    pages: [{
      pageNumber: 2,
      imageWidth: 1000,
      imageHeight: 1400,
      words: [
        { text: "Producent", confidence: 0.99, vertices: [{ x: 100, y: 200 }, { x: 220, y: 230 }] },
        { text: "Sequoia", confidence: 0.98, vertices: [{ x: 240, y: 200 }, { x: 350, y: 230 }] },
        { text: "ApS", confidence: 0.99, vertices: [{ x: 360, y: 200 }, { x: 410, y: 230 }] },
      ],
    }],
  };
  const evidence = resolveSpatialV3Evidence({ employerName: "Producent Sequoia ApS" }, artifact).employerName;
  assert.equal(evidence.page, 2);
  assert.equal(evidence.coordinateSource, "spatial_v3");
  assert.deepEqual(evidence.bbox, { x: 0.1, y: 0.14285714285714285, width: 0.31, height: 0.02142857142857143, space: "normalized_top_left" });
});

test("Spatial v3 afviser tvetydige citater", () => {
  const words = [
    { text: "Copydan", vertices: [{ x: 10, y: 10 }, { x: 70, y: 30 }] },
    { text: "Copydan", vertices: [{ x: 10, y: 100 }, { x: 70, y: 120 }] },
  ];
  const artifact: SpatialV3Artifact = { schemaVersion: "google-vision-spatial-v3", pages: [{ pageNumber: 1, imageWidth: 100, imageHeight: 200, words }] };
  assert.deepEqual(resolveSpatialV3Evidence({ copydan: "Copydan" }, artifact), {});
});

test("Native PDF-layout bruges som fallback, mens Spatial v3 vinder", () => {
  const native = resolveNativeLayoutEvidence({ employerName: "Sequoia ApS" }, {
    type: "pdf",
    pageCount: 1,
    fragmentCount: 2,
    clauses: [{ id: "s1_c1", page: 1, text: "Producent Sequoia ApS", bold: false, numbered: false, pdfBbox: { x: 12, y: 700, width: 140, height: 15 } }],
  });
  assert.equal(native.employerName.coordinateSource, "native_pdf");
  const spatial = { employerName: { ...native.employerName, coordinateSource: "spatial_v3" as const } };
  assert.equal(mergeContractEvidence({}, native, spatial).employerName.coordinateSource, "spatial_v3");
});

test("Normaliseret Spatial-boks konverteres direkte til viewport", () => {
  assert.deepEqual(evidenceBboxToViewportRect(
    { x: 0.1, y: 0.2, width: 0.3, height: 0.1, space: "normalized_top_left" },
    { pdfWidth: 500, pdfHeight: 700, renderedWidth: 1000, renderedHeight: 1400 },
  ), { left: 100, top: 280, width: 300, height: 140 });
});

test("Spatial v3-artefakter kræver korrekt SHA-256", () => {
  const compressed = gzipSync(JSON.stringify({ schemaVersion: "google-vision-spatial-v3", pages: [] }));
  const sha = createHash("sha256").update(compressed).digest("hex");
  assert.equal(parseVerifiedSpatialV3Artifact(compressed, sha).schemaVersion, "google-vision-spatial-v3");
  assert.throws(() => parseVerifiedSpatialV3Artifact(compressed, "0".repeat(64)), /hash stemmer ikke/);
});
