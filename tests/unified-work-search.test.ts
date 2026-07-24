import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWorkSearchTitle, shouldMergeWorkSearchResults } from "../lib/unified-work-search";

test("normaliserer danske titler og indledende artikler", () => {
  assert.equal(normalizeWorkSearchTitle("Velkommen til Frontlinjen!"), "velkommen til frontlinjen");
  assert.equal(normalizeWorkSearchTitle("Den Åbne Dør"), "abne dør");
});

test("samler DFI- og TMDB-serier selv om DFI mangler år", () => {
  assert.equal(shouldMergeWorkSearchResults(
    { title: "Velkommen til frontlinjen", year: null, type: "tv-serie" },
    { title: "Velkommen til Frontlinjen", year: 2025, type: "tv" },
  ), true);
});

test("holder samme filmtitel fra forskellige år og typer adskilt", () => {
  assert.equal(shouldMergeWorkSearchResults(
    { title: "Hamlet", year: 1996, type: "spillefilm" },
    { title: "Hamlet", year: 2024, type: "spillefilm" },
  ), false);
  assert.equal(shouldMergeWorkSearchResults(
    { title: "Borgen", year: null, type: "tv-serie" },
    { title: "Borgen", year: 2010, type: "spillefilm" },
  ), false);
});
