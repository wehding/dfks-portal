import assert from "node:assert/strict";
import test from "node:test";
import { isTransientNetworkError, retryTransientNetwork } from "../lib/transient-network-retry";

test("genprøver et kortvarigt Failed to fetch", async () => {
  let calls = 0;
  const result = await retryTransientNetwork(async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("Failed to fetch");
    return "ok";
  }, { sleep: async () => undefined });

  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("genprøver ikke en almindelig serverfejl", async () => {
  let calls = 0;
  await assert.rejects(
    retryTransientNetwork(async () => {
      calls += 1;
      throw new Error("Ikke autoriseret");
    }, { sleep: async () => undefined }),
    /Ikke autoriseret/
  );
  assert.equal(calls, 1);
});

test("genkender gængse browser- og fetch-netværksfejl", () => {
  assert.equal(isTransientNetworkError(new TypeError("Failed to fetch")), true);
  assert.equal(isTransientNetworkError(new Error("Network request failed")), true);
  assert.equal(isTransientNetworkError(new Error("Validering fejlede")), false);
});
