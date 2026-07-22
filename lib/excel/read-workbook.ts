import type { CellValue } from "exceljs";

function normalizeCellValue(value: CellValue): unknown {
  if (value == null || typeof value !== "object" || value instanceof Date) return value ?? "";
  if ("result" in value) return value.result ?? "";
  if ("richText" in value) return value.richText.map(part => part.text).join("");
  if ("text" in value) return value.text;
  return "";
}

export async function readFirstWorksheetRows(buffer: ArrayBuffer): Promise<unknown[][]> {
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
