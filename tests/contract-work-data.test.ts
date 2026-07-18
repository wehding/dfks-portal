import test from "node:test";
import assert from "node:assert/strict";
import { mergeContractWorkData } from "../lib/contract-work-data";

test("linked DFI/TMDB work data fills missing contract fields", () => {
  const result = mergeContractWorkData({
    extractedData: { creditedFunction: "Klipper" },
    contract: { type: "ansættelseskontrakt", working_title: "Arbejdstitel" },
    work: {
      title: "Den færdige titel",
      type: "tv-serie",
      year: 2026,
      duration_minutes: 42,
      season_number: 2,
      episode_number: 4,
      episode_count: 8,
      season_count: 3,
      director: "Test Instruktør",
      production_companies: ["Eksempel Film"],
      production_countries: ["Danmark"],
      dfi_id: "123",
      tmdb_id: 456,
    },
    rightsHolderName: "Test Medlem",
  });

  assert.equal(result.workTitle, "Den færdige titel");
  assert.equal(result.seasonNumber, 2);
  assert.equal(result.episodeNumber, 4);
  assert.equal(result.employerName, "Eksempel Film");
  assert.deepEqual(result.productionCountries, ["Danmark"]);
  assert.equal(result.creditedFunction, "Klipper");
});

test("AI or manually entered contract data takes precedence over work data", () => {
  const result = mergeContractWorkData({
    extractedData: {
      workTitle: "Manuelt rettet titel",
      director: "Manuelt rettet instruktør",
      premiereYear: 2025,
    },
    work: {
      title: "DFI-titel",
      director: "DFI-instruktør",
      year: 2026,
    },
  });

  assert.equal(result.workTitle, "Manuelt rettet titel");
  assert.equal(result.director, "Manuelt rettet instruktør");
  assert.equal(result.premiereYear, 2025);
});
