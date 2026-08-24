import test from "node:test"
import assert from "node:assert/strict"
import { resolveOtherSupplements } from "../lib/contract-supplements"

test("bevarer strukturerede tillæg", () => {
  const supplements = [{ category: "rejsetillaeg", amount: 500 }]
  assert.deepEqual(resolveOtherSupplements({ otherSupplements: supplements }), supplements)
})

test("udfylder manglende tillægsenhed fra kontraktens ugeløn", () => {
  assert.deepEqual(resolveOtherSupplements({
    salaryUnit: "weekly",
    otherSupplements: [{ category: "rejsetillaeg", amount: 500, unit: null }],
  }), [{ category: "rejsetillaeg", amount: 500, unit: "pr. uge" }])
})

test("bevarer en eksplicit enhed på et tillæg", () => {
  assert.deepEqual(resolveOtherSupplements({
    salaryUnit: "weekly",
    otherSupplements: [{ category: "rejsetillaeg", amount: 500, unit: "engangsbeløb" }],
  }), [{ category: "rejsetillaeg", amount: 500, unit: "engangsbeløb" }])
})

test("filtrerer medarbejderbetalte udgifter og lønfradrag fra tillæg", () => {
  assert.deepEqual(resolveOtherSupplements({
    otherSupplements: [{
      category: "diaeter",
      amount: 200,
      unit: "pr. uge",
      note: "Kantineordning",
      sourceText: "Satsen er kr. 200 per uge, der vil blive trukket i Leverandørens løn/honorar.",
    }],
  }), [])
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
    salaryUnit: "weekly",
    _sources: {
      otherSupplements: "Fast tillæg for over- og forskudttid kr. 3.000",
      otherSupplements_clause_id: "s1_c7",
    },
  }), [{
    category: "overtidstillaeg",
    amount: 3000,
    unit: "pr. uge",
    note: "Fast tillæg for over- og forskudttid",
    sourceText: "Fast tillæg for over- og forskudttid kr. 3.000",
    clauseId: "s1_c7",
  }])
})

test("udleder enheden direkte fra tillæggets kildetekst", () => {
  assert.equal(resolveOtherSupplements({
    _sources: {
      otherSupplements: "Fast tillæg for over- og forskudttid pr. uge kr. 3.000",
    },
  })[0]?.unit, "pr. uge")
})

test("opfinder ikke et tillæg fra en ukendt kildeformulering", () => {
  assert.deepEqual(resolveOtherSupplements({
    _sources: { otherSupplements: "Eventuelle tillæg aftales senere" },
  }), [])
})
