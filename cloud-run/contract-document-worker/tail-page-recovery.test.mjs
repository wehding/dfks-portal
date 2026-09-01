import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  hasSparseTailBlankConsensus,
  isSparseTailEdgeArtifactCandidate,
  recoverSparseTailOrientationFromVariants,
  recoverSparseTailTextFromVariants,
  recoverTailOrientationFromVariants,
  recoverTailPageNumberOrientationFromVariants,
} from "./tail-page-recovery.mjs";
import {
  authoriseTailBlankProof,
  createTailBlankProofManifest,
  parseTailBlankProofManifest,
} from "./tail-blank-proof.mjs";

const PROOF_RUN_ID = "33333333-3333-4333-8333-333333333333";
const PROOF_ORIGINAL_HASH = "1".repeat(64);
const PROOF_SOURCE_BYTES = Buffer.from("synthetic-source-raster");
const PROOF_RECOVERY_BYTES = Buffer.from("synthetic-recovery-raster");

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sparseTailProofToken(pageNumber = 8, pageCount = 8) {
  const primaryEntry = {
    originalSha256: PROOF_ORIGINAL_HASH,
    pageNumber,
    pageCount,
    sourceRasterSha256: digest(PROOF_SOURCE_BYTES),
    recoveryRasterSha256: digest(PROOF_RECOVERY_BYTES),
  };
  const value = createTailBlankProofManifest({
    runId: PROOF_RUN_ID,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    entries: [primaryEntry, ...[4, 5, 6, 7].map((digit, index) => ({
      originalSha256: String(digit).repeat(64),
      pageNumber: pageCount + index + 1,
      pageCount: pageCount + index + 1,
      sourceRasterSha256: String(digit + 1).repeat(64),
      recoveryRasterSha256: String(digit + 2).repeat(64),
    }))],
  });
  const manifest = parseTailBlankProofManifest(JSON.stringify(value), {
    executionMode: "backfill",
    expectedRunId: PROOF_RUN_ID,
  });
  return authoriseTailBlankProof(manifest, {
    runId: PROOF_RUN_ID,
    originalSha256: PROOF_ORIGINAL_HASH,
    pageNumber,
    pageCount,
    sourceRasterBytes: PROOF_SOURCE_BYTES,
    recoveryRasterBytes: PROOF_RECOVERY_BYTES,
  });
}

function word(text, {
  left = 20,
  top = 30,
  width = 80,
  height = 20,
  confidence = 0.99,
  direction = 0,
} = {}) {
  const horizontal = [
    { x: left, y: top },
    { x: left + width, y: top },
    { x: left + width, y: top + height },
    { x: left, y: top + height },
  ];
  const vertical = [
    { x: left, y: top },
    { x: left, y: top + width },
    { x: left - height, y: top + width },
    { x: left - height, y: top },
  ];
  return { text, confidence, vertices: direction === 90 ? vertical : horizontal };
}

function sparsePage({
  pageNumber = 8,
  words = [word("Slutnote")],
  width = 600,
  height = 1_000,
  rotation,
} = {}) {
  return {
    pageNumber,
    imageWidth: width,
    imageHeight: height,
    words,
    ...(rotation == null ? {} : { recoveryRotationDegrees: rotation }),
  };
}

function blankEvidence(overrides = {}) {
  return {
    width: 600,
    height: 1_000,
    nonWhiteRatio: 0.0014,
    darkRatio: 0.00001,
    mean: 254.95,
    stdev: 1,
    maxLocalNonWhiteRatio: 0.9,
    maxLocalDarkRatio: 0.8,
    edgeMarginXRatio: 0.012,
    edgeMarginYRatio: 0.012,
    interiorCoverageRatio: 0.95,
    interiorNonWhiteRatio: 0.0013,
    interiorDarkRatio: 0.00001,
    interiorMean: 254.96,
    interiorStdev: 0.9,
    maxInteriorLocalNonWhiteRatio: 0.01,
    maxInteriorLocalDarkRatio: 0.002,
    ...overrides,
  };
}

