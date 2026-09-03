import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import sharp from "sharp";

import {
  LEGACY_SPATIAL_VERIFICATION_PROFILE,
  SPATIAL_VERIFICATION_PROFILE,
  V2_SPATIAL_VERIFICATION_PROFILE,
  canonicaliseSpatialGeometryPage,
  classifyOcrDocument,
  classifyPageText,
  classifyRasterBlankness,
  completionPageCounts,
  computeSpatialAccuracy,
  correctPageOrientation,
  detectPhysicalOrientation,
  enforceVisionWordLimits,
  hasIndependentReadableOcrPage,
  inspectRasterBlankness,
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
import { hasSparseTailBlankConsensus } from "./tail-page-recovery.mjs";
import {
  authoriseTailBlankProof,
  createTailBlankProofManifest,
  parseTailBlankProofManifest,
} from "./tail-blank-proof.mjs";

function spatialTestProofToken() {
  const source = Buffer.from("synthetic-source-raster");
  const recovery = Buffer.from("synthetic-recovery-raster");
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const runId = "33333333-3333-4333-8333-333333333333";
  const originalSha256 = "1".repeat(64);
  const value = createTailBlankProofManifest({
    runId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    entries: [{
      originalSha256,
      pageNumber: 8,
      pageCount: 8,
      sourceRasterSha256: digest(source),
      recoveryRasterSha256: digest(recovery),
    }, ...[4, 5, 6, 7].map((digit, index) => ({
      originalSha256: String(digit).repeat(64),
      pageNumber: 9 + index,
      pageCount: 9 + index,
      sourceRasterSha256: String(digit + 1).repeat(64),
      recoveryRasterSha256: String(digit + 2).repeat(64),
    }))],
  });
  const manifest = parseTailBlankProofManifest(JSON.stringify(value), {
    executionMode: "backfill",
    expectedRunId: runId,
  });
  return authoriseTailBlankProof(manifest, {
    runId,
    originalSha256,
    pageNumber: 8,
    pageCount: 8,
    sourceRasterBytes: source,
    recoveryRasterBytes: recovery,
  });
}

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

test("to rastere med scanner-randstøj bevarer indholdsfeltets fail-closed kontrol", async () => {
  const width = 1_000;
  const height = 1_200;
  const edgeStripe = await sharp({
    create: { width: 4, height: 100, channels: 3, background: { r: 230, g: 230, b: 230 } },
  }).png().toBuffer();
  const base = sharp({
    create: { width, height, channels: 3, background: "white" },
  }).composite([{ input: edgeStripe, left: width - 4, top: 500 }]);
  const source = await base.clone().jpeg({ quality: 95 }).toBuffer();
  const recovery = await base.clone().jpeg({ quality: 96 }).toBuffer();
  const [sourceEvidence, recoveryEvidence] = await Promise.all([
    inspectRasterBlankness(source),
    inspectRasterBlankness(recovery),
  ]);
  assert.equal(sourceEvidence.blank, false);
  assert.ok(sourceEvidence.maxLocalNonWhiteRatio > 0.04);
  assert.equal(sourceEvidence.interiorDarkRatio, 0);

  const artifact = {
    text: "x",
    confidence: 0.2,
    vertices: [
      { x: 940, y: 500 }, { x: 950, y: 500 },
      { x: 950, y: 506 }, { x: 940, y: 506 },
    ],
  };
  const variants = [0, 1, 2, 3].map((index) => ({
    pageNumber: 8,
    imageWidth: width,
    imageHeight: height,
    words: index < 2 ? [artifact] : [],
  }));
  assert.equal(hasIndependentReadableOcrPage([
    { pageNumber: 1, imageWidth: width, imageHeight: height, words: [] },
    variants[0],
  ], 8), false);
  assert.equal(hasIndependentReadableOcrPage([
    { pageNumber: 1, imageWidth: width, imageHeight: height, words: [{
      text: "Kontrakt",
      confidence: 0.99,
      vertices: [
        { x: 100, y: 100 }, { x: 200, y: 100 },
        { x: 200, y: 120 }, { x: 100, y: 120 },
      ],
    }] },
    variants[0],
  ], 8), true);
  assert.equal(hasSparseTailBlankConsensus({
    pageNumber: 8,
    pageCount: 8,
    variantPages: variants,
    sourceEvidence,
    recoveryEvidence,
    proofToken: spatialTestProofToken(),
  }), true);

  const signature = await sharp({
    create: { width: 80, height: 20, channels: 3, background: "black" },
  }).png().toBuffer();
  const signed = await base.clone()
    .composite([{ input: signature, left: 460, top: 800 }])
    .jpeg({ quality: 95 })
    .toBuffer();
  const signedEvidence = await inspectRasterBlankness(signed);
  assert.ok(signedEvidence.maxInteriorLocalDarkRatio > 0.02);
  assert.equal(hasSparseTailBlankConsensus({
    pageNumber: 8,
    pageCount: 8,
    variantPages: variants,
    sourceEvidence,
    recoveryEvidence: signedEvidence,
    proofToken: spatialTestProofToken(),
  }), false);
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
    const edgeArtifact = {
      confidence: 0.7,
      boundingBox: { vertices: [
        { x: 94, y: 40 }, { x: 98, y: 40 },
        { x: 98, y: 44 }, { x: 94, y: 44 },
      ] },
      symbols: [{ text: "x" }],
    };
    const runId = "33333333-3333-4333-8333-333333333333";
    const originalSha256 = "1".repeat(64);
    const proofValue = createTailBlankProofManifest({
      runId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      entries: [{
        originalSha256,
        pageNumber: 2,
        pageCount: 2,
        sourceRasterSha256: createHash("sha256").update(whiteJpeg).digest("hex"),
        recoveryRasterSha256: createHash("sha256").update(whiteJpeg).digest("hex"),
      }, ...[4, 5, 6, 7].map((digit, index) => ({
        originalSha256: String(digit).repeat(64),
        pageNumber: 3 + index,
        pageCount: 3 + index,
        sourceRasterSha256: String(digit + 1).repeat(64),
        recoveryRasterSha256: String(digit + 2).repeat(64),
      }))],
    });
    const tailBlankProofManifest = parseTailBlankProofManifest(JSON.stringify(proofValue), {
      executionMode: "backfill",
      expectedRunId: runId,
    });
    let recoveryCalls = 0;
    const result = await processPdfSpatially({
      inputPath: join(directory, "input.pdf"),
      outputPath: join(directory, "output.pdf"),
      geometryPath: join(directory, "geometry.json.gz"),
      workDir: directory,
      commandRunner: runner,
      geometryBackfillRunId: runId,
      originalSha256,
      tailBlankProofManifest,
      googleClient: {
        async annotateDocument() {
          return {
            responses: [
              { fullTextAnnotation: { pages: [{
                width: 100, height: 100,
                blocks: [{ paragraphs: [{ words: [word("Ord1", 10), word("Ord2", 30), word("Ord3", 50)] }] }],
              }] } },
              { fullTextAnnotation: { pages: [{
                width: 100, height: 100,
                blocks: [{ paragraphs: [{ words: [edgeArtifact] }] }],
              }] } },
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
        async annotateUnreadablePageVariants(page) {
          recoveryCalls += 1;
          assert.equal(page.pageNumber, 2);
          return {
            variants: ["colour", "contrast_gray", "threshold_185", "threshold_215"]
              .map((kind) => ({
                kind,
                response: { fullTextAnnotation: { pages: [] } },
                transform: {
                  pageNumber: 2,
                  sourceWidth: 100,
                  sourceHeight: 100,
                  visionWidth: 100,
                  visionHeight: 100,
                },
              })),
            retainedRasterBytes: 0,
            retainedVisionResponseBytes: 0,
          };
        },
      },
    });
    assert.equal(recoveryCalls, 1);
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.blankPageCount, 1);
    assert.equal(result.unreadablePageCount, 0);
    const geometry = JSON.parse(gunzipSync(await readFile(
      join(directory, "geometry.json.gz"),
    )).toString("utf8"));
    assert.deepEqual(geometry.tailBlankRecovery, {
      profile: "dfks-run-bound-tail-blank-v1",
      manifestDigest: proofValue.manifestDigest,
      pageNumbers: [2],
    });
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
    assert.equal(geometry.spatialVerificationProfile, SPATIAL_VERIFICATION_PROFILE);
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

test("sidenummer-retry kan ikke overskrive modstridende original OCR", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dfks-page-number-conflict-"));
  try {
    const sourceJpeg = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "white" },
    }).jpeg({ quality: 95 }).toBuffer();
    const visionResponse = (words) => ({ fullTextAnnotation: { pages: [{
      width: 100,
      height: 100,
      blocks: [{ paragraphs: [{ words: words.map((word) => ({
        confidence: word.confidence,
        boundingBox: { vertices: word.vertices },
        symbols: word.text.split("").map((symbol) => ({ text: symbol })),
      })) }] }],
    }] } });
    const pageNumberWord = {
      text: "2",
      confidence: 0.99,
      vertices: [
        { x: 47, y: 92 }, { x: 53, y: 92 },
        { x: 53, y: 96 }, { x: 47, y: 96 },
      ],
    };
    const conflictingWord = {
      text: "X",
      confidence: 0.99,
      vertices: [
        { x: 20, y: 20 }, { x: 20, y: 26 },
        { x: 16, y: 26 }, { x: 16, y: 20 },
      ],
    };
    const readableWords = [10, 40, 70].map((top, index) => ({
      text: `Ord${index + 1}`,
      confidence: 0.99,
      vertices: [
        { x: 10, y: top }, { x: 30, y: top },
        { x: 30, y: top + 8 }, { x: 10, y: top + 8 },
      ],
    }));
    const rotateClockwise = (point, degrees) => {
      if (degrees === 90) return { x: 100 - point.y, y: point.x };
      if (degrees === 180) return { x: 100 - point.x, y: 100 - point.y };
      if (degrees === 270) return { x: point.y, y: 100 - point.x };
      return point;
    };
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
        await writeFile(`${args.at(-1)}.jpg`, sourceJpeg);
        return { stdout: "", stderr: "" };
      }
      if (command === "pdftotext") {
        const target = args.at(-1);
        if (args.includes("-bbox-layout")) {
          await writeFile(target, "<page width=\"612\" height=\"792\"></page><page width=\"612\" height=\"792\"></page>");
        } else if (args[0] === "-f") {
          await writeFile(target, "");
        } else {
          await writeFile(target, "A".repeat(200));
        }
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
              visionResponse(readableWords),
              visionResponse([pageNumberWord, conflictingWord]),
            ],
            sourcePages: [1, 2].map((pageNumber) => ({ pageNumber, imageBytes: sourceJpeg })),
            visionPageTransforms: [1, 2].map((pageNumber) => ({
              pageNumber,
              sourceWidth: 100,
              sourceHeight: 100,
              visionWidth: 100,
              visionHeight: 100,
            })),
            retainedRasterBytes: sourceJpeg.length * 2,
            retainedVisionResponseBytes: 2_000,
          };
        },
        async annotateOrientationPageVariants(page) {
          retryCalls += 1;
          assert.equal(page.pageNumber, 2);
          return {
            variants: [0, 90, 180, 270].map((rotationDegrees) => ({
              kind: `rotate_${rotationDegrees}`,
              response: visionResponse([{
                ...pageNumberWord,
                vertices: pageNumberWord.vertices.map((point) => (
                  rotateClockwise(point, rotationDegrees)
                )),
              }]),
              transform: {
                pageNumber: 2,
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
    assert.equal(result.status, "needs_review");
    assert.equal(result.orientationQualityFailed, true);
    assert.deepEqual(result.affectedPageNumbers, [2]);
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

function shortTokenHorizontalScaleFixture({
  token = "i",
  actualToken = token,
  confidence = 0.95,
  target = { xMin: 20, yMin: 10, xMax: 30, yMax: 20 },
  actual = { xMin: 14.25, yMin: 10, xMax: 35.75, yMax: 20 },
  anchorY = 10,
} = {}) {
  const geometryWords = [{
    text: token,
    confidence,
    vertices: [
      { x: target.xMin, y: target.yMin }, { x: target.xMax, y: target.yMin },
      { x: target.xMax, y: target.yMax }, { x: target.xMin, y: target.yMax },
    ],
  }];
  const extractedWords = [{ text: actualToken, ...actual }];
  for (let index = 0; index < 49; index += 1) {
    const yMin = index === 0 ? anchorY : 40 + index * 20;
    const yMax = yMin + 10;
    const xMin = index === 0 ? 40 : 80;
    const xMax = index === 0 ? 70 : 120;
    const text = `Anker${index}`;
    geometryWords.push({
      text,
      confidence: 0.99,
      vertices: [
        { x: xMin, y: yMin }, { x: xMax, y: yMin },
        { x: xMax, y: yMax }, { x: xMin, y: yMax },
      ],
    });
    extractedWords.push({ text, xMin, yMin, xMax, yMax });
  }
  return {
    geometry: [{
      pageNumber: 1,
      imageWidth: 160,
      imageHeight: 1100,
      words: geometryWords,
    }],
    extracted: [{ width: 160, height: 1100, words: extractedWords }],
  };
}

test("v3 accepterer kun det kendte korte Poppler-breddeartefakt og bevarer v2", () => {
  const { geometry, extracted } = shortTokenHorizontalScaleFixture();
  const v2 = computeSpatialAccuracy(geometry, extracted, V2_SPATIAL_VERIFICATION_PROFILE);
  const v3 = computeSpatialAccuracy(geometry, extracted, SPATIAL_VERIFICATION_PROFILE);

  assert.deepEqual(v2, {
    expectedWords: 50,
    matchedWords: 50,
    measurableWords: 50,
    matchCoverage: 1,
    score: 49 / 50,
    medianIou: 1,
    centerInsideRatio: 1,
    passed: true,
  });
  assert.equal(v3.score, 1);
  assert.equal(v3.centerInsideRatio, 1);
  assert.equal(v3.passed, true);
});

test("v3 løfter den verificerede 150-token fixture uden at ændre IoU-målingerne", () => {
  const geometryWords = [];
  const extractedWords = [];
  for (let index = 0; index < 128; index += 1) {
    const yMin = 20 + index * 12;
    const text = `Eksakt${index}`;
    geometryWords.push({
      text,
      confidence: 0.99,
      vertices: [
        { x: 100, y: yMin }, { x: 140, y: yMin },
        { x: 140, y: yMin + 8 }, { x: 100, y: yMin + 8 },
      ],
    });
    extractedWords.push({ text, xMin: 100, yMin, xMax: 140, yMax: yMin + 8 });
  }
  for (let index = 0; index < 11; index += 1) {
    const yMin = 1600 + index * 14;
    const token = `x${index}`;
    geometryWords.push({
      text: token,
      confidence: 0.948 + index * 0.003,
      vertices: [
        { x: 20, y: yMin }, { x: 30, y: yMin },
        { x: 30, y: yMin + 10 }, { x: 20, y: yMin + 10 },
      ],
    }, {
      text: `Nabo${index}`,
      confidence: 0.99,
      vertices: [
        { x: 40, y: yMin }, { x: 70, y: yMin },
        { x: 70, y: yMin + 10 }, { x: 40, y: yMin + 10 },
      ],
    });
    extractedWords.push({
      text: token, xMin: 14.25, yMin, xMax: 35.75, yMax: yMin + 10,
    }, {
      text: `Nabo${index}`, xMin: 40, yMin, xMax: 70, yMax: yMin + 10,
    });
  }
  const geometry = [{
    pageNumber: 1, imageWidth: 180, imageHeight: 1800, words: geometryWords,
  }];
  const extracted = [{ width: 180, height: 1800, words: extractedWords }];
  const v2 = computeSpatialAccuracy(geometry, extracted, V2_SPATIAL_VERIFICATION_PROFILE);
  const v3 = computeSpatialAccuracy(geometry, extracted, SPATIAL_VERIFICATION_PROFILE);

  assert.equal(v2.expectedWords, 150);
  assert.equal(v2.matchedWords, 150);
  assert.equal(v2.score, 139 / 150);
  assert.equal(v2.centerInsideRatio, 1);
  assert.equal(v2.passed, false);
  assert.equal(v3.score, 1);
  assert.equal(v3.centerInsideRatio, 1);
  assert.equal(v3.medianIou, v2.medianIou);
  assert.equal(v3.passed, true);
});

test("v3 afviser lav confidence, forkert center, højde, bredde, lang og forkert tekst", () => {
  const cases = [
    shortTokenHorizontalScaleFixture({ confidence: 0.899 }),
    shortTokenHorizontalScaleFixture({
      actual: { xMin: 31, yMin: 10, xMax: 52.5, yMax: 20 },
    }),
    shortTokenHorizontalScaleFixture({
      actual: { xMin: 23.8, yMin: 10, xMax: 33.8, yMax: 20 },
    }),
    shortTokenHorizontalScaleFixture({
      actual: { xMin: 14.25, yMin: 12, xMax: 35.75, yMax: 18 },
    }),
    shortTokenHorizontalScaleFixture({
      actual: { xMin: 13.5, yMin: 10, xMax: 36.5, yMax: 20 },
    }),
    shortTokenHorizontalScaleFixture({ token: "femte" }),
    shortTokenHorizontalScaleFixture({ actualToken: "x" }),
  ];
  for (const { geometry, extracted } of cases) {
    const result = computeSpatialAccuracy(geometry, extracted, SPATIAL_VERIFICATION_PROFILE);
    assert.notEqual(result.score, 1);
  }
});

test("v3 kræver entydigt 1:1 tekstmatch og en pålidelig nabo på samme linje", () => {
  const withoutNeighbour = shortTokenHorizontalScaleFixture({ anchorY: 80 });
  assert.notEqual(computeSpatialAccuracy(
    withoutNeighbour.geometry,
    withoutNeighbour.extracted,
    SPATIAL_VERIFICATION_PROFILE,
  ).score, 1);

  const ambiguous = shortTokenHorizontalScaleFixture();
  ambiguous.geometry[0].words.push({
    ...ambiguous.geometry[0].words[0],
    vertices: [
      { x: 20, y: 10 }, { x: 30, y: 10 },
      { x: 30, y: 20 }, { x: 20, y: 20 },
    ],
  });
  ambiguous.extracted[0].words.push({
    text: "i", xMin: 14.25, yMin: 10, xMax: 35.75, yMax: 20,
  });
  assert.notEqual(computeSpatialAccuracy(
    ambiguous.geometry,
    ambiguous.extracted,
    SPATIAL_VERIFICATION_PROFILE,
  ).score, 1);
});

test("v3 begrænser breddeundtagelsen til højst tolv tokens pr. side", () => {
  const geometryWords = [];
  const extractedWords = [];
  for (let index = 0; index < 13; index += 1) {
    const yMin = 10 + index * 15;
    const token = `x${index}`;
    const anchor = `Nabo${index}`;
    geometryWords.push({
      text: token,
      confidence: 0.96,
      vertices: [
        { x: 20, y: yMin }, { x: 30, y: yMin },
        { x: 30, y: yMin + 10 }, { x: 20, y: yMin + 10 },
      ],
    }, {
      text: anchor,
      confidence: 0.99,
      vertices: [
        { x: 40, y: yMin }, { x: 70, y: yMin },
        { x: 70, y: yMin + 10 }, { x: 40, y: yMin + 10 },
      ],
    });
    extractedWords.push({
      text: token, xMin: 14.25, yMin, xMax: 35.75, yMax: yMin + 10,
    }, {
      text: anchor, xMin: 40, yMin, xMax: 70, yMax: yMin + 10,
    });
  }
  for (let index = 0; index < 150; index += 1) {
    const yMin = 250 + index * 8;
    const text = `Eksakt${index}`;
    geometryWords.push({
      text,
      confidence: 0.99,
      vertices: [
        { x: 20, y: yMin }, { x: 60, y: yMin },
        { x: 60, y: yMin + 6 }, { x: 20, y: yMin + 6 },
      ],
    });
    extractedWords.push({ text, xMin: 20, yMin, xMax: 60, yMax: yMin + 6 });
  }
  const result = computeSpatialAccuracy([{
    pageNumber: 1, imageWidth: 100, imageHeight: 1500, words: geometryWords,
  }], [{ width: 100, height: 1500, words: extractedWords }], SPATIAL_VERIFICATION_PROFILE);
  assert.equal(result.expectedWords, 176);
  assert.equal(result.score, 163 / 176);
  assert.notEqual(result.score, 1);
});

test("v3 begrænser breddeundtagelsen til højst otte procent af en side", () => {
  const geometryWords = [];
  const extractedWords = [];
  for (let index = 0; index < 5; index += 1) {
    const yMin = 10 + index * 15;
    const token = `x${index}`;
    const anchor = `Nabo${index}`;
    geometryWords.push({
      text: token,
      confidence: 0.96,
      vertices: [
        { x: 20, y: yMin }, { x: 30, y: yMin },
        { x: 30, y: yMin + 10 }, { x: 20, y: yMin + 10 },
      ],
    }, {
      text: anchor,
      confidence: 0.99,
      vertices: [
        { x: 40, y: yMin }, { x: 70, y: yMin },
        { x: 70, y: yMin + 10 }, { x: 40, y: yMin + 10 },
      ],
    });
    extractedWords.push({
      text: token, xMin: 14.25, yMin, xMax: 35.75, yMax: yMin + 10,
    }, {
      text: anchor, xMin: 40, yMin, xMax: 70, yMax: yMin + 10,
    });
  }
  for (let index = 0; index < 40; index += 1) {
    const yMin = 100 + index * 10;
    const text = `Eksakt${index}`;
    geometryWords.push({
      text,
      confidence: 0.99,
      vertices: [
        { x: 20, y: yMin }, { x: 60, y: yMin },
        { x: 60, y: yMin + 8 }, { x: 20, y: yMin + 8 },
      ],
    });
    extractedWords.push({ text, xMin: 20, yMin, xMax: 60, yMax: yMin + 8 });
  }
  const result = computeSpatialAccuracy([{
    pageNumber: 1, imageWidth: 100, imageHeight: 520, words: geometryWords,
  }], [{ width: 100, height: 520, words: extractedWords }], SPATIAL_VERIFICATION_PROFILE);
  assert.equal(result.expectedWords, 50);
  assert.equal(result.score, 45 / 50);
  assert.equal(result.passed, false);
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

test("legacy-profilen bevarer max tre tokens uden de nye geometri- og tegnporte", () => {
  const geometry = [{
    pageNumber: 1,
    imageWidth: 100,
    imageHeight: 100,
    words: [{
      text: `${"a".repeat(50)}${"b".repeat(50)}`,
      vertices: [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }, { x: 10, y: 40 }],
    }],
  }];
  const extracted = [{
    width: 100,
    height: 100,
    words: [
      { text: "a".repeat(50), xMin: 10, yMin: 10, xMax: 40, yMax: 20 },
      { text: "b".repeat(50), xMin: 10, yMin: 30, xMax: 40, yMax: 40 },
    ],
  }];

  const legacy = computeSpatialAccuracy(
    geometry,
    extracted,
    LEGACY_SPATIAL_VERIFICATION_PROFILE,
  );
  const current = computeSpatialAccuracy(geometry, extracted, SPATIAL_VERIFICATION_PROFILE);
  assert.deepEqual(legacy, {
    expectedWords: 1,
    matchedWords: 1,
    measurableWords: 1,
    matchCoverage: 1,
    score: 1,
    medianIou: 1,
    centerInsideRatio: 1,
    passed: true,
  });
  assert.equal(current.passed, false);
  assert.equal(current.matchCoverage, 0);
});

test("legacy-golden matcher tre tokens over stor afstand uden ny geometrygate", () => {
  const parts = ["arbejds", "markeds", "aftale"];
  const geometry = [{
    pageNumber: 1,
    imageWidth: 120,
    imageHeight: 40,
    words: parts.map((text, index) => ({
      text,
      vertices: [
        { x: 10 + index * 40, y: 10 }, { x: 20 + index * 40, y: 10 },
        { x: 20 + index * 40, y: 20 }, { x: 10 + index * 40, y: 20 },
      ],
    })),
  }];
  const extracted = [{
    width: 120,
    height: 40,
    words: [{ text: parts.join(""), xMin: 10, yMin: 10, xMax: 100, yMax: 20 }],
  }];

  assert.deepEqual(computeSpatialAccuracy(
    geometry,
    extracted,
    LEGACY_SPATIAL_VERIFICATION_PROFILE,
  ), {
    expectedWords: 3,
    matchedWords: 3,
    measurableWords: 3,
    matchCoverage: 1,
    score: 1,
    medianIou: 1,
    centerInsideRatio: 1,
    passed: true,
  });
  assert.equal(computeSpatialAccuracy(
    geometry,
    extracted,
    SPATIAL_VERIFICATION_PROFILE,
  ).matchedWords, 0);
});

test("legacy-profilen kan ikke bruge den nye otte-token-sammenføjning", () => {
  const parts = ["en", "to", "tre", "fire", "fem", "seks", "syv", "otte"];
  const geometry = [{
    pageNumber: 1,
    imageWidth: 220,
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
    width: 220,
    height: 40,
    words: [{ text: parts.join(""), xMin: 10, yMin: 10, xMax: 200, yMax: 20 }],
  }];

  assert.equal(computeSpatialAccuracy(
    geometry,
    extracted,
    LEGACY_SPATIAL_VERIFICATION_PROFILE,
  ).matchedWords, 0);
  assert.equal(computeSpatialAccuracy(
    geometry,
    extracted,
    SPATIAL_VERIFICATION_PROFILE,
  ).matchedWords, 8);
});

test("ukendt spatial-verifikationsprofil afvises fail-closed", () => {
  assert.throws(
    () => computeSpatialAccuracy([], [], "ukendt-profil"),
    /invalid_spatial_verification_profile/,
  );
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
