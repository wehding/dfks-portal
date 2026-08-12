import assert from "node:assert/strict";
import test from "node:test";
import { onboardingSeriesParentIds } from "../lib/onboarding-series-data";

test("henter børn både for direkte seriehovedværker og tilknyttede afsnit", () => {
  const ids = onboardingSeriesParentIds([
    { work: { id: "parent-direct", type: "tv-serie", parent_work_id: null } },
    { work: { id: "episode", type: "tv-serie", parent_work_id: "parent-from-child" } },
    { work: { id: "film", type: "spillefilm", parent_work_id: null } },
  ]);
  assert.deepEqual(ids.sort(), ["parent-direct", "parent-from-child"]);
});
