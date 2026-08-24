import assert from "node:assert/strict";
import test from "node:test";
import { isScreeningSourceRowId } from "../lib/screening-source-row";

test("aftalelicenssortering accepterer kun database-UUID'er", () => {
  assert.equal(isScreeningSourceRowId("66e8315c-ab09-4c6f-8fe1-f9ed2ec19e5a"), true);
  assert.equal(isScreeningSourceRowId("noise_17"), false);
  assert.equal(isScreeningSourceRowId("vaerk_s1e2_b"), false);
});
