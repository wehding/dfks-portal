import assert from "node:assert/strict"
import test from "node:test"

import { resolveAftalelicensWorkType } from "../lib/aftalelicens-work-type"

test("maps Simply Movies to spillefilm", () => {
    assert.equal(resolveAftalelicensWorkType({ sourceCategory: "Movies", duration: 106 }), "spillefilm")
})

test("uses the matched database work type before the source category", () => {
    assert.equal(resolveAftalelicensWorkType({ matchedWorkType: "spillefilm", sourceCategory: "Series", duration: 106 }), "spillefilm")
})

test("preserves an already selected type", () => {
    assert.equal(resolveAftalelicensWorkType({ storedType: "kortfilm", matchedWorkType: "spillefilm", sourceCategory: "Movies" }), "kortfilm")
})

test("splits Simply series at the existing 30 minute boundary", () => {
    assert.equal(resolveAftalelicensWorkType({ sourceCategory: "Series", duration: 30 }), "tv_serie_kort")
    assert.equal(resolveAftalelicensWorkType({ sourceCategory: "Series", duration: 31 }), "tv_serie_lang")
})

test("does not invent a type for an unknown category", () => {
    assert.equal(resolveAftalelicensWorkType({ sourceCategory: "Kids", duration: 15 }), undefined)
})
