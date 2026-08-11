import assert from "node:assert/strict";
import test from "node:test";
import { calculateEpisodeRemovalImpact, classifyEpisodeSelection, normalizeEpisodeNumbers } from "../lib/member-series-episode-selection";

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

test("delvist fravalg kræver bekræftelse uden at fjerne kontraktvalidering", () => {
  assert.deepEqual(calculateEpisodeRemovalImpact({
    currentEpisodes: [1, 2, 3],
    nextEpisodes: [1, 3],
    contractStatuses: ["valideret", "kladde"],
  }), {
    removedEpisodes: [2],
    requiresConfirmation: true,
    selectionWillBePending: false,
    contractsLosingValidation: 0,
  });
});

test("tomt afsnitsvalg sætter validerede kontrakter tilbage til afventer", () => {
  const impact = calculateEpisodeRemovalImpact({
    currentEpisodes: [1, 2],
    nextEpisodes: [],
    contractStatuses: ["valideret", "valideret", "afventer", "arkiveret"],
  });
  assert.deepEqual(impact.removedEpisodes, [1, 2]);
  assert.equal(impact.selectionWillBePending, true);
  assert.equal(impact.contractsLosingValidation, 2);
});

test("hele sæsonen fjerner ikke afsnit eller validering", () => {
  assert.deepEqual(calculateEpisodeRemovalImpact({
    currentEpisodes: [1, 2],
    nextEpisodes: [],
    coversWholeSeason: true,
    contractStatuses: ["valideret"],
  }), {
    removedEpisodes: [],
    requiresConfirmation: false,
    selectionWillBePending: false,
    contractsLosingValidation: 0,
  });
});

test("et bekræftet valg kræver advarsel før det sættes til pending", () => {
  const impact = calculateEpisodeRemovalImpact({
    currentEpisodes: [],
    nextEpisodes: [],
    currentStatus: "confirmed",
    contractStatuses: ["valideret"],
  });
  assert.equal(impact.requiresConfirmation, true);
  assert.equal(impact.contractsLosingValidation, 1);
});
