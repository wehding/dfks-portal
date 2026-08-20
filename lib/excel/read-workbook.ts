import type { CellValue } from "exceljs";
import Papa from "papaparse";

function normalizeCellValue(value: CellValue): unknown {
  if (value == null || typeof value !== "object" || value instanceof Date) return value ?? "";
  if ("result" in value) return value.result ?? "";
  if ("richText" in value) return value.richText.map(part => part.text).join("");
  if ("text" in value) return value.text;
  return "";
}

function isLikelyCsv(buffer: ArrayBuffer, fileName?: string): boolean {
  if (fileName && /\.csv$/i.test(fileName)) return true;
  if (fileName && /\.xlsx?$/i.test(fileName)) return false;
  // Ingen/ukendt filendelse — XLSX-filer er ZIP-arkiver og starter altid med
  // signaturen "PK" (0x50 0x4B). Mangler den, er det ikke en gyldig XLSX-fil.
  const head = new Uint8Array(buffer.slice(0, 2));
  return !(head[0] === 0x50 && head[1] === 0x4b);
}

function readCsvRows(buffer: ArrayBuffer): unknown[][] {
  // Simply.TV og lignende kilder kan levere CSV med forskellig tegnkodning —
  // TextDecoder håndterer UTF-8 korrekt, inkl. BOM.
  const text = new TextDecoder("utf-8").decode(buffer);
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
  return result.data;
}

export async function readFirstWorksheetRows(buffer: ArrayBuffer, fileName?: string): Promise<unknown[][]> {
  if (isLikelyCsv(buffer, fileName)) {
    return readCsvRows(buffer);
  }
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const rows: unknown[][] = [];
  const columnCount = worksheet.columnCount;
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    rows.push(Array.from(
      { length: columnCount },
      (_, index) => normalizeCellValue(row.getCell(index + 1).value),
    ));
  }
  return rows;
}
