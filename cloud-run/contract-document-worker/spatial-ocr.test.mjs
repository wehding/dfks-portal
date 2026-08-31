import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  classifyPageText,
  computeSpatialAccuracy,
  correctPageOrientation,
  detectPhysicalOrientation,
  enforceVisionWordLimits,
  isPdfImagesInventoryReliable,
  pageRasterEvidence,
  parsePdfImagesList,
  parsePdftotextBbox,
  readTextArtifactWithinLimit,
} from "./spatial-ocr.mjs";
import { GoogleOcrOperationalError } from "./google-secure-api.mjs";

test("native tekst og billedside klassificeres forskelligt", () => {
  const nativeText = Array.from(
    { length: 30 },
    (_, index) => `Kontraktens tydelige native tekst nummer ${index + 1}`,
  ).join(" ");
  assert.equal(classifyPageText(nativeText).classification, "native_text");
  assert.equal(classifyPageText("Kort skjult tekstlag med otte ord må ikke være nok.").classification, "mixed");
  assert.equal(classifyPageText(nativeText, {
    imageEvidence: { fullPageRaster: true, coverage: 0.98 },
  }).classification, "mixed");
  assert.equal(classifyPageText(nativeText, { rasterInspectionReliable: false }).classification, "mixed");
  assert.equal(classifyPageText("").classification, "image_only");
});

test("pdfimages afslører helsides scan bag et skjult tekstlag", () => {
  const images = parsePdfImagesList(`
page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio
1 0 image 2550 3300 gray 1 8 jpeg no 10 0 300 300 100K 1.0%
1 1 smask 2550 3300 gray 1 8 image no 10 0 300 300 100K 1.0%
  `);
  const evidence = pageRasterEvidence(images, { widthPoints: 612, heightPoints: 792 });
  assert.equal(images.length, 2);
  assert.equal(evidence.imageCount, 1);
  assert.equal(evidence.fullPageRaster, true);
  assert.ok(evidence.coverage > 0.99);
  assert.equal(isPdfImagesInventoryReliable("unexpected localized output"), false);
  assert.equal(isPdfImagesInventoryReliable(`
page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio
  `), true);
});

function orientedPage(degrees) {
  const vectors = { 0: [20, 0], 90: [0, 20], 180: [-20, 0], 270: [0, -20] };
  const [dx, dy] = vectors[degrees];
  return {
    pageNumber: 1,
    imageWidth: 100,
    imageHeight: 200,
    words: Array.from({ length: 4 }, (_, index) => ({
      text: `Ord${index}`,
      confidence: 0.99,
      vertices: [
        { x: 40, y: 80 }, { x: 40 + dx, y: 80 + dy },
        { x: 40 + dx - dy / 2, y: 80 + dy + dx / 2 },
        { x: 40 - dy / 2, y: 80 + dx / 2 },
      ],
    })),
  };
}

test("fysisk 90, 180 og 270 graders tekstretning detekteres og rettes", () => {
  for (const detected of [90, 180, 270]) {
    const page = orientedPage(detected);
    const orientation = detectPhysicalOrientation(page);
    assert.equal(orientation.reliable, true);
    assert.equal(orientation.detectedDegrees, detected);
    assert.equal(orientation.correctionDegrees, detected);
    const corrected = correctPageOrientation(page, orientation.correctionDegrees);
    const correctedOrientation = detectPhysicalOrientation(corrected);
    assert.equal(correctedOrientation.detectedDegrees, 0);
    assert.equal(correctedOrientation.reliable, true);
    assert.equal(corrected.imageWidth, detected % 180 === 0 ? 100 : 200);
    assert.equal(corrected.imageHeight, detected % 180 === 0 ? 200 : 100);
  }
});

test("modstridende fysiske tekstretninger afvises fail-closed", () => {
  const page = orientedPage(90);
  page.words.push(...orientedPage(270).words);
  assert.equal(detectPhysicalOrientation(page).reliable, false);
});

test("geometrisk præcision måles mod PDF-tekstlaget", () => {
  const extracted = parsePdftotextBbox('<page width="100" height="100"><word xMin="10" yMin="20" xMax="30" yMax="30">Hej</word></page>');
  const geometry = [{ pageNumber: 1, imageWidth: 100, imageHeight: 100, words: [{ text: "Hej", vertices: [
    { x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 10, y: 30 },
  ] }] }];
  const result = computeSpatialAccuracy(geometry, extracted);
  assert.equal(result.passed, true);
  assert.equal(result.expectedWords, 1);
  assert.equal(result.matchedWords, 1);
  assert.equal(result.matchCoverage, 1);
  assert.equal(result.score, 1);
  assert.equal(result.medianIou, 1);
});

test("99 procent manglende ord kan ikke give falsk spatial godkendelse", () => {
  const words = Array.from({ length: 100 }, (_, index) => ({
    text: `Ord${index}`,
    vertices: [
      { x: 1, y: index + 1 }, { x: 20, y: index + 1 },
      { x: 20, y: index + 2 }, { x: 1, y: index + 2 },
    ],
  }));
  const geometry = [{ pageNumber: 1, imageWidth: 100, imageHeight: 200, words }];
  const extracted = [{
    width: 100,
    height: 200,
    words: [{ xMin: 1, yMin: 1, xMax: 20, yMax: 2, text: "Ord0" }],
  }];

  const result = computeSpatialAccuracy(geometry, extracted);
  assert.equal(result.expectedWords, 100);
  assert.equal(result.matchedWords, 1);
  assert.equal(result.matchCoverage, 0.01);
  assert.equal(result.score, 0.01);
  assert.equal(result.passed, false);
});

test("textbomb afvises før hele pdftotext-outputtet læses", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dfks-text-cap-"));
  const path = join(directory, "text.txt");
  try {
    await writeFile(path, "A".repeat(65));
    await assert.rejects(
      () => readTextArtifactWithinLimit(path, 64),
      (error) => error instanceof GoogleOcrOperationalError
        && error.code === "document_text_limit_exceeded",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ordtunge Vision-svar afvises pr. side og samlet", () => {
  const word = { text: "ord", vertices: [] };
  assert.throws(
    () => enforceVisionWordLimits([{ words: [word, word, word] }], {
      maxVisionWordsPerPage: 2,
    }),
    (error) => error instanceof GoogleOcrOperationalError
      && error.code === "vision_word_limit_exceeded",
  );
  assert.throws(
    () => enforceVisionWordLimits([{ words: [word, word] }, { words: [word, word] }], {
      maxVisionWordsPerPage: 2,
      maxVisionWordsTotal: 3,
    }),
    (error) => error instanceof GoogleOcrOperationalError
      && error.code === "vision_word_limit_exceeded",
  );
});
