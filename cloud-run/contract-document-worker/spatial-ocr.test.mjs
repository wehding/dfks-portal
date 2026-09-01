import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import sharp from "sharp";

import {
  canonicaliseSpatialGeometryPage,
  classifyOcrDocument,
  classifyPageText,
  classifyRasterBlankness,
  completionPageCounts,
  computeSpatialAccuracy,
  correctPageOrientation,
  detectPhysicalOrientation,
  enforceVisionWordLimits,
  isPdfImagesInventoryReliable,
  mapOrientationVariantToCanonical,
  mapVisionPageToCanonical,
  pageRasterEvidence,
  parsePdfImagesList,
  parsePdftotextBbox,
  processPdfSpatially,
  readTextArtifactWithinLimit,
  recoverOrientationPageFromVariants,
  recoverUnreadablePageFromVariants,
  resolvePhysicalOrientations,
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

test("v3-geometri fjerner al midlertidig recovery-metadata før persistens", () => {
  const canonical = canonicaliseSpatialGeometryPage({
    pageNumber: 8,
    imageWidth: 600,
    imageHeight: 1_000,
    recoveryProfile: "vision-sparse-tail-orientation-consensus-v1",
    recoveryRotationDegrees: 270,
    internalEvidence: { confidence: 1 },
    words: [{
      text: "Slutnote",
      confidence: 0.99,
      recoveryHint: "temporary",
      vertices: [
        { x: 100, y: 200, internal: true },
        { x: 100, y: 240, internal: true },
        { x: 80, y: 240, internal: true },
        { x: 80, y: 200, internal: true },
      ],
    }],
  }, 90);
  assert.deepEqual(Object.keys(canonical).sort(), [
    "imageHeight",
    "imageWidth",
    "orientationCorrection",
    "pageNumber",
    "sourceImageHeight",
    "sourceImageWidth",
    "words",
  ]);
  assert.deepEqual(Object.keys(canonical.words[0]).sort(), ["confidence", "text", "vertices"]);
  assert.deepEqual(Object.keys(canonical.words[0].vertices[0]).sort(), ["x", "y"]);
  assert.equal(canonical.imageWidth, 1_000);
  assert.equal(canonical.imageHeight, 600);
  assert.equal(canonical.orientationCorrection, 90);
});

test("tvungen Vision rapporterer alle faktisk behandlede native sider som OCR-sider", () => {
  const nativePages = [
    { classification: "native_text" },
    { classification: "native_text" },
  ];
  assert.deepEqual(completionPageCounts(nativePages, false), {
    nativePageCount: 2,
    ocrPageCount: 0,
  });
  assert.deepEqual(completionPageCounts(nativePages, true), {
    nativePageCount: 0,
    ocrPageCount: 2,
  });
  assert.deepEqual(completionPageCounts([
    { classification: "native_text" },
    { classification: "image_only" },
  ], true), {
    nativePageCount: 0,
    ocrPageCount: 2,
  });
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

test("recovery af eneste læsbare side aktiverer en separat verificeret blank side", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dfks-unreadable-recovery-"));
  try {
    const blackPatch = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "black" },
    }).png().toBuffer();
    const sourceJpeg = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "white" },
    }).composite([{ input: blackPatch, left: 10, top: 10 }]).jpeg({ quality: 95 }).toBuffer();
    const whiteJpeg = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "white" },
    }).jpeg({ quality: 95 }).toBuffer();
    const visionWord = (text, top, shift = 0) => ({
      confidence: 0.99,
      boundingBox: { vertices: [
        { x: 10 + shift, y: top }, { x: 30 + shift, y: top },
        { x: 30 + shift, y: top + 10 }, { x: 10 + shift, y: top + 10 },
      ] },
      symbols: text.split("").map((symbol) => ({ text: symbol })),
    });
    const words = (shift = 0) => [
      visionWord("Ord1", 10, shift),
      visionWord("Ord2", 30, shift),
      visionWord("Ord3", 50, shift),
    ];
    const response = (pageWords) => ({ fullTextAnnotation: { pages: [{
      width: 100,
      height: 100,
      blocks: [{ paragraphs: [{ words: pageWords }] }],
    }] } });
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
        const pageNumber = Number(args[args.indexOf("-f") + 1]);
        await writeFile(`${args.at(-1)}.jpg`, pageNumber === 2 ? whiteJpeg : sourceJpeg);
        return { stdout: "", stderr: "" };
      }
      if (command === "pdftotext") {
        const target = args.at(-1);
        if (args.includes("-bbox-layout")) {
          const page = `<page width="612" height="792">
            <word xMin="61.2" yMin="79.2" xMax="183.6" yMax="158.4">Ord1</word>
            <word xMin="61.2" yMin="237.6" xMax="183.6" yMax="316.8">Ord2</word>
            <word xMin="61.2" yMin="396" xMax="183.6" yMax="475.2">Ord3</word>
          </page>`;
          await writeFile(target, `${page}<page width="612" height="792"></page>`);
        } else if (args[0] === "-f") {
          await writeFile(target, "");
        } else {
          await writeFile(target, "A".repeat(200));
        }
        return { stdout: "", stderr: "" };
      }
      if (command === "python3" && args[0].endsWith("normalise_orientation.py")) {
        await writeFile(args[2], sourceJpeg);
        return { stdout: "", stderr: "" };
      }
      if (command === "python3" && args[0].endsWith("vision_overlay.py")) {
        await writeFile(args[4], "%PDF-unreadable-recovery-test");
        return { stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command ${command}`);
    };
    let retryCalls = 0;
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
              { fullTextAnnotation: { pages: [] } },
              { fullTextAnnotation: { pages: [] } },
            ],
            sourcePages: [
              { pageNumber: 1, imageBytes: sourceJpeg },
              { pageNumber: 2, imageBytes: whiteJpeg },
            ],
            visionPageTransforms: [1, 2].map((pageNumber) => ({
              pageNumber,
              sourceWidth: 100,
              sourceHeight: 100,
              visionWidth: 100,
              visionHeight: 100,
            })),
            retainedRasterBytes: sourceJpeg.length + whiteJpeg.length,
            retainedVisionResponseBytes: 1_000,
          };
        },
        async annotateUnreadablePageVariants(page) {
          retryCalls += 1;
          assert.equal(page.pageNumber, 1);
          return {
            variants: [
              { kind: "colour", response: response(words()), transform: {
                pageNumber: 1, sourceWidth: 100, sourceHeight: 100,
                visionWidth: 100, visionHeight: 100,
              } },
              { kind: "contrast_gray", response: response(words(0.5)), transform: {
                pageNumber: 1, sourceWidth: 100, sourceHeight: 100,
                visionWidth: 100, visionHeight: 100,
              } },
            ],
            retainedRasterBytes: sourceJpeg.length * 2,
            retainedVisionResponseBytes: 1_000,
          };
        },
      },
    });
    assert.equal(retryCalls, 1);
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.unreadablePageCount, 0);
    assert.equal(result.blankPageCount, 1);

    const runWithRetryWords = (colourWords, grayWords, resourceLimits) => processPdfSpatially({
      inputPath: join(directory, "input.pdf"),
      outputPath: join(directory, "limited-output.pdf"),
      geometryPath: join(directory, "limited-geometry.json.gz"),
      workDir: directory,
      commandRunner: runner,
      resourceLimits,
      googleClient: {
        async annotateDocument() {
          return {
            responses: [
              { fullTextAnnotation: { pages: [] } },
              { fullTextAnnotation: { pages: [] } },
            ],
            sourcePages: [
              { pageNumber: 1, imageBytes: sourceJpeg },
              { pageNumber: 2, imageBytes: whiteJpeg },
            ],
            visionPageTransforms: [1, 2].map((pageNumber) => ({
              pageNumber, sourceWidth: 100, sourceHeight: 100,
              visionWidth: 100, visionHeight: 100,
            })),
            retainedRasterBytes: sourceJpeg.length + whiteJpeg.length,
            retainedVisionResponseBytes: 1_000,
          };
        },
        async annotateUnreadablePageVariants() {
          return {
            variants: [
              { kind: "colour", response: response(colourWords), transform: {
                pageNumber: 1, sourceWidth: 100, sourceHeight: 100,
                visionWidth: 100, visionHeight: 100,
              } },
              { kind: "contrast_gray", response: response(grayWords), transform: {
                pageNumber: 1, sourceWidth: 100, sourceHeight: 100,
                visionWidth: 100, visionHeight: 100,
              } },
            ],
            retainedRasterBytes: sourceJpeg.length * 2,
            retainedVisionResponseBytes: 1_000,
          };
        },
      },
    });
    const fiveWords = Array.from({ length: 5 }, (_, index) => (
      visionWord(`Farve${index}`, 5 + index * 15)
    ));
    const fiveDisagreeingWords = Array.from({ length: 5 }, (_, index) => (
      visionWord(`Grå${index}`, 5 + index * 15)
    ));
    await assert.rejects(
      runWithRetryWords(fiveWords, fiveDisagreeingWords, {
        maxVisionWordsPerPage: 4,
        maxVisionWordsTotal: 100,
      }),
      (error) => error instanceof GoogleOcrOperationalError
        && error.code === "vision_word_limit_exceeded",
    );
    await assert.rejects(
      runWithRetryWords(words(), [
        visionWord("Andet1", 10), visionWord("Andet2", 30), visionWord("Andet3", 50),
      ], {
        maxVisionWordsPerPage: 4,
        maxVisionWordsTotal: 5,
      }),
      (error) => error instanceof GoogleOcrOperationalError
        && error.code === "vision_word_limit_exceeded",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("forced Vision behandler alle native sider, mens normal behandling fortsat er not_required", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dfks-force-native-"));
  try {
    const sourceJpeg = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "white" },
    }).jpeg({ quality: 95 }).toBuffer();
    const nativeText = Array.from(
      { length: 30 },
      (_, index) => `Kontraktens tydelige native tekst nummer ${index + 1}`,
    ).join(" ");
    const visionWords = [
      ["Ord1", 10],
      ["Ord2", 30],
      ["Ord3", 50],
      ["Ord4", 70],
    ].map(([text, top]) => ({
      confidence: 0.99,
      boundingBox: { vertices: [
        { x: 10, y: top }, { x: 30, y: top },
        { x: 30, y: top + 10 }, { x: 10, y: top + 10 },
      ] },
      symbols: text.split("").map((symbol) => ({ text: symbol })),
    }));
    let visionCalls = 0;
    const runner = async (command, args) => {
      if (command === "pdfinfo") {
        return { stdout: "Pages: 1\nPage    1 size: 612 x 792 pts\n", stderr: "" };
      }
      if (command === "pdfimages") {
        return {
          stdout: "page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio\n",
          stderr: "",
        };
      }
      if (command === "pdftoppm") {
        await writeFile(`${args.at(-1)}.jpg`, sourceJpeg);
        return { stdout: "", stderr: "" };
      }
      if (command === "pdftotext") {
        const target = args.at(-1);
        if (args.includes("-bbox-layout")) {
          await writeFile(target, `<page width="612" height="792">
            <word xMin="61.2" yMin="79.2" xMax="183.6" yMax="158.4">Ord1</word>
            <word xMin="61.2" yMin="237.6" xMax="183.6" yMax="316.8">Ord2</word>
            <word xMin="61.2" yMin="396" xMax="183.6" yMax="475.2">Ord3</word>
            <word xMin="61.2" yMin="554.4" xMax="183.6" yMax="633.6">Ord4</word>
          </page>`);
        } else if (args[0] === "-f") {
          await writeFile(target, nativeText);
        } else {
          await writeFile(target, "A".repeat(200));
        }
        return { stdout: "", stderr: "" };
      }
      if (command === "python3" && args[0].endsWith("normalise_orientation.py")) {
        await writeFile(args[2], sourceJpeg);
        return { stdout: "", stderr: "" };
      }
      if (command === "python3" && args[0].endsWith("vision_overlay.py")) {
        await writeFile(args[4], "%PDF-force-native-test");
        return { stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command ${command}`);
    };
    const googleClient = {
      async annotateDocument() {
        visionCalls += 1;
        return {
          responses: [{ fullTextAnnotation: { pages: [{
            width: 100,
            height: 100,
            blocks: [{ paragraphs: [{ words: visionWords }] }],
          }] } }],
          sourcePages: [{ pageNumber: 1, imageBytes: sourceJpeg }],
          visionPageTransforms: [{
            pageNumber: 1,
            sourceWidth: 100,
            sourceHeight: 100,
            visionWidth: 100,
            visionHeight: 100,
          }],
        };
      },
    };
    const paths = {
      inputPath: join(directory, "input.pdf"),
      outputPath: join(directory, "output.pdf"),
      geometryPath: join(directory, "geometry.json.gz"),
      workDir: directory,
      commandRunner: runner,
      googleClient,
    };

    const normal = await processPdfSpatially(paths);
    assert.equal(normal.status, "not_required");
    assert.equal(normal.classification, "native_text");
    assert.equal(normal.nativePageCount, 1);
    assert.equal(normal.ocrPageCount, 0);
    assert.equal(visionCalls, 0);

    const forced = await processPdfSpatially({ ...paths, forceOcr: true });
    assert.equal(forced.status, "completed", JSON.stringify(forced));
    assert.equal(forced.classification, "mixed");
    assert.equal(forced.nativePageCount, 0);
    assert.equal(forced.ocrPageCount, 1);
    assert.equal(forced.processingProfile, "google-vision-direct-v1");
    assert.equal(forced.spatialSchemaVersion, "google-vision-spatial-v3");
    assert.equal(visionCalls, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function runOverlayFallbackFixture({ passingProfile = null, failingBuildProfile = null } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "dfks-overlay-fallback-"));
  const sourceJpeg = await sharp({
    create: { width: 100, height: 100, channels: 3, background: "white" },
  }).jpeg({ quality: 95 }).toBuffer();
  const overlayCalls = [];
  const exactBbox = `<page width="612" height="792">
    <word xMin="61.2" yMin="79.2" xMax="183.6" yMax="158.4">Ord1</word>
    <word xMin="61.2" yMin="237.6" xMax="183.6" yMax="316.8">Ord2</word>
    <word xMin="61.2" yMin="396" xMax="183.6" yMax="475.2">Ord3</word>
    <word xMin="61.2" yMin="554.4" xMax="183.6" yMax="633.6">Ord4</word>
  </page>`;
  const failingBbox = `<page width="612" height="792">
    <word xMin="300" yMin="300" xMax="360" yMax="330">Ord1</word>
  </page>`;
  const runner = async (command, args) => {
    if (command === "pdfinfo") {
      return { stdout: "Pages: 1\nPage    1 size: 612 x 792 pts\n", stderr: "" };
    }
    if (command === "pdfimages") {
      return {
        stdout: "page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio\n",
        stderr: "",
      };
    }
    if (command === "pdftoppm") {
      await writeFile(`${args.at(-1)}.jpg`, sourceJpeg);
      return { stdout: "", stderr: "" };
    }
    if (command === "pdftotext") {
      const target = args.at(-1);
      if (args.includes("-bbox-layout")) {
        const candidateInput = args.at(-2);
        const passes = passingProfile != null && candidateInput.includes(passingProfile);
        await writeFile(target, passes ? exactBbox : failingBbox);
      } else if (args[0] === "-f") {
        await writeFile(target, "");
      } else {
        await writeFile(target, "A".repeat(200));
      }
      return { stdout: "", stderr: "" };
    }
    if (command === "python3" && args[0].endsWith("normalise_orientation.py")) {
      await writeFile(args[2], sourceJpeg);
      return { stdout: "", stderr: "" };
    }
    if (command === "python3" && args[0].endsWith("vision_overlay.py")) {
      const profile = args[6] ?? "primary-v1";
      overlayCalls.push(profile);
      if (profile === failingBuildProfile) throw new Error("bounded candidate failed");
      await writeFile(args[4], `%PDF-${profile}`);
      return { stdout: "", stderr: "" };
    }
    throw new Error(`unexpected command ${command}`);
  };
  const visionWord = (text, top) => ({
    confidence: 0.99,
    boundingBox: { vertices: [
      { x: 10, y: top }, { x: 30, y: top },
      { x: 30, y: top + 10 }, { x: 10, y: top + 10 },
    ] },
    symbols: text.split("").map((symbol) => ({ text: symbol })),
  });
  const outputPath = join(directory, "output.pdf");
  const geometryPath = join(directory, "geometry.json.gz");
  const result = await processPdfSpatially({
    inputPath: join(directory, "input.pdf"),
    outputPath,
    geometryPath,
    workDir: directory,
    commandRunner: runner,
    googleClient: {
      async annotateDocument() {
        return {
          responses: [{ fullTextAnnotation: { pages: [{
            width: 100,
            height: 100,
            blocks: [{ paragraphs: [{ words: [
              visionWord("Ord1", 10),
              visionWord("Ord2", 30),
              visionWord("Ord3", 50),
              visionWord("Ord4", 70),
            ] }] }],
          }] } }],
          sourcePages: [{ pageNumber: 1, imageBytes: sourceJpeg }],
          visionPageTransforms: [{
            pageNumber: 1,
            sourceWidth: 100,
            sourceHeight: 100,
            visionWidth: 100,
            visionHeight: 100,
          }],
        };
      },
    },
  });
  return { directory, geometryPath, outputPath, overlayCalls, result };
}

