import assert from "node:assert/strict";
import test from "node:test";
import {
  createLatestRequestGuard,
  normalizeSeasonNumber,
  seasonEpisodeLookupResult,
  seasonNumberForKey,
  seasonLookupMessage,
  stepSeasonNumber,
} from "../lib/season-selection";
import { buildCompleteEpisodeOptions } from "../lib/series-episodes";

test("første klik op skifter straks fra sæson 1 til 2", () => {
  assert.equal(stepSeasonNumber(1, "up"), 2);
});

test("gentagne sæsontrin respekterer minimum 1", () => {
  assert.equal(stepSeasonNumber(stepSeasonNumber(1, "up"), "up"), 3);
  assert.equal(stepSeasonNumber(2, "down"), 1);
  assert.equal(stepSeasonNumber(1, "down"), 1);
});

test("manuel indtastning og tastaturpile normaliseres", () => {
  assert.equal(normalizeSeasonNumber("6"), 6);
  assert.equal(normalizeSeasonNumber("0"), 1);
  assert.equal(normalizeSeasonNumber("ugyldig"), 1);
  assert.equal(seasonNumberForKey(1, "ArrowUp"), 2);
  assert.equal(seasonNumberForKey(2, "ArrowDown"), 1);
  assert.equal(seasonNumberForKey(6, "Enter"), 6);
  assert.equal(seasonNumberForKey(1, "Escape"), null);
});

test("ukendt sæson returnerer not_found uden afsnit", () => {
  assert.deepEqual(seasonEpisodeLookupResult({ season: 6, options: [], confirmed: false }), {
    status: "not_found",
    season: 6,
    options: [],
  });
});

test("sæsonfejl vises på dansk og engelsk", () => {
  assert.equal(seasonLookupMessage("da", "not_found", 6), "Sæson 6 blev ikke fundet.");
  assert.equal(seasonLookupMessage("en", "error", 6), "Could not load season 6. Try again.");
});

test("API-fejl returnerer error uden stale afsnit", () => {
  assert.deepEqual(seasonEpisodeLookupResult({ season: 6, options: [{ number: 1 }], confirmed: true, error: "timeout" }), {
    status: "error",
    season: 6,
    options: [],
    error: "timeout",
  });
});

test("kun bekræftede sæsondata returneres som found", () => {
  assert.deepEqual(seasonEpisodeLookupResult({ season: 2, options: [{ number: 1 }], confirmed: true }), {
    status: "found",
    season: 2,
    options: [{ number: 1 }],
  });
});

test("afsnitsbyggeren opretter ikke otte placeholders uden en kilde", () => {
  assert.deepEqual(buildCompleteEpisodeOptions({ seasonNumber: 6 }), []);
  assert.equal(buildCompleteEpisodeOptions({ seasonNumber: 1, episodeCount: 3 }).length, 3);
});

test("kun seneste sæsonrequest må anvende sit svar", () => {
  const guard = createLatestRequestGuard();
  const seasonOneRequest = guard.begin();
  const seasonTwoRequest = guard.begin();
  assert.equal(guard.isLatest(seasonOneRequest), false);
  assert.equal(guard.isLatest(seasonTwoRequest), true);
});
