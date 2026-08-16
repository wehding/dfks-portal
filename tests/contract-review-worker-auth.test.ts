import assert from "node:assert/strict";
import test from "node:test";
import { isContractReviewWorkerAuthorized } from "../lib/contract-review-worker-auth";

test("cron GET og intern POST bruger hvert sit secret", () => {
  const base = { cronSecret: "cron-secret", workerSecret: "worker-secret" };
  assert.equal(isContractReviewWorkerAuthorized({ ...base, method: "GET", authorization: "Bearer cron-secret" }), true);
  assert.equal(isContractReviewWorkerAuthorized({ ...base, method: "GET", authorization: "Bearer worker-secret" }), false);
  assert.equal(isContractReviewWorkerAuthorized({ ...base, method: "POST", authorization: "Bearer worker-secret" }), true);
  assert.equal(isContractReviewWorkerAuthorized({ ...base, method: "POST", authorization: "Bearer cron-secret" }), false);
});

test("worker afviser manglende og forkert bearer-token", () => {
  assert.equal(isContractReviewWorkerAuthorized({ method: "POST", authorization: null, workerSecret: "secret" }), false);
  assert.equal(isContractReviewWorkerAuthorized({ method: "POST", authorization: "Basic secret", workerSecret: "secret" }), false);
  assert.equal(isContractReviewWorkerAuthorized({ method: "POST", authorization: "Bearer forkert", workerSecret: "secret" }), false);
});
