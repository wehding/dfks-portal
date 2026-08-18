import assert from "node:assert/strict";
import test from "node:test";
import { buildStatisticsVisualization, type VisualizationSeriesRow } from "../lib/statistics/visualization";

function row(metric: string, unit: VisualizationSeriesRow["unit"], year: number, value: number): VisualizationSeriesRow {
  return { year, value, metric, unit, seriesKey: metric, seriesLabel: metric, metricLabel: metric, contractCount: 8, memberCount: 6, lowSample: false };
}

test("løn og to rettighedsandele bliver ét diagram med to akser", () => {
  const series = [2023, 2024].flatMap((year, index) => [
    row("salary", "dkk", year, 40_000 + index * 1_000),
    row("copydan", "percent", year, 60 + index),
    row("streaming", "percent", year, 45 + index),
  ]);
  const result = buildStatisticsVisualization(series);
  assert.equal(result.mode, "dual_axis");
  assert.equal(result.chart, "composed");
  assert.equal(result.datasets.length, 3);
  assert.deepEqual([...new Set(result.datasets.map(dataset => dataset.axis))], ["left", "right"]);
  assert.equal(result.rows.length, 2);
});

test("tre enheder indekseres ved første fælles sikre år", () => {
  const result = buildStatisticsVisualization([
    row("salary", "dkk", 2023, 40_000), row("salary", "dkk", 2024, 44_000),
    row("pension", "percent", 2023, 10), row("pension", "percent", 2024, 11),
    row("weeks", "weeks", 2023, 20), row("weeks", "weeks", 2024, 18),
  ]);
  assert.equal(result.mode, "indexed");
  assert.equal(result.basisYear, 2023);
  assert.equal(result.rows[0].salary, 100);
  assert.equal(result.rows[1].salary, 110);
});

test("uforenelige perioder falder tilbage til én tabel", () => {
  const result = buildStatisticsVisualization([
    row("salary", "dkk", 2022, 40_000), row("salary", "dkk", 2023, 41_000),
    row("pension", "percent", 2024, 10), row("pension", "percent", 2025, 11),
    row("weeks", "weeks", 2026, 20), row("weeks", "weeks", 2027, 21),
  ]);
  assert.equal(result.chart, "table");
});
