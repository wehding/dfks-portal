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

test("læser CSV-fil korrekt i stedet for at fejle som ugyldig XLSX/ZIP", async () => {
  const csvText = 'Title,Channel,Broadcast Date\n"Rose, sæson 2",DR1,2026-07-15\nNisser,TV2,2026-07-16\n';
  const arrayBuffer = new TextEncoder().encode(csvText).buffer;

  const rows = await readFirstWorksheetRows(arrayBuffer, "TV2 DK Juli.csv");

  assert.equal(rows[0]?.[0], "Title");
  assert.equal(rows[0]?.[1], "Channel");
  assert.equal(rows[1]?.[0], "Rose, sæson 2");
  assert.equal(rows[1]?.[1], "DR1");
  assert.equal(rows[2]?.[0], "Nisser");
});

test("genkender CSV via indhold, selv uden .csv-filnavn", async () => {
  const csvText = "Title,Channel\nToscana,TV3\n";
  const arrayBuffer = new TextEncoder().encode(csvText).buffer;

  const rows = await readFirstWorksheetRows(arrayBuffer);

  assert.equal(rows[0]?.[0], "Title");
  assert.equal(rows[1]?.[0], "Toscana");
});
