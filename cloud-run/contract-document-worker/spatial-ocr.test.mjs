import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";

import {
  classifyOcrDocument,
  classifyPageText,
  classifyRasterBlankness,
  computeSpatialAccuracy,
  correctPageOrientation,
  detectPhysicalOrientation,
  enforceVisionWordLimits,
  isPdfImagesInventoryReliable,
  mapVisionPageToCanonical,
  pageRasterEvidence,
  parsePdfImagesList,
  parsePdftotextBbox,
  processPdfSpatially,
  readTextArtifactWithinLimit,
} from "./spatial-ocr.mjs";
import { GoogleOcrOperationalError } from "./google-vision-api.mjs";

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

test("kort men pålideligt digitalt tekstlag genkendes uden at stole på helsides raster", () => {
  const sparseText = "Denne aftale gælder i hele perioden og kan opsiges med skriftligt varsel.";
  const sparse = classifyPageText(sparseText, {
    imageEvidence: { fullPageRaster: false, coverage: 0, imageCount: 0 },
  });
  assert.equal(sparse.classification, "native_text");
  assert.equal(sparse.nativeTextConfidence, "sparse");
  assert.equal(classifyPageText(sparseText, {
    imageEvidence: { fullPageRaster: true, coverage: 0.98, imageCount: 1 },
  }).classification, "mixed");
});

test("kun konservativt tomme rastere fritages fra ulæselig-kontrollen", () => {
  const nearlyWhite = Array(256).fill(0);
  nearlyWhite[255] = 9_976;
  nearlyWhite[240] = 14;
  nearlyWhite[0] = 10;
  assert.equal(classifyRasterBlankness({
    histogram: nearlyWhite, mean: 254.6, stdev: 5,
  }).blank, true);
  assert.equal(classifyRasterBlankness({
    histogram: nearlyWhite,
    mean: 254.6,
    stdev: 5,
    maxLocalNonWhiteRatio: 0.08,
    maxLocalDarkRatio: 0.02,
  }).blank, false);

  const sparseSignature = Array(256).fill(0);
  sparseSignature[255] = 9_960;
  sparseSignature[0] = 40;
  assert.equal(classifyRasterBlankness({
    histogram: sparseSignature, mean: 254, stdev: 10,
  }).blank, false);
  assert.equal(classifyRasterBlankness({ histogram: [], mean: 255, stdev: 0 }).blank, false);
});

