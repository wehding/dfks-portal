import assert from "node:assert/strict";
import test from "node:test";
import { extractStatisticsSeries, parseStatisticsQueryPlan } from "../lib/statistics-query-plan";

test("queryplan accepterer kun kendte mål og renser fritekstfiltre", () => {
  const plan = parseStatisticsQueryPlan({
    metric: "average_monthly_salary",
    groupBy: "year",
    chart: "line",
    filters: { producerName: "  Nordisk Film  ", professionType: " Klipper ", experienceGroup: "experienced", year: 2025 },
  });
  assert.deepEqual(plan.filters.producerNames, ["Nordisk Film"]);
  assert.equal(plan.filters.professionType, "Klipper");
  assert.deepEqual(plan.filters.years, [2025]);
  assert.equal(plan.filters.experienceGroup, "experienced");
});

test("queryplan afviser ukendte mål og fri SQL", () => {
  assert.throws(() => parseStatisticsQueryPlan({ metric: "select * from contracts", groupBy: "year", filters: {} }));
});

test("serien indeholder kun aggregerede værdier", () => {
  const plan = parseStatisticsQueryPlan({ metric: "contract_count", groupBy: "year", filters: {}, chart: "bar" });
  assert.deepEqual(extractStatisticsSeries(plan, { contractCounts: [{ year: 2025, total: 12, contractCount: 12, memberCount: 10, validatedCount: 9, draftCount: 3, lowSample: false, secret: "nej" }] }), [
    { year: 2025, value: 12, contractCount: 12, memberCount: 10, validatedCount: 9, draftCount: 3, lowSample: false, seriesKey: "result", seriesLabel: "Resultat" },
  ]);
});

test("queryplan understøtter flere år, kategorier og producenter med faste grænser", () => {
  const plan = parseStatisticsQueryPlan({
    metric: "average_monthly_salary",
    groupBy: "year",
    chart: "line",
    filters: {
      years: [2025, 2023, 2025],
      categories: ["feature", "documentary", "ukendt"],
      producerNames: ["A", "B", "C", "D", "E", "F"],
      membershipTypes: ["member", "none"],
    },
  });
  assert.deepEqual(plan.filters.years, [2023, 2025]);
  assert.deepEqual(plan.filters.categories, ["feature", "documentary"]);
  assert.deepEqual(plan.filters.producerNames, ["A", "B", "C", "D", "E"]);
  assert.deepEqual(plan.filters.membershipTypes, ["member", "none"]);
});

test("siden et år udvides til alle år frem til indeværende år", () => {
  const currentYear = new Date().getFullYear();
  const plan = parseStatisticsQueryPlan({
    metric: "average_monthly_salary",
    groupBy: "year",
    chart: "line",
    filters: { years: [], yearFrom: 2022, yearTo: null },
  });
  assert.equal(plan.filters.yearFrom, 2022);
  assert.equal(plan.filters.yearTo, currentYear);
  assert.deepEqual(plan.filters.years, Array.from({ length: currentYear - 2022 + 1 }, (_, index) => 2022 + index));
});
