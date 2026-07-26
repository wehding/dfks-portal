import test from "node:test"
import assert from "node:assert/strict"
import { parseContractReviewDeleteIds } from "../lib/contract-review-delete"

const firstId = "11111111-1111-4111-8111-111111111111"
const secondId = "22222222-2222-4222-8222-222222222222"

test("bulk-sletning accepterer og deduplikerer review-id'er", () => {
    assert.deepEqual(parseContractReviewDeleteIds([firstId, firstId, secondId]), { ids: [firstId, secondId], error: null })
})

test("bulk-sletning afviser tomme, ugyldige og for store valg", () => {
    assert.ok(parseContractReviewDeleteIds([]).error)
    assert.ok(parseContractReviewDeleteIds(["ikke-et-uuid"]).error)
    assert.ok(parseContractReviewDeleteIds(Array.from({ length: 51 }, (_, index) => `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`)).error)
})