test("sparse sluttekst kræver mindst to nøjagtigt enige højkonfidensvarianter", () => {
  const variants = [0, 1, 2, 3].map((index) => sparsePage({
    words: [word("Slutnote", { left: 20 + index * 0.2 })],
  }));
  const recovered = recoverSparseTailTextFromVariants(variants, {
    pageNumber: 8,
    pageCount: 8,
  });
  assert.equal(recovered?.recoveryProfile, "vision-sparse-tail-text-consensus-v1");
  assert.equal(recovered?.words[0].text, "Slutnote");

  assert.equal(recoverSparseTailTextFromVariants([
    variants[0],
    sparsePage({ words: [word("Andetord")] }),
  ], { pageNumber: 8, pageCount: 8 }), null);
  assert.equal(recoverSparseTailTextFromVariants([
    variants[0],
    sparsePage({ words: [word("Slutnote", { confidence: 0.6 })] }),
  ], { pageNumber: 8, pageCount: 8 }), null);
  assert.equal(recoverSparseTailTextFromVariants(variants, {
    pageNumber: 7,
    pageCount: 8,
  }), null);
  assert.equal(recoverSparseTailTextFromVariants([
    variants[0],
    { ...variants[1], imageWidth: undefined },
  ], { pageNumber: 8, pageCount: 8 }), null);
});

test("tom slutsider kræver både tomme Vision-varianter og to enige rastermålinger", () => {
  const emptyVariants = [0, 1, 2, 3].map(() => sparsePage({ words: [] }));
  const evidence = blankEvidence();
  assert.equal(hasSparseTailBlankConsensus({
    pageNumber: 8,
    pageCount: 8,
    variantPages: emptyVariants,
    sourceEvidence: evidence,
    recoveryEvidence: { ...evidence, nonWhiteRatio: 0.00145, mean: 254.9 },
    proofToken: sparseTailProofToken(),
  }), true);
  assert.equal(hasSparseTailBlankConsensus({
    pageNumber: 8,
    pageCount: 8,
    variantPages: emptyVariants,
    sourceEvidence: evidence,
    recoveryEvidence: evidence,
  }), false);
  assert.equal(hasSparseTailBlankConsensus({
    pageNumber: 8,
    pageCount: 8,
    variantPages: [
      ...emptyVariants.slice(0, 3),
      sparsePage({ words: [word("Signatur")] }),
    ],
    sourceEvidence: evidence,
    recoveryEvidence: evidence,
    proofToken: sparseTailProofToken(),
  }), false);
  assert.equal(hasSparseTailBlankConsensus({
    pageNumber: 8,
    pageCount: 8,
    variantPages: emptyVariants,
    sourceEvidence: evidence,
    recoveryEvidence: blankEvidence({ maxInteriorLocalDarkRatio: 0.08 }),
    proofToken: sparseTailProofToken(),
  }), false);
});

test("scanner-randstøj må kun skjule højst to korte lav-confidence artefakter", () => {
  const edgeArtifact = word("x", {
    left: 560, top: 400, width: 12, height: 4, confidence: 0.2,
  });
  const secondEdgeArtifact = word("zz", {
    left: 1, top: 200, width: 4, height: 12, confidence: 0.77,
  });
  const punctuationArtifact = word(".", {
    left: 580, top: 700, width: 5, height: 5, confidence: 0.7,
  });
  const variants = [
    sparsePage({ words: [edgeArtifact, secondEdgeArtifact] }),
    sparsePage({ words: [edgeArtifact] }),
    sparsePage({ words: [] }),
    sparsePage({ words: [secondEdgeArtifact, punctuationArtifact] }),
  ];
  assert.equal(isSparseTailEdgeArtifactCandidate(variants[0], {
    pageNumber: 8,
    pageCount: 8,
  }), true);
  assert.equal(hasSparseTailBlankConsensus({
    pageNumber: 8,
    pageCount: 8,
    variantPages: variants,
    sourceEvidence: blankEvidence(),
    recoveryEvidence: blankEvidence({ nonWhiteRatio: 0.00145, mean: 254.9 }),
    proofToken: sparseTailProofToken(),
  }), true);

  const rejects = [
    sparsePage({ words: [word("8", {
      left: 290, top: 990, width: 20, height: 5, confidence: 0.2,
    })] }),
    sparsePage({ words: [word("x", {
      left: 100, top: 1, width: 12, height: 4, confidence: 0.801,
    })] }),
    sparsePage({ words: [word("x", {
      left: 535, top: 400, width: 12, height: 4, confidence: 0.801,
    })] }),
    sparsePage({ words: [word("tekst", {
      left: 100, top: 1, width: 12, height: 4, confidence: 0.2,
    })] }),
    sparsePage({ words: [word("aftale", {
      left: 535, top: 400, width: 20, height: 4, confidence: 0.2,
    })] }),
    sparsePage({ words: [word("8", {
      left: 535, top: 400, width: 12, height: 4, confidence: 0.2,
    })] }),
    sparsePage({ words: [word("x", {
      left: 500, top: 100, width: 12, height: 4, confidence: 0.2,
    })] }),
    sparsePage({ words: [word("x", {
      left: 300, top: 50, width: 12, height: 4, confidence: 0.2,
    })] }),
    sparsePage({ words: [edgeArtifact, secondEdgeArtifact, word("q", {
      left: 300, top: 1, width: 6, height: 4, confidence: 0.1,
    })] }),
  ];
  for (const rejected of rejects) {
    assert.equal(isSparseTailEdgeArtifactCandidate(rejected, {
      pageNumber: 8,
      pageCount: 8,
    }), false);
    assert.equal(hasSparseTailBlankConsensus({
      pageNumber: 8,
      pageCount: 8,
      variantPages: [rejected, ...variants.slice(1)],
      sourceEvidence: blankEvidence(),
      recoveryEvidence: blankEvidence(),
      proofToken: sparseTailProofToken(),
    }), false);
  }
});

