import assert from "node:assert/strict";
import test from "node:test";

import {
  createStatisticsDisplayResult,
  getExportableStatisticsRows,
} from "../lib/statistics/display-result";

test("demonstrationsresultater markeres teknisk og kan ikke eksporteres", () => {
  const result = createStatisticsDisplayResult({
    productionRows: [{ year: 2025, value: 10 }],
    demonstrationRows: [{ year: 2024, value: 99 }],
    useDemonstration: true,
  });

  assert.equal(result.source, "demonstration");
  assert.equal(result.exportable, false);
  assert.deepEqual(result.rows, [{ year: 2024, value: 99 }]);
  assert.deepEqual(getExportableStatisticsRows(result), []);
});

test("produktionsresultater markeres og kan eksporteres", () => {
  const result = createStatisticsDisplayResult({
    productionRows: [{ year: 2025, value: 10 }],
    demonstrationRows: [{ year: 2024, value: 99 }],
    useDemonstration: false,
  });

  assert.equal(result.source, "production");
  assert.equal(result.exportable, true);
  assert.deepEqual(result.rows, [{ year: 2025, value: 10 }]);
  assert.deepEqual(getExportableStatisticsRows(result), [{ year: 2025, value: 10 }]);
});

test("demonstration og produktion blandes aldrig i samme resultat", () => {
  const demonstration = createStatisticsDisplayResult({
    productionRows: [{ id: "real" }],
    demonstrationRows: [{ id: "demo" }],
    useDemonstration: true,
  });
  const production = createStatisticsDisplayResult({
    productionRows: [{ id: "real" }],
    demonstrationRows: [{ id: "demo" }],
    useDemonstration: false,
  });

  assert.deepEqual(demonstration.rows.map(row => row.id), ["demo"]);
  assert.deepEqual(production.rows.map(row => row.id), ["real"]);
});