test("verificeret blank side bevares uden at stoppe et ellers læsbart dokument", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dfks-blank-page-"));
  try {
    const whiteJpeg = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "white" },
    }).jpeg({ quality: 95 }).toBuffer();
    const runner = async (command, args) => {
      if (command === "pdfinfo") {
        return { stdout: "Pages: 2\nPage    1 size: 612 x 792 pts\n", stderr: "" };
      }
      if (command === "pdfimages") {
        return {
          stdout: "page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio\n",
          stderr: "",
        };
      }
      if (command === "pdftoppm") {
        await writeFile(`${args.at(-1)}.jpg`, whiteJpeg);
        return { stdout: "", stderr: "" };
      }
      if (command === "pdftotext") {
        const target = args.at(-1);
        if (args.includes("-bbox-layout")) {
          await writeFile(target, `<page width="612" height="792">
            <word xMin="61.2" yMin="79.2" xMax="183.6" yMax="158.4">Ord1</word>
            <word xMin="61.2" yMin="237.6" xMax="183.6" yMax="316.8">Ord2</word>
            <word xMin="61.2" yMin="396" xMax="183.6" yMax="475.2">Ord3</word>
          </page><page width="612" height="792"></page>`);
        } else if (args[0] === "-f") {
          await writeFile(target, "");
        } else {
          await writeFile(target, "A".repeat(200));
        }
        return { stdout: "", stderr: "" };
      }
      if (command === "python3" && args[0].endsWith("normalise_orientation.py")) {
        await writeFile(args[2], whiteJpeg);
        return { stdout: "", stderr: "" };
      }
      if (command === "python3" && args[0].endsWith("vision_overlay.py")) {
        assert.equal(args[5], String(25 * 1024 * 1024));
        await writeFile(args[4], "%PDF-blank-test");
        return { stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command ${command}`);
    };
    const word = (text, top) => ({
      confidence: 0.99,
      boundingBox: { vertices: [
        { x: 10, y: top }, { x: 30, y: top },
        { x: 30, y: top + 10 }, { x: 10, y: top + 10 },
      ] },
      symbols: text.split("").map((symbol) => ({ text: symbol })),
    });
    const result = await processPdfSpatially({
      inputPath: join(directory, "input.pdf"),
      outputPath: join(directory, "output.pdf"),
      geometryPath: join(directory, "geometry.json.gz"),
      workDir: directory,
      commandRunner: runner,
      googleClient: {
        async annotateDocument() {
          return {
            responses: [
              { fullTextAnnotation: { pages: [{
                width: 100, height: 100,
                blocks: [{ paragraphs: [{ words: [word("Ord1", 10), word("Ord2", 30), word("Ord3", 50)] }] }],
              }] } },
              { fullTextAnnotation: { pages: [] } },
            ],
            sourcePages: [
              { pageNumber: 1, imageBytes: whiteJpeg },
              { pageNumber: 2, imageBytes: whiteJpeg },
            ],
            visionPageTransforms: [1, 2].map((pageNumber) => ({
              pageNumber,
              sourceWidth: 100,
              sourceHeight: 100,
              visionWidth: 100,
              visionHeight: 100,
            })),
          };
        },
      },
    });
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.blankPageCount, 1);
    assert.equal(result.unreadablePageCount, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("OCR-dokumentklasse bruger kun databasegodkendte kildeklasser", () => {
  assert.equal(classifyOcrDocument([
    { classification: "image_only" },
    { classification: "image_only" },
  ]), "image_only");
  assert.equal(classifyOcrDocument([
    { classification: "native_text" },
    { classification: "image_only" },
  ]), "mixed");
  assert.equal(classifyOcrDocument([
    { classification: "mixed" },
  ]), "mixed");
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

test("mange små rasterfliser kan ikke skjule en scannet side som native tekst", () => {
  const tile = {
    pageNumber: 1,
    type: "image",
    width: 128,
    height: 128,
    xPpi: 144,
    yPpi: 144,
  };
  const evidence = pageRasterEvidence(
    Array.from({ length: 96 }, () => ({ ...tile })),
    { widthPoints: 612, heightPoints: 792 },
  );
  assert.equal(evidence.imageCount, 96);
  assert.equal(evidence.fullPageRaster, true);
  assert.equal(evidence.coverage >= 0.72, true);
});

test("Vision-ord fra transportkopien mappes tilbage til den kanoniske kildeside", () => {
  const mapped = mapVisionPageToCanonical({
    pageNumber: 3,
    imageWidth: 1_600,
    imageHeight: 1_200,
    words: [{ text: "Aftale", confidence: 0.99, vertices: [
      { x: 100, y: 200 }, { x: 300, y: 200 },
      { x: 300, y: 260 }, { x: 100, y: 260 },
    ] }],
  }, {
    pageNumber: 3,
    sourceWidth: 3_200,
    sourceHeight: 2_400,
    visionWidth: 1_600,
    visionHeight: 1_200,
  });
  assert.equal(mapped.imageWidth, 3_200);
  assert.equal(mapped.imageHeight, 2_400);
  assert.deepEqual(mapped.words[0].vertices, [
    { x: 200, y: 400 }, { x: 600, y: 400 },
    { x: 600, y: 520 }, { x: 200, y: 520 },
  ]);
  assert.throws(() => mapVisionPageToCanonical({
    pageNumber: 3, imageWidth: 1_500, imageHeight: 1_200, words: [],
  }, {
    pageNumber: 3,
    sourceWidth: 3_200,
    sourceHeight: 2_400,
    visionWidth: 1_600,
    visionHeight: 1_200,
  }), /vision_page_dimension_mismatch/);
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

test("gentagne ord matches samlet i stedet for med en grådig kaskade", () => {
  const geometry = [{
    pageNumber: 1,
    imageWidth: 20,
    imageHeight: 10,
    words: [
      { text: "og", vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
      { text: "og", vertices: [{ x: 1, y: 0 }, { x: 11, y: 0 }, { x: 11, y: 10 }, { x: 1, y: 10 }] },
    ],
  }];
  const extracted = [{
    width: 20,
    height: 10,
    words: [
      { text: "og", xMin: 0.5, yMin: 0, xMax: 10.5, yMax: 10 },
      { text: "og", xMin: 0, yMin: 0, xMax: 9, yMax: 10 },
    ],
  }];
  const result = computeSpatialAccuracy(geometry, extracted);
  assert.equal(result.matchCoverage, 1);
  assert.equal(result.score, 1);
  assert.ok(result.medianIou >= 0.8);
  assert.equal(result.passed, true);
});

test("store gentagne ordgrupper bruger en afgrænset fail-closed matching", () => {
  const words = Array.from({ length: 300 }, (_, index) => ({
    text: "og",
    vertices: [
      { x: 1, y: index * 2 + 1 }, { x: 20, y: index * 2 + 1 },
      { x: 20, y: index * 2 + 2 }, { x: 1, y: index * 2 + 2 },
    ],
  }));
  const geometry = [{ pageNumber: 1, imageWidth: 100, imageHeight: 604, words }];
  const extracted = [{
    width: 100,
    height: 604,
    words: words.map((word) => ({
      text: word.text,
      xMin: word.vertices[0].x,
      yMin: word.vertices[0].y,
      xMax: word.vertices[2].x,
      yMax: word.vertices[2].y,
    })),
  }];

  const result = computeSpatialAccuracy(geometry, extracted);
  assert.equal(result.matchedWords, 300);
  assert.equal(result.passed, true);
});

test("modgående centerkontrol accepterer samme slanke ordgeometri uden at sænke IoU-kravet", () => {
  const geometry = [{
    pageNumber: 1,
    imageWidth: 20,
    imageHeight: 20,
    words: [{
      text: "Aftale",
      vertices: [{ x: 5, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 5 }],
    }],
  }];
  const extracted = [{
    width: 20,
    height: 20,
    words: [{ text: "Aftale", xMin: 0.25, yMin: 0.25, xMax: 10.25, yMax: 10.25 }],
  }];
  const result = computeSpatialAccuracy(geometry, extracted);
  assert.ok(result.medianIou >= 0.8);
  assert.equal(result.centerInsideRatio, 1);
  assert.equal(result.passed, true);
});

test("ét Vision-ord kan matches mod højst tre tilstødende PDF-tokens", () => {
  const geometry = [{
    pageNumber: 1,
    imageWidth: 100,
    imageHeight: 40,
    words: [{
      text: "arbejdsmarked",
      vertices: [{ x: 10, y: 10 }, { x: 70, y: 10 }, { x: 70, y: 20 }, { x: 10, y: 20 }],
    }],
  }];
  const extracted = [{
    width: 100,
    height: 40,
    words: [
      { text: "arbejds-", xMin: 10, yMin: 10, xMax: 40, yMax: 20 },
      { text: "marked", xMin: 40, yMin: 10, xMax: 70, yMax: 20 },
    ],
  }];
  const result = computeSpatialAccuracy(geometry, extracted);
  assert.equal(result.expectedWords, 1);
  assert.equal(result.matchedWords, 1);
  assert.equal(result.score, 1);
  assert.equal(result.passed, true);
});

test("tilstødende Vision-ord kan matches mod ét samlet PDF-token", () => {
  const geometry = [{
    pageNumber: 1,
    imageWidth: 100,
    imageHeight: 40,
    words: [
      { text: "arbejds", vertices: [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 20 }, { x: 10, y: 20 }] },
      { text: "marked", vertices: [{ x: 40, y: 10 }, { x: 70, y: 10 }, { x: 70, y: 20 }, { x: 40, y: 20 }] },
    ],
  }];
  const extracted = [{
    width: 100,
    height: 40,
    words: [{ text: "arbejdsmarked", xMin: 10, yMin: 10, xMax: 70, yMax: 20 }],
  }];
  const result = computeSpatialAccuracy(geometry, extracted);
  assert.equal(result.expectedWords, 2);
  assert.equal(result.matchedWords, 2);
  assert.equal(result.score, 1);
  assert.equal(result.passed, true);
});

test("ikke-tilstødende tokens samles ikke og kvalitetsgrænsen sænkes ikke", () => {
  const geometry = [{
    pageNumber: 1,
    imageWidth: 100,
    imageHeight: 40,
    words: [{
      text: "arbejdsmarked",
      vertices: [{ x: 10, y: 10 }, { x: 70, y: 10 }, { x: 70, y: 20 }, { x: 10, y: 20 }],
    }],
  }];
  const extracted = [{
    width: 100,
    height: 40,
    words: [
      { text: "arbejds", xMin: 10, yMin: 10, xMax: 35, yMax: 20 },
      { text: "andet", xMin: 35, yMin: 10, xMax: 45, yMax: 20 },
      { text: "marked", xMin: 45, yMin: 10, xMax: 70, yMax: 20 },
    ],
  }];
  const result = computeSpatialAccuracy(geometry, extracted);
  assert.equal(result.matchedWords, 0);
  assert.equal(result.score, 0);
  assert.equal(result.passed, false);
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

function spatialFixture({ expectedCount, matchedCount, placedCount }) {
  const words = Array.from({ length: expectedCount }, (_, index) => ({
    text: `Ord${index}`,
    vertices: [
      { x: 10, y: index * 2 + 1 }, { x: 30, y: index * 2 + 1 },
      { x: 30, y: index * 2 + 2 }, { x: 10, y: index * 2 + 2 },
    ],
  }));
  return {
    geometry: [{ pageNumber: 1, imageWidth: 100, imageHeight: expectedCount * 2 + 2, words }],
    extracted: [{
      width: 100,
      height: expectedCount * 2 + 2,
      words: Array.from({ length: matchedCount }, (_, index) => ({
        text: `Ord${index}`,
        xMin: index < placedCount ? 10 : 15,
        yMin: index * 2 + 1,
        xMax: index < placedCount ? 30 : 25,
        yMax: index * 2 + 2,
      })),
    }],
  };
}

test("dækning og placering kontrolleres separat uden dobbeltstraf", () => {
  const { geometry, extracted } = spatialFixture({
    expectedCount: 100,
    matchedCount: 95,
    placedCount: 91,
  });
  const result = computeSpatialAccuracy(geometry, extracted);
  assert.equal(result.matchCoverage, 0.95);
  assert.equal(result.score, 0.95);
  assert.equal(result.centerInsideRatio, 1);
  assert.equal(result.passed, true);
});

test("under 95 procent matchede ord afvises trods perfekt placering", () => {
  const { geometry, extracted } = spatialFixture({
    expectedCount: 100,
    matchedCount: 94,
    placedCount: 94,
  });
  const result = computeSpatialAccuracy(geometry, extracted);
  assert.equal(result.matchCoverage, 0.94);
  assert.equal(result.score, 0.94);
  assert.equal(result.passed, false);
});

test("under 95 procent korrekt placerede ord afvises trods fuld dækning", () => {
  const { geometry, extracted } = spatialFixture({
    expectedCount: 100,
    matchedCount: 100,
    placedCount: 94,
  });
  const result = computeSpatialAccuracy(geometry, extracted);
  assert.equal(result.matchCoverage, 1);
  assert.equal(result.score, 0.94);
  assert.equal(result.centerInsideRatio, 1);
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
