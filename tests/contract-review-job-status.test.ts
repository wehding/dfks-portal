import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canTriggerContractReviewAnalysis, isActiveContractReviewAnalysis, normalizeContractReviewAnalysisStatus } from "../lib/contract-review-job-status";

test("review-jobstatus skelner ko, behandling, retry, fejl og klar", () => {
  assert.equal(normalizeContractReviewAnalysisStatus({ aiStatus: "analyserer", intakeStatus: "queued", job: { status: "queued", attempts: 0, next_attempt_at: null, error_message: null } }), "queued");
  assert.equal(normalizeContractReviewAnalysisStatus({ aiStatus: "analyserer", intakeStatus: "queued", job: { status: "processing", attempts: 1, next_attempt_at: null, error_message: null } }), "processing");
  assert.equal(normalizeContractReviewAnalysisStatus({ aiStatus: "fejl", intakeStatus: "retryable", job: { status: "error", attempts: 2, next_attempt_at: "2026-08-16T12:00:00Z", error_message: "sikker fejl" } }), "retrying");
  assert.equal(normalizeContractReviewAnalysisStatus({ aiStatus: "fejl", intakeStatus: "dead", job: { status: "dead", attempts: 5, next_attempt_at: null, error_message: "sikker fejl" } }), "failed");
  assert.equal(normalizeContractReviewAnalysisStatus({ aiStatus: "klar", intakeStatus: "complete", job: { status: "done", attempts: 1, next_attempt_at: null, error_message: null } }), "ready");
});

test("kun aktive reviewtilstande polles", () => {
  assert.equal(isActiveContractReviewAnalysis("queued"), true);
  assert.equal(isActiveContractReviewAnalysis("processing"), true);
  assert.equal(isActiveContractReviewAnalysis("retrying"), true);
  assert.equal(isActiveContractReviewAnalysis("failed"), false);
  assert.equal(isActiveContractReviewAnalysis("ready"), false);
});

test("job i kø kan startes igen, mens aktiv behandling forbliver låst", () => {
  assert.equal(canTriggerContractReviewAnalysis("queued"), true);
  assert.equal(canTriggerContractReviewAnalysis("retrying"), true);
  assert.equal(canTriggerContractReviewAnalysis("failed"), true);
  assert.equal(canTriggerContractReviewAnalysis("ready"), true);
  assert.equal(canTriggerContractReviewAnalysis("processing"), false);
});

test("review-intake begrænser både worker-kald og inline fallback", () => {
  const source = readFileSync("lib/contract-review-intake.ts", "utf8");
  assert.match(source, /signal: AbortSignal\.timeout\(5_000\)/);
  assert.match(source, /processPendingContractReviewJobs\(1\)/);
  assert.doesNotMatch(source, /processPendingContractReviewJobs\(3\)/);
});
