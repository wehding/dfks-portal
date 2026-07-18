import test from "node:test";
import assert from "node:assert/strict";
import {
  contractWorkTypeFilter,
  contractDataToManualWorkSeed,
  emptyManualWorkForm,
  isExactManualWorkMatch,
  manualWorkDuplicateDecision,
  validateManualWork,
} from "../lib/manual-work";
import { inferSeriesWorkFields } from "../lib/series-episodes";

test("contract type filters automatic work search when matching results exist", () => {
  assert.equal(contractWorkTypeFilter("tvSeries", [{ type: "spillefilm" }, { type: "tv-serie" }]), "tv-serie");
});

test("automatic work search shows all types when the extracted type has no match", () => {
  assert.equal(contractWorkTypeFilter("docSeries", [{ type: "dokumentarfilm" }]), "all");
});

test("AI contract data prefills the shared manual work form", () => {
  const seed = contractDataToManualWorkSeed({
    title: "Eksempel-serien",
    category: "tvSeries",
    duration: 45,
    premiereDate: "2026-03-14",
    productionCompany: "Eksempel Film",
    director: "Test Instruktør",
    seasonNumber: 2,
    episodes: [{ number: 3 }, { number: 5 }],
    contractId: "contract-123",
  });

  assert.deepEqual(seed, {
    title: "Eksempel-serien",
    type: "tv-serie",
    year: "2026",
    duration_minutes: "45",
    episode_count: "5",
    season_number: "2",
    episode_number: "",
    selected_episodes: [3, 5],
    production_company: "Eksempel Film",
    director: "Test Instruktør",
    contract_id: "contract-123",
  });
});

test("manual edits survive a search/manual toggle when the same form value is reused", () => {
  const initial = emptyManualWorkForm({ title: "AI-titel", director: "AI-instruktør" });
  const edited = { ...initial, title: "Rettet titel", director: "Rettet instruktør" };
  const afterReturningToManual = edited;

  assert.equal(afterReturningToManual.title, "Rettet titel");
  assert.equal(afterReturningToManual.director, "Rettet instruktør");
});

test("series validation accepts selected AI episodes", () => {
  const value = emptyManualWorkForm({
    title: "Serie",
    type: "dokumentar-serie",
    year: "2026",
    season_number: "1",
    episode_count: "6",
    selected_episodes: [2, 4],
  });

  assert.equal(validateManualWork(value, "da"), null);
});

test("manual work requires a four-digit premiere year", () => {
  const missingYear = emptyManualWorkForm({ title: "Film" });
  assert.equal(validateManualWork(missingYear, "da"), "Angiv et gyldigt premiereår med fire cifre.");

  const validYear = { ...missingYear, year: "2026" };
  assert.equal(validateManualWork(validYear, "da"), null);
});

test("duplicate matching requires normalized title and the same premiere year", () => {
  assert.equal(isExactManualWorkMatch(
    { title: "Den Store Film!", year: 2026 },
    { title: "store film", year: 2026 },
  ), true);
  assert.equal(isExactManualWorkMatch(
    { title: "Den Store Film", year: 2025 },
    { title: "Store Film", year: 2026 },
  ), false);
});

test("manual duplicate policy only requires approval for an explicitly forced exact match", () => {
  assert.equal(manualWorkDuplicateDecision(false, false), "create");
  assert.equal(manualWorkDuplicateDecision(true, false), "block");
  assert.equal(manualWorkDuplicateDecision(true, true), "create_pending");
});

test("series validation requires a manual episode when no episode count is known", () => {
  const missingEpisode = emptyManualWorkForm({ title: "Serie", type: "tv-serie", year: "2026" });
  assert.equal(validateManualWork(missingEpisode, "da"), "Angiv mindst ét afsnit.");

  const withEpisode = { ...missingEpisode, episode_number: "7" };
  assert.equal(validateManualWork(withEpisode, "da"), null);
});

test("series correction fields are inferred from an SxxExx title", () => {
  assert.deepEqual(inferSeriesWorkFields({ title: "Frontlinjen - S02E04", episodeCount: 8 }), {
    seasonNumber: 2,
    episodeNumber: 4,
    seasonCount: 2,
    episodeCount: 8,
  });
});
