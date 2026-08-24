import assert from "node:assert/strict";
import test from "node:test";
import { countUniqueWorkShareTasks } from "../lib/work-share-task-count";

test("deduplikerer arbejdsandelsopgaver på værk, sæson og afsnit", () => {
  assert.equal(countUniqueWorkShareTasks([
    { work_id: "work-1", season_number: 2, episode_number: null },
    { work_id: "work-1", season_number: 2, episode_number: null },
    { work_id: "work-1", season_number: 2, episode_number: 1 },
    { work_id: "work-2", season_number: null, episode_number: null },
  ]), 3);
});
