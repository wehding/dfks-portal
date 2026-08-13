import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_STATISTICS_MINIMUM_GROUP_SIZE,
  distinctStatisticsMembers,
  normalizeStatisticsMinimumGroupSize,
  statisticsGroupIsVisible,
} from "../lib/statistics-privacy";

test("statistikgrænsen bruger fem som standard og begrænses til 1–100", () => {
  assert.equal(normalizeStatisticsMinimumGroupSize(undefined), DEFAULT_STATISTICS_MINIMUM_GROUP_SIZE);
  assert.equal(normalizeStatisticsMinimumGroupSize(0), 1);
  assert.equal(normalizeStatisticsMinimumGroupSize(5), 5);
  assert.equal(normalizeStatisticsMinimumGroupSize(101), 100);
});

test("statistikgrænsen tæller forskellige rettighedshavere og ikke kontrakter", () => {
  const rows = [
    { rightsHolderId: "member-1" },
    { rightsHolderId: "member-1" },
    { rightsHolderId: "member-2" },
  ];
  assert.equal(distinctStatisticsMembers(rows), 2);
  assert.equal(statisticsGroupIsVisible(rows, 2), true);
  assert.equal(statisticsGroupIsVisible(rows, 3), false);
});
