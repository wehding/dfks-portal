import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import {
  applySpreadsheetFallback,
  archiveImportFileName,
  buildSearchableJpegPdf,
  detectDevelopmentContract,
  extractLocalContactData,
  groupJpegArchivePages,
  isSupportedArchiveContract,
  jpegGroupContentIsConsistent,
  matchArchiveRows,
  normalizeArchiveCredit,
  normalizeArchiveDate,
  normalizeArchiveLookupTitle,
  parseArchiveSpreadsheet,
  scoreArchiveExternalWork,
  shouldPostProcessArchiveItem,
  type ArchiveDriveFile,
  type ArchiveSpreadsheetRow,
} from "@/lib/one-off/contract-archive-import";

test("accepterer en PDF med korrekt MIME-type selv uden filendelse", () => {
  assert.equal(isSupportedArchiveContract({ name: "Kontrakt uden filendelse", contentType: "application/pdf" }), true);
  assert.equal(archiveImportFileName({ name: "Kontrakt uden filendelse", contentType: "application/pdf" }), "Kontrakt uden filendelse.pdf");
  assert.equal(archiveImportFileName({ name: "Kontrakt.pdf", contentType: "application/pdf" }), "Kontrakt.pdf");
  assert.equal(isSupportedArchiveContract({ name: "Ukendt fil", contentType: "application/octet-stream" }), false);
});

test("dubletter efterbehandles ikke igen", () => {
  assert.equal(shouldPostProcessArchiveItem({ status: "duplicate", aiJobId: null }), false);
  assert.equal(shouldPostProcessArchiveItem({ status: "ready_for_review", aiJobId: null }), false);
  assert.equal(shouldPostProcessArchiveItem({ status: "missing_work", aiJobId: "job-1" }), true);
  assert.equal(shouldPostProcessArchiveItem({ status: "ready_for_review", aiJobId: "job-1" }), true);
});

test("seriebetegnelser fjernes kun fra det eksterne opslag", () => {
  assert.equal(normalizeArchiveLookupTitle("Dag & Nat sæson 2", "tvSeries"), "Dag & Nat");
  assert.equal(normalizeArchiveLookupTitle("SOMMERDAHL V", "tvSeries"), "SOMMERDAHL");
  assert.equal(normalizeArchiveLookupTitle("Vogter V", "feature"), "Vogter V");
});

test("eksterne værker kræver eksakt titel og forenelig type uden premiereår", () => {
  assert.equal(scoreArchiveExternalWork(
    { title: "Vogter", year: null, type: "feature" },
    { title: "Vogter", year: 2024, type: "spillefilm" },
  ), 95);
  assert.equal(scoreArchiveExternalWork(
    { title: "Kald mig far", year: null, type: "feature" },
    { title: "Kald mig far", year: 2024, type: "tv-serie" },
  ), 85);
  assert.equal(scoreArchiveExternalWork(
    { title: "Sosu", year: null, type: "feature", contractDate: "2024-11-18" },
    { title: "Sosu", year: 2025, type: "spillefilm" },
  ), 100);
  assert.equal(scoreArchiveExternalWork(
    { title: "SULT", year: null, type: "feature", contractDate: "2024-04-02" },
    { title: "Sult", year: 1966, type: "spillefilm" },
  ), 74);
  assert.equal(scoreArchiveExternalWork(
    { title: "Lucky", year: null, type: "feature", contractDate: "2024-08-13" },
    { title: "Lucky", year: 2017, type: "spillefilm" },
  ), 74);
});

function row(overrides: Partial<ArchiveSpreadsheetRow> = {}): ArchiveSpreadsheetRow {
  return {
    rowNumber: 2,
    name: "Kasper Klipper",
    title: "Den store film",
    productionType: "Spillefilm",
    premiereYear: 2024,
    distributor: null,
    productionCompany: "Producent ApS",
    producerAssociation: null,
    contractReferences: ["Den store film - kontrakt.pdf"],
    salary: null,
    credit: "Klipper",
    organisation: null,
    email: null,
    agreement: null,
    archiveDate: null,
    rights: null,
    notes: null,
    advertising: null,
    photographer: null,
    ...overrides,
  };
}

function file(overrides: Partial<ArchiveDriveFile> = {}): ArchiveDriveFile {
  return { id: "file-1", name: "Den store film - kontrakt.pdf", revision: "1", size: 100, contentType: "application/pdf", ...overrides };
}

