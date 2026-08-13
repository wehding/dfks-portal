import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { normalizeMatchText, titleSimilarity } from "@/lib/contract-import";

export const ARCHIVE_SHEET_NAME = "Kontraktarkiv";
export const ARCHIVE_MATCH_MINIMUM = 95;
export const ARCHIVE_MATCH_MARGIN = 15;

export type ArchiveWorkType = "kortfilm" | "spillefilm" | "tv-serie" | "dokumentar-serie" | "dokumentarfilm";

export function normalizeArchiveWorkType(value: string | null | undefined): ArchiveWorkType | null {
  const normalized = value?.toLocaleLowerCase("da-DK") ?? "";
  if ((normalized.includes("dokumentar") || normalized.includes("documentary")) && normalized.includes("serie")) return "dokumentar-serie";
  if (normalized.includes("dokumentar") || normalized.includes("documentary")) return "dokumentarfilm";
  if (normalized.includes("serie") || normalized === "tv") return "tv-serie";
  if (normalized.includes("kort")) return "kortfilm";
  if (normalized.includes("spille") || normalized.includes("feature") || normalized === "movie" || normalized === "film") return "spillefilm";
  return null;
}

export function normalizeArchiveLookupTitle(title: string, type: string | null | undefined) {
  if (!normalizeArchiveWorkType(type)?.includes("serie")) return title.trim();
  return title
    .replace(/\s*[-–—,:]?\s*(?:sæson|season)\s*\d+\s*$/iu, "")
    .replace(/\s+[IVXLCDM]+\s*$/u, "")
    .trim() || title.trim();
}

export function scoreArchiveExternalWork(
  input: { title: string; year: number | null; type: string | null; contractDate?: string | null },
  candidate: { title: string; year: number | null; type: string | null },
) {
  const similarity = titleSimilarity(input.title, candidate.title);
  let score = similarity === 1 ? 85 : Math.round(similarity * 45);
  const inputType = normalizeArchiveWorkType(input.type);
  const candidateType = normalizeArchiveWorkType(candidate.type);
  if (input.year && candidate.year === input.year) score += 20;
  else if (input.year && candidate.year && Math.abs(input.year - candidate.year) <= 1) score += 10;
  else if (!input.year && candidate.year && input.contractDate) {
    const contractYear = Number.parseInt(input.contractDate.slice(0, 4), 10);
    if (Number.isFinite(contractYear)) {
      if (candidate.year < contractYear || candidate.year > contractYear + 3) return Math.min(score, 74);
      score += 20;
    }
  }
  if (inputType && candidateType === inputType) score += 10;
  return Math.min(100, score);
}

export type ArchiveSpreadsheetRow = {
  rowNumber: number;
  name: string | null;
  title: string | null;
  productionType: string | null;
  premiereYear: number | null;
  distributor: string | null;
  productionCompany: string | null;
  producerAssociation: string | null;
  contractReferences: string[];
  salary: string | number | null;
  credit: string | null;
  organisation: string | null;
  email: string | null;
  agreement: string | null;
  archiveDate: string | null;
  rights: string | null;
  notes: string | null;
  advertising: string | null;
  photographer: string | null;
};

export type ArchiveDriveFile = {
  id: string;
  name: string;
  revision: string;
  size: number;
  contentType: string | null;
  parentId?: string;
};

export type ArchiveFileSignals = {
  title?: string | null;
  rightsHolderName?: string | null;
  producerName?: string | null;
  year?: number | null;
};

export type ArchiveRowMatch = {
  fileId: string;
  rowNumber: number | null;
  score: number | null;
  margin: number | null;
  automatic: boolean;
  reasons: string[];
};

function cellText(value: ExcelJS.CellValue): string | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).trim();
    return text || null;
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim() || null;
    if ("result" in value && value.result != null) return String(value.result).trim() || null;
    if ("richText" in value && Array.isArray(value.richText)) {
      const text = value.richText.map(item => item.text).join("").trim();
      return text || null;
    }
    if ("hyperlink" in value && typeof value.hyperlink === "string") return value.hyperlink.trim() || null;
  }
  return null;
}

