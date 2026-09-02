import assert from "node:assert/strict";
import test from "node:test";
import { buildStatisticsQuerySegments } from "../lib/statistics-query-execution";
import { parseStatisticsQueryPlan } from "../lib/statistics-query-plan";

function plan(input: Record<string, unknown>) {
  return parseStatisticsQueryPlan({
    metrics: ["median_monthly_salary"], groupBy: "year", compareBy: [], chart: "line", adjustForInflation: false, filters: {}, ...input,
  });
}

test("to produktionstyper bliver to separate filtersegmenter", () => {
  const segments = buildStatisticsQuerySegments(plan({ compareBy: ["category"], filters: { categories: ["feature", "documentary"] } }), []);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map(segment => segment.filters.categories), [["feature"], ["documentary"]]);
  assert.deepEqual(segments.map(segment => segment.label), ["Spillefilm", "Dokumentarfilm"]);
});

test("A-løn og leverandør bliver to separate filtersegmenter", () => {
  const segments = buildStatisticsQuerySegments(plan({ compareBy: ["contract_type"], filters: { contractTypes: ["a-løn", "leverandør"] } }), []);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map(segment => segment.filters.contractTypes), [["a-løn"], ["leverandør"]]);
  assert.deepEqual(segments.map(segment => segment.label), ["A-løn", "Leverandør"]);
});

test("to dimensioner danner et begrænset krydsprodukt med stabile labels", () => {
  const segments = buildStatisticsQuerySegments(plan({
    compareBy: ["category", "contract_type"],
    filters: { categories: ["feature", "documentary"], contractTypes: ["a-løn", "leverandør"] },
  }), []);
  assert.equal(segments.length, 4);
  assert.deepEqual(segments.map(segment => segment.label), [
    "Spillefilm · A-løn", "Spillefilm · Leverandør", "Dokumentarfilm · A-løn", "Dokumentarfilm · Leverandør",
  ]);
  assert.equal(new Set(segments.map(segment => segment.key)).size, 4);
});

test("flere filterværdier uden sammenligning forbliver ét samlet udsnit", () => {
  const segments = buildStatisticsQuerySegments(plan({ filters: { categories: ["feature", "documentary"], contractTypes: ["a-løn", "leverandør"] } }), []);
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0].filters.categories, ["feature", "documentary"]);
  assert.deepEqual(segments[0].filters.contractTypes, ["a-løn", "leverandør"]);
});

test("kanoniske producenter bliver separate segmenter", () => {
  const segments = buildStatisticsQuerySegments(plan({ compareBy: ["producer"], filters: { producerNames: ["A", "B"] } }), [
    { ids: ["11111111-1111-1111-1111-111111111111"], name: "Producent A", scope: "group" },
    { ids: ["22222222-2222-2222-2222-222222222222"], name: "Producent B", scope: "group" },
  ]);
  assert.deepEqual(segments.map(segment => segment.filters.producerIds), [
    ["11111111-1111-1111-1111-111111111111"], ["22222222-2222-2222-2222-222222222222"],
  ]);
});

test("producentgrupper filtrerer på alle juridiske enheder i gruppen", () => {
  const segments = buildStatisticsQuerySegments(plan({ filters: { producerNames: ["Nordisk Film"] } }), [
    {
      ids: ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
      name: "Nordisk Film",
      scope: "group",
    },
  ]);
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0].filters.producerIds, [
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
  ]);
});

test("uforholdsmæssigt mange serier afvises", () => {
  assert.throws(() => buildStatisticsQuerySegments(plan({
    metrics: ["median_monthly_salary", "average_pension", "average_working_weeks"],
    compareBy: ["category", "experience_group"],
    filters: { categories: ["feature", "documentary", "tvSeries"], experienceGroups: ["new_graduate", "early_career", "experienced", "veteran"] },
  }), []), /for mange/);
});

test("alle tilladte sammenligningsdimensioner danner afgrænsede serverfiltre", () => {
  const cases = [
    { dimension: "gender", filters: { genders: ["female", "male"] }, key: "genders" },
    { dimension: "producer_type", filters: { producerTypeCodes: ["film_producer", "broadcaster"] }, key: "producerTypeCodes" },
    { dimension: "membership_type", filters: { membershipTypes: ["member", "associate"] }, key: "membershipTypes" },
    { dimension: "profession_type", filters: { professionTypes: ["klipper", "medklipper"] }, key: "professionTypes" },
    { dimension: "experience_group", filters: { experienceGroups: ["early_career", "experienced"] }, key: "experienceGroups" },
  ] as const;
  for (const entry of cases) {
    const segments = buildStatisticsQuerySegments(plan({ compareBy: [entry.dimension], filters: entry.filters }), []);
    assert.equal(segments.length, 2, entry.dimension);
    assert.equal((segments[0].filters[entry.key] as string[]).length, 1, entry.dimension);
    assert.equal((segments[1].filters[entry.key] as string[]).length, 1, entry.dimension);
  }
});