test("randstøj kan ikke skjule signatur eller tekst i indholdsfeltet", () => {
  const emptyVariants = [0, 1, 2, 3].map(() => sparsePage({ words: [] }));
  for (const unsafeEvidence of [
    blankEvidence({ nonWhiteRatio: 0.0021 }),
    blankEvidence({ darkRatio: 0.00011 }),
    blankEvidence({ mean: 254.49 }),
    blankEvidence({ stdev: 3.01 }),
    blankEvidence({ interiorNonWhiteRatio: 0.001751 }),
    blankEvidence({ interiorDarkRatio: 0.000051 }),
    blankEvidence({ interiorMean: 254.69 }),
    blankEvidence({ interiorStdev: 2.01 }),
    blankEvidence({ maxInteriorLocalNonWhiteRatio: 0.256 }),
    blankEvidence({ maxInteriorLocalDarkRatio: 0.021 }),
    blankEvidence({ edgeMarginXRatio: 0.013 }),
    blankEvidence({ interiorCoverageRatio: 0.89 }),
  ]) {
    assert.equal(hasSparseTailBlankConsensus({
      pageNumber: 8,
      pageCount: 8,
      variantPages: emptyVariants,
      sourceEvidence: blankEvidence(),
      recoveryEvidence: unsafeEvidence,
      proofToken: sparseTailProofToken(),
    }), false);
  }
});

function pageNumberVariants({
  pageNumber = 8,
  text = String(pageNumber),
  confidence = 0.99,
  left = 285,
  top = 950,
} = {}) {
  return [0, 90, 180, 270].map((rotation, index) => sparsePage({
    pageNumber,
    rotation,
    words: [word(text, {
      left: left + index * 0.1,
      top,
      width: 30,
      height: 15,
      confidence,
    })],
  }));
}

function pageNumberContext(variants, overrides = {}) {
  const originalPage = {
    pageNumber: variants[0].pageNumber,
    imageWidth: variants[0].imageWidth,
    imageHeight: variants[0].imageHeight,
    words: variants[0].words,
  };
  return { pageNumber: 8, pageCount: 8, originalPage, ...overrides };
}

test("eksakt sidenummer alene får kun orientering 0 ved fire fulde konsensusvarianter", () => {
  const variants = pageNumberVariants();
  const recovered = recoverTailPageNumberOrientationFromVariants(
    variants,
    pageNumberContext(variants),
  );
  assert.equal(recovered?.page.recoveryProfile, "vision-tail-page-number-consensus-v1");
  assert.equal(recovered?.page.recoveryRotationDegrees, 0);
  assert.equal(recoverTailOrientationFromVariants(
    variants,
    pageNumberContext(variants),
  )?.orientation.correctionDegrees, 0);
  assert.deepEqual(recovered?.orientation, {
    reliable: true,
    detectedDegrees: 0,
    correctionDegrees: 0,
    confidence: 0.99,
    acceptedWords: 1,
  });

  const topVariants = pageNumberVariants({ top: 20 });
  assert.equal(recoverTailPageNumberOrientationFromVariants(
    topVariants,
    pageNumberContext(topVariants),
  )?.orientation.correctionDegrees, 0);

  const pixelJitterVariants = variants.map((page, index) => (index === 3
    ? sparsePage({
      rotation: 270,
      words: [word("8", {
        left: 284.8,
        top: 950.6,
        width: 31.2,
        height: 13.8,
        confidence: 0.99,
      })],
    })
    : page));
  assert.equal(recoverTailPageNumberOrientationFromVariants(
    pixelJitterVariants,
    pageNumberContext(variants),
  )?.orientation.correctionDegrees, 0);
});

