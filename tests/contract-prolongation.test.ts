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
    prolongationNote: "Op til 2 ugers prolongation.",
  }), {
    prolongationWeeks: 2,
    prolongationTotalWeeks: null,
    prolongationInterpretation: "additional",
    needsManualProlongationReview: false,
    prolongationNote: "Op til 2 ugers prolongation.",
  })
})
