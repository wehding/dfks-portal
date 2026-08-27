import assert from "node:assert/strict"
import test from "node:test"

import { allocateByLargestRemainder } from "../lib/rights-largest-remainder"

test("largest remainder afstemmer præcist til totalen", () => {
  const result = allocateByLargestRemainder(100, [
    { id: "a", weight: 1 },
    { id: "b", weight: 1 },
    { id: "c", weight: 1 },
  ])

  assert.deepEqual(result, [
    { id: "a", amount: 34 },
    { id: "b", amount: 33 },
    { id: "c", amount: 33 },
  ])
  assert.equal(result.reduce((sum, row) => sum + row.amount, 0), 100)
})

test("tie-breaker er stigende stabilt id uanset inputrækkefølge", () => {
  const first = allocateByLargestRemainder(2, [
    { id: "c", weight: 1 },
    { id: "a", weight: 1 },
    { id: "b", weight: 1 },
  ])
  const second = allocateByLargestRemainder(2, [
    { id: "b", weight: 1 },
    { id: "c", weight: 1 },
    { id: "a", weight: 1 },
  ])

  assert.deepEqual(Object.fromEntries(first.map((row) => [row.id, row.amount])), { a: 1, b: 1, c: 0 })
  assert.deepEqual(Object.fromEntries(second.map((row) => [row.id, row.amount])), { a: 1, b: 1, c: 0 })
})

test("afviser ugyldige beløb, dublet-id'er og tom positiv fordeling", () => {
  assert.throws(() => allocateByLargestRemainder(1.5, [{ id: "a", weight: 1 }]))
  assert.throws(() => allocateByLargestRemainder(1, [{ id: "a", weight: 1 }, { id: "a", weight: 2 }]))
  assert.throws(() => allocateByLargestRemainder(1, []))
})