function yearFrom(value: string | null) {
  const match = value?.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function splitReferences(...values: Array<string | null>) {
  return Array.from(new Set(values.flatMap(value => {
    if (!value) return [];
    return value.split(/[\n;,]+/).map(item => item.trim()).filter(Boolean);
  })));
}

export async function parseArchiveSpreadsheet(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet(ARCHIVE_SHEET_NAME);
  if (!sheet) throw new Error(`Regnearket mangler fanen ${ARCHIVE_SHEET_NAME}`);

  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, column) => {
    const key = normalizeMatchText(cellText(cell.value));
    if (key) headers.set(key, column);
  });
  const column = (...names: string[]) => {
    for (const name of names) {
      const found = headers.get(normalizeMatchText(name));
      if (found) return found;
    }
    return null;
  };
  const columns = {
    name: column("Name"), title: column("Title"), productionType: column("Production type"),
    premiere: column("Premiere year/date"), distributor: column("Distributor"),
    productionCompany: column("Production company"), producerAssociation: column("Pro-F"),
    link: column("Link to contract"), salary: column("Salary"), credit: column("Credit"),
    organisation: column("Organization"), email: column("Email"), agreement: column("Agreement"),
    archiveDate: column("Archive date"), rights: column("Rights"), notes: column("Notes"),
    advertising: column("Advertising"), other1: column("other contract 1"),
    other2: column("other contract 2"), other3: column("other contract 3"), photographer: column("Photographer"),
  };
  const read = (row: ExcelJS.Row, index: number | null) => index ? cellText(row.getCell(index).value) : null;
  const rows: ArchiveSpreadsheetRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const data: ArchiveSpreadsheetRow = {
      rowNumber,
      name: read(row, columns.name),
      title: read(row, columns.title),
      productionType: read(row, columns.productionType),
      premiereYear: yearFrom(read(row, columns.premiere)),
      distributor: read(row, columns.distributor),
      productionCompany: read(row, columns.productionCompany),
      producerAssociation: read(row, columns.producerAssociation),
      contractReferences: splitReferences(read(row, columns.link), read(row, columns.other1), read(row, columns.other2), read(row, columns.other3)),
      salary: read(row, columns.salary),
      credit: read(row, columns.credit),
      organisation: read(row, columns.organisation),
      email: read(row, columns.email),
      agreement: read(row, columns.agreement),
      archiveDate: read(row, columns.archiveDate),
      rights: read(row, columns.rights),
      notes: read(row, columns.notes),
      advertising: read(row, columns.advertising),
      photographer: read(row, columns.photographer),
    };
    if (Object.entries(data).some(([key, value]) => key !== "rowNumber" && (Array.isArray(value) ? value.length > 0 : value != null))) rows.push(data);
  });
  return rows;
}

