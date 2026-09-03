import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { hasActiveMemberContractOwnership } from "../lib/member-contract-access";

const affiliation = {
  org_id: "secondary-org",
  rights_holder_id: "canonical-holder",
  valid_from: "2026-01-01",
  valid_to: null,
};

test("kanonisk rettighedshaver kan læse egen kontrakt i en aktiv sekundær organisation", () => {
  assert.equal(hasActiveMemberContractOwnership({
    profileIds: ["canonical-holder"],
    affiliations: [affiliation],
    rightsHolderId: "canonical-holder",
    orgId: "secondary-org",
    date: "2026-08-31",
  }), true);
});

test("kanonisk identitet uden aktiv organisationstilknytning afvises", () => {
  assert.equal(hasActiveMemberContractOwnership({
    profileIds: ["canonical-holder"],
    affiliations: [],
    rightsHolderId: "canonical-holder",
    orgId: "secondary-org",
    date: "2026-08-31",
  }), false);
  assert.equal(hasActiveMemberContractOwnership({
    profileIds: ["canonical-holder"],
    affiliations: [{ ...affiliation, valid_to: "2026-08-30" }],
    rightsHolderId: "canonical-holder",
    orgId: "secondary-org",
    date: "2026-08-31",
  }), false);
});

test("egen kontrakt i en sekundær organisation bruger kanonisk profil og aktiv tilknytning", async () => {
  const source = await readFile(
    new URL("../app/actions/member-contracts.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export async function getContractSignedUrl");
  const end = source.indexOf("export async function getContractDocumentPreview", start);
  assert.ok(start > 0 && end > start, "getContractSignedUrl was not found");

  const body = source.slice(start, end);
  assert.match(body, /\.from\("rettighedshavere"\)[\s\S]*?\.select\("id"\)/);
  assert.match(body, /\.from\("org_affiliations"\)/);
  assert.match(body, /hasActiveMemberContractOwnership/);
  assert.doesNotMatch(body, /profile\.org_id/);
});
