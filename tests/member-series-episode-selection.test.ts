import assert from "node:assert/strict";
import test from "node:test";
import { classifyEpisodeSelection, normalizeEpisodeNumbers } from "../lib/member-series-episode-selection";

test("et oversprunget afsnitsvalg bliver pending", () => {
  assert.deepEqual(classifyEpisodeSelection([]), {
    status: "pending",
    episodeNumbers: [],
    coversWholeSeason: false,
  });
});

test("konkrete afsnit normaliseres og bekræfter valget", () => {
  assert.deepEqual(normalizeEpisodeNumbers([3, 1, 3, 0, -2]), [1, 3]);
  assert.equal(classifyEpisodeSelection([3, 1]).status, "confirmed");
});

test("hele sæsonen er et eksplicit bekræftet valg", () => {
  assert.deepEqual(classifyEpisodeSelection([], true), {
    status: "confirmed",
    episodeNumbers: [],
    coversWholeSeason: true,
  });
});
