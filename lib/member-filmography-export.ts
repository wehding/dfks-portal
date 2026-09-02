import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type FilmographyRow = {
  title: string;
  year: number | null;
  type: string;
  role: string | null;
  seasonNumber: number | null;
};

function csvCell(value: string | number | null) {
  const raw = value == null ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw.trimStart()) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function createFilmographyCsv(rows: FilmographyRow[]) {
  const header = ["Titel", "År", "Type", "Sæson", "Funktion"];
  return [header, ...rows.map(row => [row.title, row.year, row.type, row.seasonNumber, row.role])]
    .map(row => row.map(csvCell).join(";"))
    .join("\r\n");
}

function wrapText(text: string, maxCharacters = 82) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > maxCharacters) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function pdfSafeText(value: string) {
  return value.normalize("NFC").replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "?");
}

export async function createFilmographyPdf(params: { memberName: string; organisationName: string; rows: FilmographyRow[] }) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 48;
  let page = pdf.addPage(pageSize);
  let y = 790;

  const addPage = () => { page = pdf.addPage(pageSize); y = 790; };
  const write = (text: string, size: number, isBold = false, color = rgb(0.12, 0.12, 0.12)) => {
    if (y < 60) addPage();
    page.drawText(pdfSafeText(text), { x: margin, y, size, font: isBold ? bold : regular, color });
    y -= size + 7;
  };

  write(params.memberName || "Filmografi", 22, true);
  write(`Filmografi · ${params.organisationName}`, 11, false, rgb(0.4, 0.4, 0.4));
  y -= 12;
  for (const row of params.rows) {
    const meta = [row.year, row.type, row.seasonNumber ? `Sæson ${row.seasonNumber}` : null, row.role].filter(Boolean).join(" · ");
    for (const [index, line] of wrapText(row.title).entries()) write(line, 12, index === 0);
    if (meta) write(meta, 9, false, rgb(0.35, 0.35, 0.35));
    y -= 6;
  }
  if (!params.rows.length) write("Der er endnu ingen værker i filmografien.", 11);
  return pdf.save();
}
