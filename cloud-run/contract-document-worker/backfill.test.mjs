import assert from "node:assert/strict";
import test from "node:test";

import { main, parseDocumentLimit, runBackfill } from "./backfill.mjs";
import { FatalProcessingError } from "./processor.mjs";

test("tom kø afslutter med nul behandlinger", async () => {
  const result = await runBackfill({ processOneFn: async () => ({ outcome: "empty" }), log() {} });
  assert.deepEqual(result, { processed: 0, completed: 0, needsReview: 0, failed: 0 });
});

test("dokumentgrænsen overholdes", async () => {
  let claims = 0;
  const result = await runBackfill({
    maxDocuments: 4,
    processOneFn: async () => { claims += 1; return { outcome: "completed" }; },
    log() {},
  });
  assert.equal(claims, 4);
  assert.equal(result.completed, 4);
});

test("tre parallelle workers får forskellige atomisk claimede jobs", async () => {
  const queue = ["job-1", "job-2", "job-3"];
  const claimed = [];
  const atomicClaim = async () => {
    const id = queue.shift();
    await new Promise((resolve) => setImmediate(resolve));
    if (!id) return { outcome: "empty" };
    claimed.push(id);
    return { outcome: "completed" };
  };
  await Promise.all(Array.from({ length: 3 }, () => runBackfill({
    maxDocuments: 1,
    processOneFn: atomicClaim,
    log() {},
  })));
  assert.deepEqual(new Set(claimed), new Set(["job-1", "job-2", "job-3"]));
});

test("kontrollerede dokumentfejl stopper ikke batchen", async () => {
  const outcomes = ["handled_failure", "needs_review", "completed", "empty"];
  const result = await runBackfill({
    processOneFn: async () => ({ outcome: outcomes.shift() }),
    log() {},
  });
  assert.deepEqual(result, { processed: 3, completed: 1, needsReview: 1, failed: 1 });
});

test("fatal identitetsfejl giver non-zero", async () => {
  const code = await main({
    processOneFn: async () => { throw new FatalProcessingError("identity_token_failed"); },
    log() {},
    errorLog() {},
  });
  assert.equal(code, 1);
});

test("ugyldig OCR_MAX_DOCUMENTS_PER_TASK afvises", () => {
  for (const value of ["-1", "1.5", "abc", "100001", " 4"]) {
    assert.throws(() => parseDocumentLimit(value), FatalProcessingError);
  }
  assert.equal(parseDocumentLimit(undefined), 0);
  assert.equal(parseDocumentLimit("0"), 0);
  assert.equal(parseDocumentLimit("4"), 4);
});

test("slutlog indeholder kun sikre aggregater", async () => {
  const logs = [];
  await runBackfill({
    processOneFn: async () => ({ outcome: "empty" }),
    log: (line) => logs.push(line),
  });
  const combined = logs.join("\n");
  for (const secret of ["kontrakttekst", "/storage/private.pdf", "https://signed.example", "secret-token"]) {
    assert.equal(combined.includes(secret), false);
  }
  assert.deepEqual(JSON.parse(combined), {
    event: "backfill_finished", processed: 0, completed: 0, needsReview: 0, failed: 0,
  });
});
