import assert from "node:assert/strict";
import test from "node:test";

import {
  hasSparseTailBlankConsensus,
  recoverSparseTailOrientationFromVariants,
  recoverSparseTailTextFromVariants,
} from "./tail-page-recovery.mjs";

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
  const evidence = {
    width: 600,
    height: 1_000,
    nonWhiteRatio: 0.004,
    darkRatio: 0.001,
    mean: 253,
    stdev: 8,
    maxLocalNonWhiteRatio: 0.03,
    maxLocalDarkRatio: 0.008,
  };
  assert.equal(hasSparseTailBlankConsensus({
    pageNumber: 8,
    pageCount: 8,
    variantPages: emptyVariants,
    sourceEvidence: evidence,
    recoveryEvidence: { ...evidence, nonWhiteRatio: 0.0045, mean: 252.5 },
  }), true);
  assert.equal(hasSparseTailBlankConsensus({
    pageNumber: 8,
    pageCount: 8,
    variantPages: [
      ...emptyVariants.slice(0, 3),
      sparsePage({ words: [word("Signatur")] }),
    ],
    sourceEvidence: evidence,
    recoveryEvidence: evidence,
  }), false);
  assert.equal(hasSparseTailBlankConsensus({
    pageNumber: 8,
    pageCount: 8,
    variantPages: emptyVariants,
    sourceEvidence: evidence,
    recoveryEvidence: { ...evidence, maxLocalDarkRatio: 0.08 },
  }), false);
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
