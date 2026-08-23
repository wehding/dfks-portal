import test from "node:test"
import assert from "node:assert/strict"
import { resolveOtherSupplements } from "../lib/contract-supplements"

test("bevarer strukturerede tillæg", () => {
  const supplements = [{ category: "rejsetillaeg", amount: 500 }]
  assert.deepEqual(resolveOtherSupplements({ otherSupplements: supplements }), supplements)
})

test("retter ældre kategorisering af fast over- og forskudttidstillæg", () => {
  assert.deepEqual(resolveOtherSupplements({
    otherSupplements: [{
      category: "genetillaeg",
      amount: 3000,
      note: "Over- og forskudttid",
      sourceText: "Fast tillæg for over- og forskudttid kr. 3.000",
    }],
  })[0]?.category, "overtidstillaeg")
})

test("gendanner fast tillæg for over- og forskudttid fra AI-kilden", () => {
  assert.deepEqual(resolveOtherSupplements({
    _sources: {
      otherSupplements: "Fast tillæg for over- og forskudttid kr. 3.000",
      otherSupplements_clause_id: "s1_c7",
    },
  }), [{
    category: "overtidstillaeg",
    amount: 3000,
    unit: null,
    note: "Fast tillæg for over- og forskudttid",
    sourceText: "Fast tillæg for over- og forskudttid kr. 3.000",
    clauseId: "s1_c7",
  }])
})

test("opfinder ikke et tillæg fra en ukendt kildeformulering", () => {
  assert.deepEqual(resolveOtherSupplements({
    _sources: { otherSupplements: "Eventuelle tillæg aftales senere" },
  }), [])
})
