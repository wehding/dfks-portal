import test from "node:test"
import assert from "node:assert/strict"
import { discardIfNoDkkAmount } from "../lib/ai-sources"

test("accepterer supplement med valuta før beløbet", () => {
  const source = "Personligt tillæg: kr. 1.251"
  assert.equal(discardIfNoDkkAmount(source), source)
})

test("accepterer supplement med valuta efter beløbet", () => {
  const source = "Personligt tillæg: 1.251 kr."
  assert.equal(discardIfNoDkkAmount(source), source)
})

test("afviser tomt supplementfelt", () => {
  assert.equal(discardIfNoDkkAmount("Personligt tillæg: kr. ___"), null)
})
