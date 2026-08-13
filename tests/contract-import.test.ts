import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CONTRACT_IMPORT_BYTES,
  contractFileHash,
  hasImplausibleFilmTiming,
  normalizeMatchText,
  premiereWindowScore,
  safeContractFileName,
  selectAutomaticMatch,
  titleSimilarity,
  validateContractImportFile,
} from "../lib/contract-import";

test("contract imports accept supported files and enforce the 25 MB boundary", () => {
  assert.equal(validateContractImportFile({ name: "kontrakt.PDF", size: MAX_CONTRACT_IMPORT_BYTES }), null);
  assert.match(validateContractImportFile({ name: "kontrakt.pdf", size: MAX_CONTRACT_IMPORT_BYTES + 1 }) ?? "", /25 MB/);
  assert.match(validateContractImportFile({ name: "kontrakt.exe", size: 10 }) ?? "", /ikke understøttet/);
  assert.match(validateContractImportFile({ name: "kontrakt.pdf", size: 0 }) ?? "", /tom/);
});

test("fingerprints are deterministic and safe filenames remove path characters", () => {
  assert.equal(contractFileHash(Buffer.from("samme kontrakt")), contractFileHash(Buffer.from("samme kontrakt")));
  assert.notEqual(contractFileHash(Buffer.from("a")), contractFileHash(Buffer.from("b")));
  assert.equal(safeContractFileName("../../Min kontrakt (endelig).pdf"), ".._.._Min_kontrakt__endelig_.pdf");
});

test("Danish names and work titles are normalized without losing relevant letters", () => {
  assert.equal(normalizeMatchText("  Kasper  Leick – KLIPPER "), "kasper leick klipper");
  assert.ok(titleSimilarity("I et splitsekund", "I ét split-sekund") > 0.8);
});

test("premiere-window evidence favors contracts made one to three years before release", () => {
  assert.equal(premiereWindowScore(2023, 2025), 10);
  assert.equal(premiereWindowScore(2025, 2025), 5);
  assert.equal(premiereWindowScore(2018, 2025), 0);
  assert.equal(premiereWindowScore(null, 2025), 0);
});

test("gamle film med samme titel afvises, mens senere seriesæsoner kan genbruge serieposten", () => {
  assert.equal(hasImplausibleFilmTiming("2025-10-01", 2016, "spillefilm"), true);
  assert.equal(hasImplausibleFilmTiming("2024-08-13", 2017, "spillefilm"), true);
  assert.equal(hasImplausibleFilmTiming("2024-08-13", 2026, "spillefilm"), false);
  assert.equal(hasImplausibleFilmTiming("2024-08-13", 2018, "tv-serie"), false);
});

test("automatic matching requires both a high score and a clear margin", () => {
  const clear = selectAutomaticMatch([
    { value: "correct", score: 95, evidence: [] },
    { value: "other", score: 70, evidence: [] },
  ], 90, 12);
  assert.equal(clear?.value, "correct");
  assert.equal(selectAutomaticMatch([
    { value: "a", score: 95, evidence: [] },
    { value: "b", score: 90, evidence: [] },
  ], 90, 12), null);
  assert.equal(selectAutomaticMatch([{ value: "a", score: 89, evidence: [] }], 90, 12), null);
});
