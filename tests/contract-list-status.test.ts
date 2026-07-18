import test from "node:test";
import assert from "node:assert/strict";
import { shouldShowWorkLinkBadge, unreadAdminMessageCount } from "../lib/contract-list-status";

test("an unread admin message produces a contract message tag", () => {
  assert.equal(unreadAdminMessageCount([
    { author_role: "admin", member_read_at: null },
    { author_role: "admin", member_read_at: "2026-07-18T10:00:00Z" },
    { author_role: "member", member_read_at: null },
  ]), 1);
});

test("validated contracts with a linked work hide the redundant work tag", () => {
  assert.equal(shouldShowWorkLinkBadge(true, "valideret"), false);
  assert.equal(shouldShowWorkLinkBadge(true, "kladde"), true);
  assert.equal(shouldShowWorkLinkBadge(false, "valideret"), true);
});
