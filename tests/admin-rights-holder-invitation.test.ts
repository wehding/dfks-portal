import assert from "node:assert/strict";
import test from "node:test";
import { rightsHolderInvitationState, rightsHolderPortalAction } from "../lib/admin-rights-holder-invitation";

test("rettighedshaver uden afsendt invitation vises som ikke inviteret", () => {
  assert.equal(rightsHolderInvitationState({}), "not_invited");
  assert.equal(rightsHolderPortalAction({}), "invite");
});

test("afsendt invitation kan gensendes uden at oprette en ny bruger", () => {
  const holder = { invite_sent_at: "2026-09-01T12:00:00.000Z" };
  assert.equal(rightsHolderInvitationState(holder), "invited");
  assert.equal(rightsHolderPortalAction(holder), "reminder");
});

test("færdig onboarding giver aktiv status og loginlink", () => {
  const holder = { invite_sent_at: "2026-09-01T12:00:00.000Z", onboarding_completed_at: "2026-09-02T12:00:00.000Z" };
  assert.equal(rightsHolderInvitationState(holder), "active");
  assert.equal(rightsHolderPortalAction(holder), "login");
});
