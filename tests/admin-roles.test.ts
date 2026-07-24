import assert from "node:assert/strict";
import test from "node:test";
import { highestStaffRole, isStaffRole } from "../lib/admin-roles";

test("systemrollen member sendes ikke som redigerbar administratorrolle", () => {
  assert.equal(isStaffRole("member"), false);
  assert.deepEqual(["member", "superadmin"].filter(isStaffRole), ["superadmin"]);
});

test("superadmin vinder over member og øvrige administratorroller", () => {
  assert.equal(highestStaffRole(["member", "viewer", "superadmin"]), "superadmin");
  assert.equal(highestStaffRole(["member"]), null);
});
