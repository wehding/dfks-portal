import test from "node:test"
import assert from "node:assert/strict"
import { resolveContractProlongation } from "../lib/contract-prolongation"

test("beregner ekstra prolongation fra en samlet maksimumsramme", () => {
  assert.deepEqual(resolveContractProlongation({
    workingWeeks: 19,
    prolongationWeeks: 24,
    prolongationNote: "Med mulighed for prolongation i indtil 24 uger.",
  }), {
    prolongationWeeks: 5,
    prolongationAmount: 5,
    prolongationUnit: "weeks",
    prolongationTotalWeeks: 24,
    prolongationInterpretation: "total_limit",
    needsManualProlongationReview: true,
    prolongationNote: "Prolongation op til 5 uger (24 uger samlet minus 19 engagerede uger).",
  })
})

test("bevarer et direkte antal ekstra prolongationsuger", () => {
  assert.deepEqual(resolveContractProlongation({
    workingWeeks: 19,
    prolongationWeeks: 2,
    prolongationAmount: 2,
    prolongationUnit: "weeks",
    prolongationNote: "Op til 2 ugers prolongation.",
  }), {
    prolongationWeeks: 2,
    prolongationAmount: 2,
    prolongationUnit: "weeks",
    prolongationTotalWeeks: null,
    prolongationInterpretation: "additional",
    needsManualProlongationReview: false,
    prolongationNote: "Op til 2 ugers prolongation.",
  })
})

test("bevarer tre dages prolongation uden at runde op til en uge", () => {
  assert.deepEqual(resolveContractProlongation({
    prolongationWeeks: 1,
    prolongationNote: "Med mulighed for prolongation i 3 dage.",
  }), {
    prolongationWeeks: 0.6,
    prolongationAmount: 3,
    prolongationUnit: "days",
    prolongationTotalWeeks: null,
    prolongationInterpretation: "additional",
    needsManualProlongationReview: false,
    prolongationNote: "Med mulighed for prolongation i 3 dage.",
  })
})

test("genkender også formuleringen tre dages prolongation", () => {
  const result = resolveContractProlongation({
    prolongationWeeks: 1,
    _sources: { prolongation: "[s2_c4] mulighed for 3 dages prolongation" },
  })
  assert.equal(result.prolongationWeeks, 0.6)
  assert.equal(result.prolongationAmount, 3)
  assert.equal(result.prolongationUnit, "days")
})
