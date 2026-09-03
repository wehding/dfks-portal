import assert from "node:assert/strict";
import test from "node:test";
import { hasCompleteAssignmentDistribution, hasResolvedShareDistribution } from "../lib/contract-validation-readiness";

test("en åben arbejdsandelssag gør ikke kontrakten valideringsklar", () => {
  assert.equal(hasResolvedShareDistribution({
    status: "awaiting_admin",
    reserve_percent: 0,
    work_share_participants: [
      { rights_holder_id: "a", final_percent: 50 },
      { rights_holder_id: "b", final_percent: 50 },
    ],
  }), false);
});

test("kun en afsluttet fordeling på præcis 100 procent er klar", () => {
  assert.equal(hasResolvedShareDistribution({
    status: "resolved",
    reserve_percent: 10,
    work_share_participants: [
      { rights_holder_id: "a", final_percent: 45 },
      { rights_holder_id: "b", final_percent: 45 },
    ],
  }), true);
  assert.equal(hasResolvedShareDistribution({
    status: "resolved",
    reserve_percent: 0,
    work_share_participants: [
      { rights_holder_id: "a", final_percent: 60 },
      { rights_holder_id: "b", final_percent: null },
    ],
  }), false);
});

test("flere tilknyttede klippere er ikke nok uden færdige andele", () => {
  assert.equal(hasCompleteAssignmentDistribution([
    { rights_holder_id: "a", share_percent: null },
    { rights_holder_id: "b", share_percent: null },
  ]), false);
  assert.equal(hasCompleteAssignmentDistribution([
    { rights_holder_id: "a", share_percent: 40 },
    { rights_holder_id: "b", share_percent: 60 },
  ]), true);
});
