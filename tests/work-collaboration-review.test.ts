import assert from "node:assert/strict";
import test from "node:test";
import { collaborationReviewStatusForSoloClaim, isOpenCollaborationReview } from "../lib/work-collaboration-review";

test("a solo claim is confirmed when no other rights holder is registered", () => {
  assert.equal(collaborationReviewStatusForSoloClaim(0), "solo_confirmed");
});

test("a solo claim becomes a dispute when another rights holder is registered", () => {
  assert.equal(collaborationReviewStatusForSoloClaim(1), "disputed");
  assert.equal(collaborationReviewStatusForSoloClaim(3), "disputed");
});

test("only unanswered and disputed reviews remain open", () => {
  assert.equal(isOpenCollaborationReview("pending"), true);
  assert.equal(isOpenCollaborationReview("disputed"), true);
  assert.equal(isOpenCollaborationReview("solo_confirmed"), false);
  assert.equal(isOpenCollaborationReview("coeditors_reported"), false);
});
