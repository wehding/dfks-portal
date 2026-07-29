import assert from "node:assert/strict";
import test from "node:test";
import { extractStatisticsSeries, parseStatisticsQueryPlan } from "../lib/statistics-query-plan";

test("queryplan accepterer kun kendte mål og renser fritekstfiltre", () => {
  const plan = parseStatisticsQueryPlan({
    metric: "average_monthly_salary",
    groupBy: "year",
    chart: "line",
    filters: { producerName: "  Nordisk Film  ", professionType: " Klipper ", year: 2025 },
  });
  assert.equal(plan.filters.producerName, "Nordisk Film");
  assert.equal(plan.filters.professionType, "Klipper");
  assert.equal(plan.filters.year, 2025);
});

test("queryplan afviser ukendte mål og fri SQL", () => {
  assert.throws(() => parseStatisticsQueryPlan({ metric: "select * from contracts", groupBy: "year", filters: {} }));
});

test("serien indeholder kun aggregerede værdier", () => {
  const plan = parseStatisticsQueryPlan({ metric: "contract_count", groupBy: "year", filters: {}, chart: "bar" });
  assert.deepEqual(extractStatisticsSeries(plan, { contractCounts: [{ year: 2025, total: 12, memberCount: 10, secret: "nej" }] }), [
    { year: 2025, value: 12, memberCount: 10 },
  ]);
});
