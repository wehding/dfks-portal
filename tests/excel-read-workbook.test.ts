import assert from "node:assert/strict";
import test from "node:test";

import ExcelJS from "exceljs";
import { readFirstWorksheetRows } from "../lib/excel/read-workbook";

test("læser første Excel-ark uden den manglende xlsx-afhængighed", async () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Data");
  worksheet.addRow(["Selskab", "Dato", "Formel"]);
  worksheet.addRow(["Film & TV ApS", new Date("2026-07-22T00:00:00.000Z"), { formula: "1+1", result: 2 }]);
  const buffer = await workbook.xlsx.writeBuffer();
  const arrayBuffer = Uint8Array.from(buffer as unknown as ArrayLike<number>).buffer;

  const rows = await readFirstWorksheetRows(arrayBuffer);

  assert.equal(rows[0]?.[0], "Selskab");
  assert.equal(rows[1]?.[0], "Film & TV ApS");
  assert.ok(rows[1]?.[1] instanceof Date);
  assert.equal(rows[1]?.[2], 2);
});
