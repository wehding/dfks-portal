import test from "node:test"
import assert from "node:assert/strict"
import { resolvePensionSupplement } from "../lib/contract-pension"

test("bevarer et eksplicit struktureret pensionsbeløb", () => {
  assert.equal(resolvePensionSupplement({ pensionSupplement: 1330 }), 1330)
})

test("finder pensionsbeløb efter kr. uden at bruge procentsatsen", () => {
  assert.equal(resolvePensionSupplement({
    pensionPercent: 7.6,
    _sources: { pension: "Freelancerens pensionstillæg er 7,6% og udgør pr. uge kr. 702,92" },
  }), 702.92)
})

test("finder pensionsbeløb før valuta", () => {
  assert.equal(resolvePensionSupplement({
    _sources: { pension: "Pensionsbidrag 1.330 DKK pr. uge" },
  }), 1330)
})

test("beregner ikke beløb ud fra en procentsats alene", () => {
  assert.equal(resolvePensionSupplement({
    pensionPercent: 7.6,
    _sources: { pension: "Pensionstillægget udgør 7,6%" },
  }), null)
})
