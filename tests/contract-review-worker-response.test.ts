import assert from "node:assert/strict";
import test from "node:test";
import { isContractReviewWorkerResponse } from "../lib/contract-review-worker-response";

test("accepts a successful response from the contract review worker", async () => {
  const response = Response.json({ processed: 1, succeeded: 1, failed: 0, hasMore: false });
  assert.equal(await isContractReviewWorkerResponse(response), true);
});

test("rejects a successful HTML response from deployment protection", async () => {
  const response = new Response("<html>Log ind</html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  assert.equal(await isContractReviewWorkerResponse(response), false);
});

test("rejects JSON without the worker result contract", async () => {
  const response = Response.json({ authenticated: true });
  assert.equal(await isContractReviewWorkerResponse(response), false);
});
