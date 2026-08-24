import test from "node:test";
import assert from "node:assert/strict";
import { resolveContractProductionType, workTypeToContractProductionType } from "../lib/contract-production-type";

test("værksdatabasens type vinder over et modstridende AI-forslag", () => {
  const result = resolveContractProductionType({ aiValue: "feature", work: { type: "dokumentarfilm", dfi_id: "42" } });
  assert.equal(result.productionType, "documentary");
  assert.equal(result.source, "work_database");
  assert.equal(result.aiSuggestion, "feature");
  assert.equal(result.hasConflict, true);
});

test("DFI-metadata udfylder typen når værksdatabasen mangler den", () => {
  const result = resolveContractProductionType({ aiValue: "feature", work: { type: null, dfi_id: "42", dfi_metadata: { Category: "DK/Dokumentarfilm" } } });
  assert.equal(result.productionType, "documentary");
  assert.equal(result.source, "dfi");
  assert.equal(result.hasConflict, true);
});

test("AI bruges kun når det tilknyttede værk ikke har en type", () => {
  const result = resolveContractProductionType({ aiValue: "tvSeries", work: { type: null } });
  assert.equal(result.productionType, "tvSeries");
  assert.equal(result.source, "ai");
  assert.equal(result.hasConflict, false);
});

test("værkstyper normaliseres til kontraktens statistikværdier", () => {
  assert.equal(workTypeToContractProductionType("spillefilm"), "feature");
  assert.equal(workTypeToContractProductionType("dokumentar-serie"), "docSeries");
});
