import assert from "node:assert/strict";
import test from "node:test";

import {
  invitationAccessType,
  inviteSentAtAfterMail,
  isNewUserLimitReached,
} from "../lib/auth/invitation-policy";

test("nye brugere får invite-link, mens eksisterende brugere får recovery-link", () => {
  assert.equal(invitationAccessType(null), "invite");
  assert.equal(invitationAccessType("existing-user"), "recovery");
});

test("brugerlimit blokerer kun oprettelse af nye brugere", () => {
  assert.equal(isNewUserLimitReached({ existingUserId: null, currentUsers: 10, maxUsers: 10 }), true);
  assert.equal(isNewUserLimitReached({ existingUserId: "existing-user", currentUsers: 10, maxUsers: 10 }), false);
  assert.equal(isNewUserLimitReached({ existingUserId: null, currentUsers: 100, maxUsers: -1 }), false);
});

test("invite_sent_at beregnes kun efter en succesfuld mail", () => {
  const now = "2026-07-22T16:00:00.000Z";
  assert.equal(inviteSentAtAfterMail(true, now), now);
  assert.equal(inviteSentAtAfterMail(false, now), null);
});
