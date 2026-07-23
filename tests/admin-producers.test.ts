import assert from "node:assert/strict";
import test from "node:test";
import { resolveProducerStatus } from "../lib/admin-producers";

test("producentstatus prioriterer kladder over øvrig aktivitet", () => {
  assert.equal(resolveProducerStatus(["valideret", "kladde"], 2), "attention");
  assert.equal(resolveProducerStatus(["valideret"], 0), "active");
  assert.equal(resolveProducerStatus([], 1), "active");
  assert.equal(resolveProducerStatus([], 0), "inactive");
});
