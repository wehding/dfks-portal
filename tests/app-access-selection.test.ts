import test from "node:test";
import assert from "node:assert/strict";
import { selectAppOrganisationAccess } from "../lib/app-access-selection";

test("dual-role user keeps both capabilities in the same active organisation", () => {
  const access = selectAppOrganisationAccess({
    roleRows: [{ role: "admin", org_id: "org-a" }],
    memberOrgIds: ["org-a"],
    requestedOrgId: "org-a",
  });

  assert.equal(access.orgId, "org-a");
  assert.equal(access.role, "admin");
  assert.deepEqual(access.staffOrgIds, ["org-a"]);
  assert.deepEqual(access.memberOrgIds, ["org-a"]);
});

test("admin and member access in different organisations never auto-switches", () => {
  const adminContext = selectAppOrganisationAccess({
    roleRows: [{ role: "admin", org_id: "org-admin" }],
    memberOrgIds: ["org-member"],
    requestedOrgId: "org-admin",
  });
  const memberContext = selectAppOrganisationAccess({
    roleRows: [{ role: "admin", org_id: "org-admin" }],
    memberOrgIds: ["org-member"],
    requestedOrgId: "org-member",
  });

  assert.equal(adminContext.orgId, "org-admin");
  assert.equal(adminContext.memberOrgIds.includes(adminContext.orgId!), false);
  assert.equal(memberContext.orgId, "org-member");
  assert.equal(memberContext.staffOrgIds.includes(memberContext.orgId!), false);
});

test("an unauthorised organisation is ignored", () => {
  const access = selectAppOrganisationAccess({
    roleRows: [{ role: "org-admin", org_id: "org-a" }],
    memberOrgIds: [],
    requestedOrgId: "org-foreign",
  });

  assert.equal(access.orgId, "org-a");
  assert.equal(access.availableOrgIds.includes("org-foreign"), false);
});

test("superadmin receives all organisations while member access stays scoped", () => {
  const access = selectAppOrganisationAccess({
    roleRows: [{ role: "superadmin", org_id: "org-a" }],
    memberOrgIds: ["org-b"],
    allOrganisationIds: ["org-a", "org-b", "org-c"],
    requestedOrgId: "org-c",
  });

  assert.equal(access.orgId, "org-c");
  assert.equal(access.role, "superadmin");
  assert.deepEqual(access.staffOrgIds, ["org-a", "org-b", "org-c"]);
  assert.deepEqual(access.memberOrgIds, ["org-b"]);
});
