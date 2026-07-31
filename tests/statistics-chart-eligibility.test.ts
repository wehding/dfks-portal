import assert from "node:assert/strict";
import test from "node:test";
import { evaluateChartEligibility, recommendCharts } from "../lib/statistics-chart-eligibility";

const timeline = { pointCount: 6, seriesCount: 2, timePointCount: 3, categoryCount: 3, observationCount: 6, numericDimensions: 1, additive: false };

test("recommends a line chart for a non-additive time series", () => {
  assert.equal(recommendCharts(timeline)[0], "line");
});

test("rejects pie charts for time series", () => {
  assert.equal(evaluateChartEligibility("pie", timeline).eligible, false);
});

test("requires ten observations for distributions", () => {
  assert.equal(evaluateChartEligibility("histogram", timeline).eligible, false);
  assert.equal(evaluateChartEligibility("histogram", { ...timeline, observationCount: 10 }).eligible, true);
});

test("only stacks additive series", () => {
  assert.equal(evaluateChartEligibility("stacked_bar", timeline).eligible, false);
  assert.equal(evaluateChartEligibility("stacked_bar", { ...timeline, additive: true }).eligible, true);
});
