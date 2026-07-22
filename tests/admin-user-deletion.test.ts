import assert from "node:assert/strict";
import test from "node:test";

import { isStillUnassigned, parseUnassignedRecordId } from "../lib/admin-user-deletion";

test("parses prefixed auth and rights-holder identifiers", () => {
  assert.equal(parseUnassignedRecordId("auth:user-1", "auth_user"), "user-1");
  assert.equal(parseUnassignedRecordId("rights-holder:holder-1", "rights_holder"), "holder-1");
});

test("keeps raw identifiers unchanged", () => {
  assert.equal(parseUnassignedRecordId("holder-1", "rights_holder"), "holder-1");
});

test("only treats a record with no relations as unassigned", () => {
  assert.equal(isStillUnassigned({ affiliations: 0, roles: 0, profiles: 0 }), true);
  assert.equal(isStillUnassigned({ affiliations: 1, roles: 0, profiles: 0 }), false);
  assert.equal(isStillUnassigned({ affiliations: 0, roles: 1, profiles: 0 }), false);
  assert.equal(isStillUnassigned({ affiliations: 0, roles: 0, profiles: 1 }), false);
});
