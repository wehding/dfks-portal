import test from "node:test";
import assert from "node:assert/strict";
import {
  contractDataToManualWorkSeed,
  emptyManualWorkForm,
  validateManualWork,
} from "../lib/manual-work";

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
    season_number: "1",
    episode_count: "6",
    selected_episodes: [2, 4],
  });

  assert.equal(validateManualWork(value, "da"), null);
});

test("series validation requires a manual episode when no episode count is known", () => {
  const missingEpisode = emptyManualWorkForm({ title: "Serie", type: "tv-serie" });
  assert.equal(validateManualWork(missingEpisode, "da"), "Angiv mindst ét afsnit.");

  const withEpisode = { ...missingEpisode, episode_number: "7" };
  assert.equal(validateManualWork(withEpisode, "da"), null);
});