test("sidenummer-undtagelsen afviser alle tvetydige eller ekstra signaler", () => {
  const variants = pageNumberVariants();
  const rejectedVariantSets = [
    variants.slice(0, 3),
    pageNumberVariants({ text: "8." }),
    pageNumberVariants({ text: "Side 8" }),
    pageNumberVariants({ text: "7" }),
    pageNumberVariants({ confidence: 0.949 }),
    pageNumberVariants({ left: 30 }),
    pageNumberVariants({ top: 450 }),
    variants.map((page, index) => (index === 3
      ? { ...page, recoveryRotationDegrees: 180 }
      : page)),
    variants.map((page, index) => (index === 3
      ? {
        ...page,
        words: page.words.map((entry) => ({
          ...entry,
          vertices: entry.vertices.map((point) => ({ x: point.x + 80, y: point.y })),
        })),
      }
      : page)),
    variants.map((page, index) => (index === 3
      ? { ...page, words: [...page.words, word("x")] }
      : page)),
  ];
  for (const rejected of rejectedVariantSets) {
    assert.equal(recoverTailPageNumberOrientationFromVariants(
      rejected,
      pageNumberContext(variants),
    ), null);
  }
  assert.equal(recoverTailPageNumberOrientationFromVariants(
    variants,
    pageNumberContext(variants, { pageNumber: 7 }),
  ), null);
  assert.equal(recoverTailPageNumberOrientationFromVariants(variants, {
    pageNumber: 8,
    pageCount: 8,
  }), null);
  assert.equal(recoverTailPageNumberOrientationFromVariants(
    variants,
    pageNumberContext(variants, {
      originalPage: {
        ...pageNumberContext(variants).originalPage,
        words: [
          ...pageNumberContext(variants).originalPage.words,
          word("Kontrakt", { left: 100, top: 100, width: 50, height: 12 }),
        ],
      },
    }),
  ), null);
  assert.equal(recoverTailPageNumberOrientationFromVariants(
    variants,
    pageNumberContext(variants, {
      originalPage: {
        ...pageNumberContext(variants).originalPage,
        words: [word("8", { left: 100, top: 950, width: 30, height: 15 })],
      },
    }),
  ), null);
});

test("sparse orientering bevarer 0,70-grænsen og returnerer canonical ikke dobbeltroteret side", () => {
  const variants = [0, 90, 180, 270].map((rotation, index) => sparsePage({
    rotation,
    words: [word("Underskrift", {
      left: 300 + index * 0.1,
      top: 400,
      width: 30,
      height: 12,
      direction: 90,
    })],
  }));
  const recovered = recoverSparseTailOrientationFromVariants(variants, {
    pageNumber: 8,
    pageCount: 8,
  });
  assert.equal(recovered?.orientation.reliable, true);
  assert.equal(recovered?.orientation.confidence, 1);
  assert.equal(recovered?.orientation.correctionDegrees, 90);
  assert.equal(recovered?.page.imageWidth, 600);
  assert.equal(recovered?.page.imageHeight, 1_000);
  assert.deepEqual(recovered?.page.words[0].vertices, variants[0].words[0].vertices);

  const belowGate = variants.map((page) => ({
    ...page,
    words: [
      ...page.words,
      word("Modstøj", { left: 100, top: 100, width: 20, direction: 0 }),
    ],
  }));
  assert.equal(recoverSparseTailOrientationFromVariants(belowGate, {
    pageNumber: 8,
    pageCount: 8,
  }), null);
  assert.equal(recoverSparseTailOrientationFromVariants(variants, {
    pageNumber: 8,
    pageCount: 9,
  }), null);
  assert.equal(recoverSparseTailOrientationFromVariants(variants.map((page, index) => (
    index === 3 ? { ...page, recoveryRotationDegrees: 45 } : page
  )), { pageNumber: 8, pageCount: 8 }), null);
});

test("sparse orientering afviser tekst- og geometrikonflikter", () => {
  const variants = [0, 90, 180, 270].map((rotation) => sparsePage({
    rotation,
    words: [word("Underskrift", {
      left: 300,
      top: 400,
      width: 30,
      height: 12,
      direction: 90,
    })],
  }));
  assert.equal(recoverSparseTailOrientationFromVariants(variants.map((page, index) => (
    index === 3 ? { ...page, words: [word("Andetnavn", { direction: 90, width: 30 })] } : page
  )), { pageNumber: 8, pageCount: 8 }), null);
  assert.equal(recoverSparseTailOrientationFromVariants(variants.map((page, index) => (
    index === 3
      ? {
        ...page,
        words: page.words.map((entry) => ({
          ...entry,
          vertices: entry.vertices.map((point) => ({ x: point.x + 100, y: point.y })),
        })),
      }
      : page
  )), { pageNumber: 8, pageCount: 8 }), null);
});
