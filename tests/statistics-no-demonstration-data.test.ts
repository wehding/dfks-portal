import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const statisticsPage = readFileSync("app/admin/statistik/page.tsx", "utf8");

test("produktionsstatistik indeholder ingen demonstrationsdatasæt", () => {
  assert.doesNotMatch(statisticsPage, /demoSalary|demoRights|data-statistics-source="demonstration"/);
});

test("manglende produktionsdata giver en tomtilstand", () => {
  assert.match(statisticsPage, /Ingen statistikdata/);
  assert.match(statisticsPage, /hasProductionStatistics/);
});
