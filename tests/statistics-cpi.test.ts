import assert from "node:assert/strict";
import test from "node:test";
import { parseStatisticsCpiCsv } from "../lib/statistics-cpi-parser";

test("PRIS01 CSV parses med BOM, dansk decimalkomma og måned", () => {
  const rows = parseStatisticsCpiCsv("\uFEFFVAREGR;ENHED;TID;INDHOLD\n00 Forbrugerprisindeks i alt;Indeks;2025M01;118,42\n00 Forbrugerprisindeks i alt;Indeks;2025M02;119,01");
  assert.deepEqual(rows.map(row => ({ period: row.period_month, value: row.index_value })), [
    { period: "2025-01-01", value: 118.42 },
    { period: "2025-02-01", value: 119.01 },
  ]);
});

test("ugyldige CPI-rækker ignoreres", () => {
  const rows = parseStatisticsCpiCsv("VAREGR;ENHED;TID;INDHOLD\n00;Indeks;ukendt;—\n00;Indeks;2025M01;0");
  assert.deepEqual(rows, []);
});
