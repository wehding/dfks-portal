import assert from "node:assert/strict";
import test from "node:test";
import { calculateResponseTimeStats, formatResponseDuration } from "../lib/admin-dashboard";

test("måler første staffsvar efter en sammenhængende medlemshenvendelse", () => {
  const stats = calculateResponseTimeStats([
    { threadId: "a", role: "member", createdAt: "2026-07-01T08:00:00Z" },
    { threadId: "a", role: "member", createdAt: "2026-07-01T09:00:00Z" },
    { threadId: "a", role: "staff", createdAt: "2026-07-01T10:00:00Z" },
    { threadId: "a", role: "member", createdAt: "2026-07-02T08:00:00Z" },
    { threadId: "b", role: "member", createdAt: "2026-07-03T08:00:00Z" },
    { threadId: "b", role: "staff", createdAt: "2026-07-03T09:00:00Z" },
  ]);
  assert.equal(stats.answeredCount, 2);
  assert.equal(stats.unansweredCount, 1);
  assert.equal(stats.medianMs, 60 * 60 * 1000);
  assert.equal(stats.p90Ms, 2 * 60 * 60 * 1000);
  assert.equal(stats.oldestUnansweredAt, "2026-07-02T08:00:00Z");
});

test("formaterer svartid på dansk og engelsk", () => {
  assert.equal(formatResponseDuration(90 * 60 * 1000), "2 t.");
  assert.equal(formatResponseDuration(3 * 24 * 60 * 60 * 1000, "en"), "3 days");
});
