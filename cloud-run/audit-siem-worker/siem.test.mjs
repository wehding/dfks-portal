import assert from "node:assert/strict";
import test from "node:test";
import { safeSecretEqual, sha256, stableStringify } from "./siem.mjs";

test("canonical JSON is stable across property order", () => {
  assert.equal(stableStringify({ b: 2, a: { d: 4, c: 3 } }), stableStringify({ a: { c: 3, d: 4 }, b: 2 }));
});

test("hashing is deterministic and secret comparison is timing safe", () => {
  assert.equal(sha256("audit"), sha256("audit"));
  assert.equal(safeSecretEqual("same-secret", "same-secret"), true);
  assert.equal(safeSecretEqual("wrong", "same-secret"), false);
});
