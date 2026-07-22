import assert from "node:assert/strict";
import test from "node:test";

import { contractCoversEpisode } from "../lib/contract-work-scope";

const episode = {
  id: "episode-2",
  parent_work_id: "series-1",
  season_number: 3,
  episode_number: 2,
};

test("a contract linked directly to an episode covers that episode", () => {
  assert.equal(contractCoversEpisode({ work_id: "episode-2" }, episode), true);
});

test("an empty episode scope on the series covers the whole season", () => {
  assert.equal(contractCoversEpisode({ work_id: "series-1", season_number: 3, episode_numbers: [] }, episode), true);
});

test("a selected episode scope only covers the selected episodes", () => {
  assert.equal(contractCoversEpisode({ work_id: "series-1", season_number: 3, episode_numbers: [1, 2] }, episode), true);
  assert.equal(contractCoversEpisode({ work_id: "series-1", season_number: 3, episode_numbers: [1, 4] }, episode), false);
});

test("a series contract for another season does not cover the episode", () => {
  assert.equal(contractCoversEpisode({ work_id: "series-1", season_number: 4, episode_numbers: [] }, episode), false);
});
