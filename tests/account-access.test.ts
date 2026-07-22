import assert from "node:assert/strict";
import test from "node:test";
import {
  accountAccessPath,
  buildAccountAccessUrl,
  isAccountAccessMode,
  validateAccountPassword,
} from "../lib/auth/account-access";
import { hasStaffRole } from "../lib/auth/post-login";

test("buildAccountAccessUrl bygger et app-ejet invitationslink", () => {
  const url = new URL(buildAccountAccessUrl("https://portal.example/", "token+/=", "invite"));
  assert.equal(url.origin, "https://portal.example");
  assert.equal(url.pathname, "/auth/confirm");
  assert.equal(url.searchParams.get("token_hash"), "token+/=");
  assert.equal(url.searchParams.get("type"), "invite");
});

test("accountAccessPath tillader kun interne, faste destinationer", () => {
  assert.equal(accountAccessPath("invite"), "/auth/opret-adgang?mode=invite");
  assert.equal(
    accountAccessPath("recovery", "invalid_link"),
    "/auth/opret-adgang?mode=recovery&error=invalid_link"
  );
  assert.equal(isAccountAccessMode("invite"), true);
  assert.equal(isAccountAccessMode("recovery"), true);
  assert.equal(isAccountAccessMode("signup"), false);
  assert.equal(isAccountAccessMode("https://example.com"), false);
});

test("validateAccountPassword håndhæver udfyldning, længde og gentagelse", () => {
  assert.equal(validateAccountPassword("", ""), "password_required");
  assert.equal(validateAccountPassword("kort", "kort"), "password_too_short");
  assert.equal(validateAccountPassword("langnok1", "langnok2"), "password_mismatch");
  assert.equal(validateAccountPassword("langnok1", "langnok1"), null);
});

test("alle medarbejderroller genkendes ved rollebaseret navigation", () => {
  for (const role of ["superadmin", "admin", "org-admin", "jurist", "viewer"]) {
    assert.equal(hasStaffRole([role]), true, role);
  }
  assert.equal(hasStaffRole(["member"]), false);
  assert.equal(hasStaffRole([]), false);
});
