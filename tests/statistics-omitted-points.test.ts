import assert from "node:assert/strict";
import test from "node:test";
import {
  collectOmittedStatisticsPoints,
  describeOmittedStatisticsPoints,
} from "../lib/statistics/omitted-points";

test("udeladte statistikpunkter forklares uden at vise slørede værdier", () => {
  const points = collectOmittedStatisticsPoints({
    metrics: ["median_monthly_salary"],
    segmentLabel: "Spillefilm",
    statistics: {
      salary: [
        { year: 2021, monthlyRate: null, contractCount: 4, memberCount: 2, suppressed: true, suppressionReason: "minimum_count" },
        { year: 2022, monthlyRate: 45_000, contractCount: 7, memberCount: 5, suppressed: false },
      ],
    },
  });

  assert.deepEqual(points, [{
    year: 2021,
    seriesLabel: "Spillefilm",
    metricLabel: "Median månedsløn",
    reason: "minimum_count",
    memberCount: 2,
    contractCount: 4,
  }]);
  assert.match(describeOmittedStatisticsPoints(points)[0], /2021: Spillefilm/);
  assert.doesNotMatch(describeOmittedStatisticsPoints(points).join(" "), /45.000|45000/);
});