export function referenceFileName(reference: string) {
  const decoded = (() => { try { return decodeURIComponent(reference); } catch { return reference; } })();
  const withoutQuery = decoded.split(/[?#]/)[0];
  const last = withoutQuery.split(/[\\/]/).filter(Boolean).at(-1) ?? decoded;
  return last.replace(/^.*?:/, "").trim();
}

function scoreRow(file: ArchiveDriveFile, row: ArchiveSpreadsheetRow, signals?: ArchiveFileSignals) {
  const reasons: string[] = [];
  const fileName = normalizeMatchText(file.name.replace(/\.[^.]+$/, ""));
  let score = 0;
  if (row.contractReferences.some(reference => normalizeMatchText(referenceFileName(reference)) === normalizeMatchText(file.name))) {
    score = 100;
    reasons.push("exact_file_name");
  } else if (row.contractReferences.some(reference => normalizeMatchText(referenceFileName(reference).replace(/\.[^.]+$/, "")) === fileName)) {
    score = 98;
    reasons.push("exact_file_stem");
  }
  if (signals?.title && row.title) {
    const similarity = titleSimilarity(signals.title, row.title);
    const points = similarity === 1 ? 45 : Math.round(similarity * 35);
    score += points;
    if (points >= 20) reasons.push("title");
  } else if (row.title) {
    const similarity = titleSimilarity(fileName, row.title);
    const points = similarity === 1 ? 35 : Math.round(similarity * 25);
    score += points;
    if (points >= 15) reasons.push("file_title");
  }
  if (signals?.rightsHolderName && row.name) {
    const similarity = titleSimilarity(signals.rightsHolderName, row.name);
    const points = similarity === 1 ? 30 : Math.round(similarity * 20);
    score += points;
    if (points >= 15) reasons.push("rights_holder");
  }
  if (signals?.producerName && row.productionCompany) {
    const similarity = titleSimilarity(signals.producerName, row.productionCompany);
    const points = similarity === 1 ? 15 : Math.round(similarity * 10);
    score += points;
    if (points >= 8) reasons.push("producer");
  }
  if (signals?.year && row.premiereYear && signals.year === row.premiereYear) {
    score += 10;
    reasons.push("year");
  }
  return { score: Math.min(100, score), reasons };
}

export function matchArchiveRows(files: ArchiveDriveFile[], rows: ArchiveSpreadsheetRow[], signals: Record<string, ArchiveFileSignals> = {}) {
  return files.map((file): ArchiveRowMatch => {
    const candidates = rows.map(row => ({ row, ...scoreRow(file, row, signals[file.id]) })).filter(item => item.score >= 35).sort((a, b) => b.score - a.score);
    const first = candidates[0];
    const second = candidates[1];
    const margin = first ? first.score - (second?.score ?? 0) : null;
    const automatic = Boolean(first && first.score >= ARCHIVE_MATCH_MINIMUM && (second == null || (margin ?? 0) >= ARCHIVE_MATCH_MARGIN));
    return {
      fileId: file.id,
      rowNumber: automatic ? first.row.rowNumber : null,
      score: first?.score ?? null,
      margin,
      automatic,
      reasons: first?.reasons ?? [],
    };
  });
}

export function isSupportedArchiveContract(file: Pick<ArchiveDriveFile, "name" | "contentType">) {
  if (/\.(pdf|doc|docx|txt)$/i.test(file.name)) return true;
  return [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
  ].includes(file.contentType ?? "");
}

export function archiveImportFileName(file: Pick<ArchiveDriveFile, "name" | "contentType">) {
  if (/\.(pdf|doc|docx|txt)$/i.test(file.name)) return file.name;
  const extension = file.contentType === "application/pdf" ? ".pdf"
    : file.contentType === "application/msword" ? ".doc"
      : file.contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? ".docx"
        : file.contentType === "text/plain" ? ".txt" : "";
  return `${file.name}${extension}`;
}

export function shouldPostProcessArchiveItem(item: { status: string; aiJobId: string | null }) {
  return Boolean(item.aiJobId) && item.status !== "duplicate";
}

export function isJpegArchivePage(file: Pick<ArchiveDriveFile, "name" | "contentType">) {
  return /\.jpe?g$/i.test(file.name) || file.contentType === "image/jpeg";
}

export function isObviousNonContract(fileName: string) {
  return /(?:^|[\s_.-])(cv|faktura|invoice|budget|regnskab|timeseddel|loenseddel|lønseddel)(?:[\s_.-]|$)/i.test(fileName);
}

function jpgStem(name: string) {
  return normalizeMatchText(name.replace(/\.jpe?g$/i, "").replace(/[\s_.-]*(?:side|page|scan)?\s*\d+$/i, ""));
}

function pageNumber(name: string) {
  const match = name.replace(/\.jpe?g$/i, "").match(/(?:side|page|scan)?[\s_.-]*(\d+)$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function groupJpegArchivePages(files: ArchiveDriveFile[]) {
  const groups = new Map<string, ArchiveDriveFile[]>();
  for (const file of files.filter(isJpegArchivePage)) {
    const key = `${file.parentId ?? "unknown-parent"}:${jpgStem(file.name) || file.id}`;
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  return Array.from(groups.entries()).map(([key, pages]) => {
    const sorted = [...pages].sort((a, b) => pageNumber(a.name) - pageNumber(b.name) || a.name.localeCompare(b.name, "da", { numeric: true }));
    const hasContinuousSequence = sorted.length > 1 && sorted.every((page, index) => pageNumber(page.name) === index + 1);
    return { key, confidence: sorted.length === 1 ? 95 : hasContinuousSequence ? 100 : 95, pages: sorted };
  });
}

export function jpegGroupContentIsConsistent(pageTexts: string[]) {
  const nonEmpty = pageTexts.map(normalizeMatchText).filter(Boolean);
  if (nonEmpty.length <= 1) return true;
  const distinctive = (text: string) => new Set(text.split(" ").filter(token => token.length >= 5));
  const first = distinctive(nonEmpty[0]);
  return nonEmpty.slice(1).every(text => {
    const tokens = distinctive(text);
    const overlap = [...first].filter(token => tokens.has(token)).length;
    return overlap >= 2 || /kontrakt|aftale|producent|medarbejder/.test(text);
  });
}

function safePdfText(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, " ");
}

export async function buildSearchableJpegPdf(pages: Array<{ bytes: Buffer; ocrText: string }>) {
  if (!pages.length) throw new Error("JPG-gruppen er tom");
  const pdf = await PDFDocument.create();
  const fixedDate = new Date("2000-01-01T00:00:00.000Z");
  pdf.setCreationDate(fixedDate);
  pdf.setModificationDate(fixedDate);
  pdf.setProducer("DFKS kontraktarkiv");
  pdf.setCreator("DFKS kontraktarkiv");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const source of pages) {
    // Copy the exact byte range: Node Buffers may share a larger pooled
    // ArrayBuffer, which otherwise makes pdf-lib read bytes before the JPEG SOI.
    const image = await pdf.embedJpg(Uint8Array.from(source.bytes));
    const width = 595;
    const height = Math.max(200, Math.round(width * image.height / image.width));
    const page = pdf.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
    const text = safePdfText(source.ocrText).slice(0, 40_000);
    for (let offset = 0, line = 0; offset < text.length; offset += 180, line += 1) {
      page.drawText(text.slice(offset, offset + 180), { x: 1, y: Math.max(1, height - 2 - line), size: 1, font, opacity: 0 });
    }
  }
  return Buffer.from(await pdf.save({ useObjectStreams: false, addDefaultPage: false, objectsPerTick: 50 }));
}

export function extractLocalContactData(text: string) {
  const email = text.match(/\b[A-ZÆØÅa-zæøå0-9._%+\-]+@[A-ZÆØÅa-zæøå0-9.\-]+\.[A-Za-z]{2,}\b/)?.[0]?.toLocaleLowerCase("da-DK") ?? null;
  const phone = text.match(/(?:\+45[\s-]?)?(?:\d{2}[\s-]?){4}\b/)?.[0]?.replace(/\s+/g, " ").trim() ?? null;
  const address = text.match(/\b[A-ZÆØÅ][A-Za-zÆØÅæøå\s.-]+(?:vej|gade|allé|alle|stræde|plads|vænge|torv)\s+\d+[A-Za-z]?(?:[^\n]{0,35}\b\d{4}\s+[A-ZÆØÅ][A-Za-zÆØÅæøå\s.-]+)?/i)?.[0]?.replace(/\s+/g, " ").trim() ?? null;
  return { email, phone, address };
}

export function detectDevelopmentContract(text: string) {
  const match = text.match(/klipper\s*\(udvikling\)|film\s+editor\s*\(development\)|udviklingskontrakt|\budviklingsfase\b|optionsaftale|\bdevelopment\s+(?:deal|agreement|contract)\b|option\s+agreement/i);
  return { isDevelopmentContract: Boolean(match), indicator: match?.[0] ?? null };
}

export function normalizeArchiveProductionType(value: string | null) {
  const normalized = normalizeMatchText(value);
  if (!normalized) return null;
  if (normalized.includes("dokumentar") && normalized.includes("serie")) return "dokumentar-serie";
  if (normalized.includes("dokumentar")) return "dokumentarfilm";
  if (normalized.includes("serie") || normalized.includes("tv")) return "tv-serie";
  if (normalized.includes("kort")) return "kortfilm";
  if (normalized.includes("spille") || normalized.includes("feature")) return "spillefilm";
  return null;
}

export function normalizeArchiveCredit(value: string | null) {
  const normalized = normalizeMatchText(value);
  if (!normalized) return null;
  if (normalized === "b klipper" || normalized === "b-klipper") return "Klipper";
  if (normalized.includes("medklipper")) return "Medklipper";
  if (normalized.includes("assistent")) return "Klipperassistent";
  if (normalized.includes("fotograf")) return "Fotograf";
  if (normalized.includes("instrukt")) return "Instruktør";
  if (normalized.includes("klipper")) return "Klipper";
  return "Andet";
}

export function normalizeArchiveDate(value: string | null) {
  const text = value?.trim();
  if (!text) return null;
  const iso = text.match(/^((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})/);
  const local = text.match(/^(\d{1,2})[./-](\d{1,2})[./-]((?:19|20)\d{2})$/);
  const [year, month, day] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : local ? [Number(local[3]), Number(local[2]), Number(local[1])] : [NaN, NaN, NaN];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isFinite(year) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function appendArchiveNote(existing: unknown, addition: string | null) {
  const current = typeof existing === "string" ? existing.trim() : "";
  const cleanAddition = addition?.trim();
  if (!cleanAddition) return current || null;
  const archiveLine = `Arkivimport: ${cleanAddition}`;
  if (normalizeMatchText(current).includes(normalizeMatchText(archiveLine))) return current;
  return current ? `${current}\n\n${archiveLine}` : archiveLine;
}

export function applySpreadsheetFallback(extracted: Record<string, unknown>, row: ArchiveSpreadsheetRow | null) {
  if (!row) return { ...extracted };
  const merged = { ...extracted };
  const setEmpty = (key: string, value: unknown) => {
    if ((merged[key] == null || merged[key] === "") && value != null && value !== "") merged[key] = value;
  };
  setEmpty("workTitle", row.title);
  setEmpty("premiereYear", row.premiereYear);
  setEmpty("productionType", normalizeArchiveProductionType(row.productionType));
  setEmpty("producerName", row.productionCompany);
  setEmpty("distributorName", row.distributor);
  setEmpty("producerAssociation", row.producerAssociation);
  setEmpty("creditedFunction", normalizeArchiveCredit(row.credit));
  setEmpty("organisationName", row.organisation);
  setEmpty("collectiveAgreement", row.agreement);
  setEmpty("rightsSummary", row.rights);
  setEmpty("salaryText", row.salary);
  setEmpty("advertisingTerms", row.advertising);
  setEmpty("photographerName", row.photographer);
  merged.specialNotes = appendArchiveNote(merged.specialNotes, row.notes);
  return merged;
}