test("første alternative overlay der består hele auditen erstatter den fejlede primære kandidat", async () => {
  const fixture = await runOverlayFallbackFixture({ passingProfile: "font-metrics-v1" });
  try {
    assert.equal(fixture.result.status, "completed", JSON.stringify(fixture.result));
    assert.deepEqual(fixture.overlayCalls, ["primary-v1", "font-metrics-v1"]);
    assert.equal(await readFile(fixture.outputPath, "utf8"), "%PDF-font-metrics-v1");
    const geometry = JSON.parse(gunzipSync(await readFile(fixture.geometryPath)).toString("utf8"));
    assert.equal(geometry.overlayProfile, "font-metrics-v1");
    assert.equal(geometry.spatialVerification.passed, true);
    await assert.rejects(readFile(join(
      fixture.directory,
      "output-axis-aligned-font-metrics-v1.pdf",
    )));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("alle fejlede overlay-kandidater slettes og resultatet forbliver needs_review", async () => {
  const fixture = await runOverlayFallbackFixture({ failingBuildProfile: "font-metrics-v1" });
  try {
    assert.equal(fixture.result.status, "needs_review");
    assert.deepEqual(fixture.overlayCalls, [
      "primary-v1",
      "font-metrics-v1",
      "axis-aligned-font-metrics-v1",
    ]);
    assert.equal(await readFile(fixture.outputPath, "utf8"), "%PDF-primary-v1");
    assert.equal(fixture.result.spatial.passed, false);
    assert.deepEqual(fixture.result.affectedPageNumbers, [1]);
    for (const profile of ["font-metrics-v1", "axis-aligned-font-metrics-v1"]) {
      await assert.rejects(readFile(join(fixture.directory, `output-${profile}.pdf`)));
    }
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
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

test("naboer kan ikke sænke sidens eksisterende orienteringsgrænse", () => {
  const left = { ...orientedPage(90), pageNumber: 1 };
  const middle = {
    ...orientedPage(90),
    pageNumber: 2,
    words: [
      ...orientedPage(90).words.slice(0, 2),
      orientedPage(0).words[0],
    ],
  };
  const right = { ...orientedPage(90), pageNumber: 3 };
  assert.equal(detectPhysicalOrientation(middle).reliable, false);
  const resolved = resolvePhysicalOrientations([left, middle, right]);
  assert.equal(resolved.get(1).reliable, true);
  assert.equal(resolved.get(2).reliable, false);
  assert.equal(resolved.get(2).correctionDegrees, 0);
  assert.equal(resolved.get(3).reliable, true);

  const weak = {
    ...middle,
    words: [{
      text: "x",
      confidence: 0.99,
      vertices: [
        { x: 40, y: 80 }, { x: 40, y: 84 },
        { x: 38, y: 84 }, { x: 38, y: 80 },
      ],
    }],
  };
  assert.equal(resolvePhysicalOrientations([left, weak, right]).get(2).reliable, false);

  const loweredGateRegression = {
    ...middle,
    words: [
      {
        text: "retning",
        confidence: 1,
        vertices: [
          { x: 40, y: 80 }, { x: 40, y: 93 },
          { x: 35, y: 93 }, { x: 35, y: 80 },
        ],
      },
      {
        text: "støj",
        confidence: 1,
        vertices: [
          { x: 40, y: 80 }, { x: 47, y: 80 },
          { x: 47, y: 85 }, { x: 40, y: 85 },
        ],
      },
    ],
  };
  const loweredGateOrientation = detectPhysicalOrientation(loweredGateRegression);
  assert.equal(loweredGateOrientation.acceptedWords, 2);
  assert.equal(loweredGateOrientation.confidence, 0.65);
  assert.equal(resolvePhysicalOrientations([
    left, loweredGateRegression, right,
  ]).get(2).reliable, false);

  const conflictingRight = { ...orientedPage(0), pageNumber: 3 };
  assert.equal(resolvePhysicalOrientations([left, middle, conflictingRight]).get(2).reliable, false);

  const noLeftNeighbor = { ...middle, pageNumber: 1 };
  assert.equal(resolvePhysicalOrientations([noLeftNeighbor, right]).get(1).reliable, false);

  const ownDirectionDisagrees = {
    ...middle,
    words: [
      ...orientedPage(0).words.slice(0, 2),
      orientedPage(90).words[0],
    ],
  };
  assert.equal(resolvePhysicalOrientations([left, ownDirectionDisagrees, right]).get(2).reliable, false);
});

test("kardinalvariantens geometri mappes præcist tilbage til canonical raster", () => {
  const mapped = mapOrientationVariantToCanonical({
    pageNumber: 2,
    imageWidth: 200,
    imageHeight: 100,
    words: [{
      text: "Kort",
      confidence: 0.99,
      vertices: [
        { x: 180, y: 10 }, { x: 180, y: 30 },
        { x: 170, y: 30 }, { x: 170, y: 10 },
      ],
    }],
  }, {
    pageNumber: 2,
    rotationDegrees: 90,
    canonicalWidth: 100,
    canonicalHeight: 200,
  });
  assert.equal(mapped.imageWidth, 100);
  assert.equal(mapped.imageHeight, 200);
  assert.deepEqual(mapped.words[0].vertices, [
    { x: 10, y: 20 }, { x: 30, y: 20 },
    { x: 30, y: 30 }, { x: 10, y: 30 },
  ]);
  assert.equal(mapped.recoveryRotationDegrees, 90);
});

test("kort side genvindes kun ved to strengt enige, lokalt pålidelige orienteringer", () => {
  const variants = [0, 90, 180, 270].map((rotationDegrees) => ({
    ...orientedPage(90),
    words: orientedPage(90).words.slice(0, 3),
    recoveryRotationDegrees: rotationDegrees,
  }));
  const recovered = recoverOrientationPageFromVariants(variants);
  assert.equal(recovered?.recoveryProfile, "vision-cardinal-orientation-consensus-v1");
  assert.equal(detectPhysicalOrientation(recovered).reliable, true);
  assert.equal(detectPhysicalOrientation(recovered).correctionDegrees, 90);

  const tied = [0, 90, 180, 270].map((rotationDegrees) => {
    const page = orientedPage(90);
    page.words.push(...orientedPage(270).words);
    return { ...page, recoveryRotationDegrees: rotationDegrees };
  });
  assert.equal(recoverOrientationPageFromVariants(tied), null);

  const conflicting = variants.map((page, index) => (
    index === 3
      ? { ...orientedPage(270), recoveryRotationDegrees: page.recoveryRotationDegrees }
      : page
  ));
  assert.equal(recoverOrientationPageFromVariants(conflicting), null);

  const geometryConflict = variants.map((page, index) => (
    index === 3
      ? {
        ...page,
        words: page.words.map((word) => ({
          ...word,
          vertices: word.vertices.map((point) => ({ x: point.x + 30, y: point.y })),
        })),
      }
      : page
  ));
  assert.equal(recoverOrientationPageFromVariants(geometryConflict), null);
});

test("orienteringsretry sænker ikke 0,70- eller lokale evidenskrav", () => {
  const weak = [0, 90, 180, 270].map((rotationDegrees) => ({
    pageNumber: 1,
    imageWidth: 100,
    imageHeight: 200,
    recoveryRotationDegrees: rotationDegrees,
    words: [
      {
        text: "retning",
        confidence: 1,
        vertices: [
          { x: 40, y: 80 }, { x: 40, y: 93 },
          { x: 35, y: 93 }, { x: 35, y: 80 },
        ],
      },
      {
        text: "støj",
        confidence: 1,
        vertices: [
          { x: 40, y: 80 }, { x: 47, y: 80 },
          { x: 47, y: 85 }, { x: 40, y: 85 },
        ],
      },
    ],
  }));
  assert.equal(detectPhysicalOrientation(weak[0]).confidence, 0.65);
  assert.equal(recoverOrientationPageFromVariants(weak), null);
});

test("en kort sidste side kan færdiggøres via kardinal konsensus", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dfks-orientation-recovery-"));
  try {
    const sourceJpeg = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "white" },
    }).jpeg({ quality: 95 }).toBuffer();
    const canonicalWords = [
      ["Ord1", 10], ["Ord2", 40], ["Ord3", 70],
    ].map(([text, top]) => ({
      text,
      confidence: 0.99,
      vertices: [
        { x: 10, y: top }, { x: 30, y: top },
        { x: 30, y: top + 10 }, { x: 10, y: top + 10 },
      ],
    }));
    const rotateClockwise = (point, degrees) => {
      if (degrees === 90) return { x: 100 - point.y, y: point.x };
      if (degrees === 180) return { x: 100 - point.x, y: 100 - point.y };
      if (degrees === 270) return { x: point.y, y: 100 - point.x };
      return point;
    };
    const response = (words) => ({ fullTextAnnotation: { pages: [{
      width: 100,
      height: 100,
      blocks: [{ paragraphs: [{ words: words.map((word) => ({
        confidence: word.confidence,
        boundingBox: { vertices: word.vertices },
        symbols: word.text.split("").map((symbol) => ({ text: symbol })),
      })) }] }],
    }] } });
    const runner = async (command, args) => {
      if (command === "pdfinfo") {
        return { stdout: "Pages: 1\nPage    1 size: 612 x 792 pts\n", stderr: "" };
      }
      if (command === "pdfimages") {
        return {
          stdout: "page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio\n",
          stderr: "",
        };
      }
      if (command === "pdftoppm") {
        await writeFile(`${args.at(-1)}.jpg`, sourceJpeg);
        return { stdout: "", stderr: "" };
      }
      if (command === "pdftotext") {
        const target = args.at(-1);
        if (args.includes("-bbox-layout")) {
          await writeFile(target, `<page width="612" height="792">
            <word xMin="61.2" yMin="79.2" xMax="183.6" yMax="158.4">Ord1</word>
            <word xMin="61.2" yMin="316.8" xMax="183.6" yMax="396">Ord2</word>
            <word xMin="61.2" yMin="554.4" xMax="183.6" yMax="633.6">Ord3</word>
          </page>`);
        } else if (args[0] === "-f") {
          await writeFile(target, "");
        } else {
          await writeFile(target, "A".repeat(200));
        }
        return { stdout: "", stderr: "" };
      }
      if (command === "python3" && args[0].endsWith("normalise_orientation.py")) {
        await writeFile(args[2], sourceJpeg);
        return { stdout: "", stderr: "" };
      }
      if (command === "python3" && args[0].endsWith("vision_overlay.py")) {
        await writeFile(args[4], "%PDF-orientation-recovery-test");
        return { stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command ${command}`);
    };
    let retryCalls = 0;
    const result = await processPdfSpatially({
      inputPath: join(directory, "input.pdf"),
      outputPath: join(directory, "output.pdf"),
      geometryPath: join(directory, "geometry.json.gz"),
      workDir: directory,
      commandRunner: runner,
      googleClient: {
        async annotateDocument() {
          const weakWords = canonicalWords.slice(0, 2).map((word) => ({
            ...word,
            vertices: [
              word.vertices[0],
              { x: word.vertices[0].x + 3, y: word.vertices[0].y },
              { x: word.vertices[0].x + 3, y: word.vertices[0].y + 3 },
              { x: word.vertices[0].x, y: word.vertices[0].y + 3 },
            ],
          }));
          return {
            responses: [response(weakWords)],
            sourcePages: [{ pageNumber: 1, imageBytes: sourceJpeg }],
            visionPageTransforms: [{
              pageNumber: 1,
              sourceWidth: 100,
              sourceHeight: 100,
              visionWidth: 100,
              visionHeight: 100,
            }],
            retainedRasterBytes: sourceJpeg.length,
            retainedVisionResponseBytes: 1_000,
          };
        },
        async annotateOrientationPageVariants(page, options) {
          retryCalls += 1;
          assert.equal(page.pageNumber, 1);
          assert.equal(options.signal, undefined);
          return {
            variants: [0, 90, 180, 270].map((rotationDegrees) => ({
              kind: `rotate_${rotationDegrees}`,
              response: response(canonicalWords.map((word) => ({
                ...word,
                vertices: word.vertices.map((point) => rotateClockwise(point, rotationDegrees)),
              }))),
              transform: {
                pageNumber: 1,
                rotationDegrees,
                canonicalWidth: 100,
                canonicalHeight: 100,
                sourceWidth: 100,
                sourceHeight: 100,
                visionWidth: 100,
                visionHeight: 100,
              },
            })),
            retainedRasterBytes: sourceJpeg.length * 4,
            retainedVisionResponseBytes: 2_000,
          };
        },
      },
    });
    assert.equal(retryCalls, 1);
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.orientationUncertainPageCount, 0);
    assert.deepEqual(result.orientationCorrections, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function recoveryVariantPage({ shift = 0, token = "Kontrakt", confidence = 0.95 } = {}) {
  return {
    pageNumber: 2,
    imageWidth: 200,
    imageHeight: 300,
    words: ["Aftale", "Producent", token].map((text, index) => ({
      text,
      confidence,
      vertices: [
        { x: 20 + shift, y: 20 + index * 30 },
        { x: 80 + shift, y: 20 + index * 30 },
        { x: 80 + shift, y: 35 + index * 30 },
        { x: 20 + shift, y: 35 + index * 30 },
      ],
    })),
  };
}

test("ulæselig side accepteres kun ved streng token- og geometrienighed", () => {
  const colour = recoveryVariantPage();
  const agreeingGray = recoveryVariantPage({ shift: 1 });
  const recovered = recoverUnreadablePageFromVariants([colour, agreeingGray]);
  assert.equal(recovered?.recoveryProfile, "vision-colour-contrast-consensus-v1");
  assert.deepEqual(recovered?.words, colour.words);
  assert.equal(recoverUnreadablePageFromVariants([
    colour,
    recoveryVariantPage({ token: "Honorar" }),
  ]), null);
  assert.equal(recoverUnreadablePageFromVariants([
    colour,
    recoveryVariantPage({ shift: 30 }),
  ]), null);
  assert.equal(recoverUnreadablePageFromVariants([
    colour,
    recoveryVariantPage({ confidence: 0.5 }),
  ]), null);
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

test("ét Vision-ord kan matches mod et afgrænset antal tilstødende PDF-tokens", () => {
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

test("ét Vision-compound kan matches mod fem geometrisk tilstødende PDF-tokens", () => {
  const parts = ["arbejds", "markeds", "bidrags", "grund", "lag"];
  const geometry = [{
    pageNumber: 1,
    imageWidth: 140,
    imageHeight: 40,
    words: [{
      text: parts.join(""),
      vertices: [{ x: 5, y: 10 }, { x: 125, y: 10 }, { x: 125, y: 20 }, { x: 5, y: 20 }],
    }],
  }];
  const extracted = [{
    width: 140,
    height: 40,
    words: parts.map((text, index) => ({
      text, xMin: 5 + index * 24, yMin: 10, xMax: 27 + index * 24, yMax: 20,
    })),
  }];
  const result = computeSpatialAccuracy(geometry, extracted);
  assert.equal(result.matchedWords, 1);
  assert.equal(result.matchCoverage, 1);
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

test("fem tilstødende Vision-ord kan matches sikkert mod ét samlet PDF-token", () => {
  const parts = ["Dansk", "Film", "Klipper", "Selskab", "Aftale"];
  const geometry = [{
    pageNumber: 1,
    imageWidth: 160,
    imageHeight: 40,
    words: parts.map((text, index) => ({
      text,
      vertices: [
        { x: 10 + index * 24, y: 10 }, { x: 32 + index * 24, y: 10 },
        { x: 32 + index * 24, y: 20 }, { x: 10 + index * 24, y: 20 },
      ],
    })),
  }];
  const extracted = [{
    width: 160,
    height: 40,
    words: [{
      text: parts.join(""), xMin: 10, yMin: 10, xMax: 128, yMax: 20,
    }],
  }];
  const result = computeSpatialAccuracy(geometry, extracted);
  assert.equal(result.expectedWords, 5);
  assert.equal(result.matchedWords, 5);
  assert.equal(result.matchCoverage, 1);
  assert.equal(result.score, 1);
  assert.equal(result.passed, true);
});

test("matcherfix løfter 92,667 procent til over 95 uden at sænke kvalitetsporten", () => {
  const exactCount = 139;
  const joinedCount = 5;
  const missingCount = 6;
  const exactWords = Array.from({ length: exactCount }, (_, index) => ({
    text: `Ord${index}`,
    vertices: [
      { x: 2, y: index * 2 + 1 }, { x: 22, y: index * 2 + 1 },
      { x: 22, y: index * 2 + 2 }, { x: 2, y: index * 2 + 2 },
    ],
  }));
  const joinedWords = Array.from({ length: joinedCount }, (_, index) => ({
    text: `Del${index}`,
    vertices: [
      { x: 2 + index * 24, y: 281 }, { x: 22 + index * 24, y: 281 },
      { x: 22 + index * 24, y: 291 }, { x: 2 + index * 24, y: 291 },
    ],
  }));
  const missingWords = Array.from({ length: missingCount }, (_, index) => ({
    text: `Mangler${index}`,
    vertices: [
      { x: 2, y: 294 + index * 2 }, { x: 22, y: 294 + index * 2 },
      { x: 22, y: 295 + index * 2 }, { x: 2, y: 295 + index * 2 },
    ],
  }));
  const geometry = [{
    pageNumber: 1,
    imageWidth: 140,
    imageHeight: 310,
    words: [...exactWords, ...joinedWords, ...missingWords],
  }];
  const extracted = [{
    width: 140,
    height: 310,
    words: [
      ...exactWords.map((word) => ({
        text: word.text,
        xMin: word.vertices[0].x,
        yMin: word.vertices[0].y,
        xMax: word.vertices[2].x,
        yMax: word.vertices[2].y,
      })),
      {
        text: joinedWords.map((word) => word.text).join(""),
        xMin: joinedWords[0].vertices[0].x,
        yMin: joinedWords[0].vertices[0].y,
        xMax: joinedWords.at(-1).vertices[2].x,
        yMax: joinedWords.at(-1).vertices[2].y,
      },
    ],
  }];
  const result = computeSpatialAccuracy(geometry, extracted);
  assert.equal(result.expectedWords, exactCount + joinedCount + missingCount);
  assert.equal(result.matchedWords, exactCount + joinedCount);
  assert.equal(Number(result.matchCoverage.toFixed(3)), 0.96);
  assert.ok(result.score >= 0.95);
  assert.equal(result.passed, true);
});

test("tokens på forskellige linjer samles ikke til et falsk compound-match", () => {
  const geometry = [{
    pageNumber: 1,
    imageWidth: 120,
    imageHeight: 60,
    words: [
      { text: "første", vertices: [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 20 }, { x: 10, y: 20 }] },
      { text: "anden", vertices: [{ x: 10, y: 30 }, { x: 40, y: 30 }, { x: 40, y: 40 }, { x: 10, y: 40 }] },
      { text: "tredje", vertices: [{ x: 42, y: 30 }, { x: 72, y: 30 }, { x: 72, y: 40 }, { x: 42, y: 40 }] },
      { text: "fjerde", vertices: [{ x: 74, y: 30 }, { x: 104, y: 30 }, { x: 104, y: 40 }, { x: 74, y: 40 }] },
    ],
  }];
  const extracted = [{
    width: 120,
    height: 60,
    words: [{ text: "førsteandentredjefjerde", xMin: 10, yMin: 10, xMax: 104, yMax: 40 }],
  }];
  const result = computeSpatialAccuracy(geometry, extracted);
  assert.equal(result.matchedWords, 0);
  assert.equal(result.passed, false);
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
