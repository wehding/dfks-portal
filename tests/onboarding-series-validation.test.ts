import assert from "node:assert/strict";
import test from "node:test";
import { firstOnboardingSeriesMissingEpisodes, needsOnboardingEpisodeSelection } from "../lib/onboarding-series-validation";

test("markerer kun en valgt serie uden afsnit", () => {
  assert.equal(needsOnboardingEpisodeSelection({ selected: true, isSeries: true, selectedEpisodes: [] }), true);
  assert.equal(needsOnboardingEpisodeSelection({ selected: false, isSeries: true, selectedEpisodes: [] }), false);
  assert.equal(needsOnboardingEpisodeSelection({ selected: true, isSeries: false, selectedEpisodes: [] }), false);
  assert.equal(needsOnboardingEpisodeSelection({ selected: true, isSeries: true, selectedEpisodes: [1] }), false);
});

test("finder den første serie der mangler afsnitsvalg", () => {
  const credits = [
    { id: "film", series: false, episodes: [] as number[] },
    { id: "first", series: true, episodes: [] as number[] },
    { id: "second", series: true, episodes: [] as number[] },
  ];
  const missing = firstOnboardingSeriesMissingEpisodes(credits, credit => credit.series, credit => credit.episodes);
  assert.equal(missing?.id, "first");
});
