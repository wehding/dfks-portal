import test from "node:test";
import assert from "node:assert/strict";
import { hasLinkedWork, isPendingContractValidation, shouldShowWorkLinkBadge, unreadAdminMessageCount } from "../lib/contract-list-status";

test("an unread admin message produces a contract message tag", () => {
  assert.equal(unreadAdminMessageCount([
    { author_role: "admin", member_read_at: null },
    { author_role: "admin", member_read_at: "2026-07-18T10:00:00Z" },
    { author_role: "member", member_read_at: null },
  ]), 1);
});

test("validated contracts with a linked work hide the redundant work tag", () => {
  const cases = [
    { status: "kladde", workId: null, visible: true },
    { status: "kladde", workId: "work-1", visible: true },
    { status: "valideret", workId: null, visible: true },
    { status: "valideret", workId: "work-1", visible: false },
    { status: "arkiveret", workId: null, visible: true },
    { status: "arkiveret", workId: "work-1", visible: true },
  ];
  for (const item of cases) assert.equal(shouldShowWorkLinkBadge(hasLinkedWork(item.workId), item.status), item.visible);
});

test("work linkage depends only on contracts.work_id", () => {
  assert.equal(hasLinkedWork("48f1fe07-3335-43ae-b6c5-a9dc5f7ae57c"), true);
  assert.equal(hasLinkedWork(null), false);
  assert.equal(hasLinkedWork(undefined), false);
  assert.equal(hasLinkedWork(""), false);
});

test("only active contracts with a linked work are pending validation", () => {
  assert.equal(isPendingContractValidation({ status: "kladde", work_id: "work-1" }), true);
  assert.equal(isPendingContractValidation({ status: "mangler_vaerk", work_id: "work-1" }), true);
  assert.equal(isPendingContractValidation({ status: "kladde", work_id: null }), false);
  assert.equal(isPendingContractValidation({ status: "valideret", work_id: "work-1" }), false);
  assert.equal(isPendingContractValidation({ status: "arkiveret", work_id: "work-1" }), false);
});