test("regnearket læses fra den navngivne fane og mapper supplerende felter", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Kontraktarkiv");
  sheet.addRow(["Name", "Title", "Production type", "Premiere year/date", "Link to contract", "Credit", "Notes"]);
  sheet.addRow(["Kasper Klipper", "Den store film", "Feature", "2024-03-01", "https://drive.test/Den%20store%20film%20-%20kontrakt.pdf", "B-klipper", "Supplerende note"]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const rows = await parseArchiveSpreadsheet(buffer);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].premiereYear, 2024);
  assert.equal(rows[0].credit, "B-klipper");
});

test("eksakt filreference matches automatisk, men et tvetydigt match afvises", () => {
  const exact = matchArchiveRows([file()], [row()]);
  assert.equal(exact[0].automatic, true);
  assert.equal(exact[0].rowNumber, 2);
  const ambiguous = matchArchiveRows([file()], [row(), row({ rowNumber: 3 })]);
  assert.equal(ambiguous[0].automatic, false);
  assert.equal(ambiguous[0].rowNumber, null);
});

test("JPG-sider sorteres numerisk og ufuldstændige sekvenser markeres lavere", () => {
  const grouped = groupJpegArchivePages([
    file({ id: "2", name: "Aftale side 2.jpg", contentType: "image/jpeg" }),
    file({ id: "1", name: "Aftale side 1.jpg", contentType: "image/jpeg" }),
  ]);
  assert.deepEqual(grouped[0].pages.map(page => page.id), ["1", "2"]);
  assert.equal(grouped[0].confidence, 100);
  const gap = groupJpegArchivePages([
    file({ id: "1", name: "Aftale side 1.jpg", contentType: "image/jpeg" }),
    file({ id: "3", name: "Aftale side 3.jpg", contentType: "image/jpeg" }),
  ]);
  assert.equal(gap[0].confidence, 95);
  const separateFolders = groupJpegArchivePages([
    file({ id: "a", name: "Kontrakt side 1.jpg", contentType: "image/jpeg", parentId: "folder-a" }),
    file({ id: "b", name: "Kontrakt side 1.jpg", contentType: "image/jpeg", parentId: "folder-b" }),
  ]);
  assert.equal(separateFolders.length, 2);
});

test("JPG-grupper kræver indholdsmæssig sammenhæng", () => {
  assert.equal(jpegGroupContentIsConsistent(["Kontrakt mellem producent og klipper", "Producenten aftaler kontraktens periode"]), true);
  assert.equal(jpegGroupContentIsConsistent(["Almindelig kontrakt mellem parterne", "Opskrift banan sukker kanel ovn"]), false);
});

test("JPG konverteres til en læsbar PDF med samme antal sider", async () => {
  const tinyJpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEABj8Cf//Z", "base64");
  const output = await buildSearchableJpegPdf([{ bytes: tinyJpeg, ocrText: "Dansk kontrakttekst" }, { bytes: tinyJpeg, ocrText: "Side to" }]);
  const pdf = await PDFDocument.load(output);
  assert.equal(pdf.getPageCount(), 2);
});

test("regnearksdata udfylder kun tomme AI-felter og noter tilføjes", () => {
  const merged = applySpreadsheetFallback({ workTitle: "AI-titel", creditedFunction: "Medklipper", specialNotes: "Eksisterende" }, row({ title: "Arkivtitel", credit: "Klipper", notes: "Supplerende" }));
  assert.equal(merged.workTitle, "AI-titel");
  assert.equal(merged.creditedFunction, "Medklipper");
  assert.equal(merged.specialNotes, "Eksisterende\n\nArkivimport: Supplerende");
  assert.equal(normalizeArchiveCredit("B-klipper"), "B-klipper");
  assert.equal(normalizeArchiveCredit("Medklipper"), "Klipper");
  assert.equal(normalizeArchiveDate("13.08.2026"), "2026-08-13");
  assert.equal(normalizeArchiveDate("31.02.2026"), null);
});

test("lokal tekstudtræk finder kontaktdata og udviklingsaftaler uden at logge dem", () => {
  const contact = extractLocalContactData("Kasper Klipper\nkasper@example.dk\n+45 12 34 56 78\nFilmvej 12, 2100 København");
  assert.equal(contact.email, "kasper@example.dk");
  assert.match(contact.phone ?? "", /12 34 56 78/);
  assert.equal(detectDevelopmentContract("Aftalen gælder klipper (udvikling)").isDevelopmentContract, true);
});
