import assert from "node:assert/strict";
import test from "node:test";

import { classifyPageText, computeSpatialAccuracy, parsePdftotextBbox } from "./spatial-ocr.mjs";

test("native tekst og billedside klassificeres forskelligt", () => {
  assert.equal(classifyPageText("Dette er en almindelig kontrakttekst med mere end otte tydelige danske ord.").classification, "native_text");
  assert.equal(classifyPageText("").classification, "image_only");
});

test("geometrisk præcision måles mod PDF-tekstlaget", () => {
  const extracted = parsePdftotextBbox('<page width="100" height="100"><word xMin="10" yMin="20" xMax="30" yMax="30">Hej</word></page>');
  const geometry = [{ pageNumber: 1, imageWidth: 100, imageHeight: 100, words: [{ text: "Hej", vertices: [
    { x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 10, y: 30 },
  ] }] }];
  const result = computeSpatialAccuracy(geometry, extracted);
  assert.equal(result.passed, true);
  assert.equal(result.score, 1);
  assert.equal(result.medianIou, 1);
});
