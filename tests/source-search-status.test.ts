import assert from "node:assert/strict";
import test from "node:test";
import { sourceSearchFailed } from "../lib/source-search-status";

test("en enkelt variantfejl skjuler ikke et vellykket kildeopslag", () => {
  assert.equal(sourceSearchFailed({ successes: 1, failures: 2 }), false);
});

test("kilden markeres kun fejlet når alle forsøg fejler", () => {
  assert.equal(sourceSearchFailed({ successes: 0, failures: 2 }), true);
  assert.equal(sourceSearchFailed({ successes: 0, failures: 0 }), false);
});
