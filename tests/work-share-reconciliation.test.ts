import assert from "node:assert/strict";
import test from "node:test";
import {
  isEligibleWorkShareRole,
  normalizeCreditName,
  isMissingWorkCreditCacheSchemaError,
  proposeWorkShareCompromise,
  reconcileWorkCredits,
  resolveRightsHolderCreditMatch,
  renderInvitationTemplate,
} from "../lib/work-share-reconciliation";

test("kun egentlige klipperkrediteringer indgår i arbejdsandele", () => {
  for (const role of ["Klipper", "Klip", "Editor", "Film Editor", "Konceptuerende klipper"]) {
    assert.equal(isEligibleWorkShareRole(role), true, role);
  }
  for (const role of ["B-klipper", "Klipperassistent", "Assistant Editor", "Trailer klipper", "Pilotklip", "Klippekonsulent", "Supplerende klipper"]) {
    assert.equal(isEligibleWorkShareRole(role), false, role);
  }
});

test("manglende kildecache genkendes uden at skjule andre databasefejl", () => {
  assert.equal(isMissingWorkCreditCacheSchemaError({
    code: "PGRST205",
    message: "Could not find the table 'public.work_credit_source_syncs' in the schema cache",
  }), true);
  assert.equal(isMissingWorkCreditCacheSchemaError({
    code: "PGRST202",
    message: "Could not find the function public.claim_work_credit_source_refresh in the schema cache",
  }), true);
  assert.equal(isMissingWorkCreditCacheSchemaError({ code: "42501", message: "permission denied" }), false);
});
import {
  MEMBER_WORK_INVITE_TEXT,
  NON_MEMBER_WORK_INVITE_TEXT,
  validateWorkInvitationTemplate,
} from "../lib/rights-holder-invitation-templates";

test("DFI, TMDb og medlemsinput samles på samme personrække", () => {
  const rows = reconcileWorkCredits([
    { name: "Anna Jensen", source: "member", role: "Klipper" },
    { name: "Anna  Jensen", source: "dfi", role: "Klip" },
    { name: "Ánna Jensen", source: "tmdb", role: "Editor" },
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].sources.sort(), ["dfi", "member", "tmdb"]);
  assert.equal(normalizeCreditName("Ánna  Jensen"), "anna jensen");
});

test("en portalprofil opsuger et sikkert navnematch", () => {
  const rows = reconcileWorkCredits([
    { name: "Bo Hansen", source: "dfi", role: "Klipper" },
    { name: "Bo Hansen", source: "local", role: "Klipper", rightsHolderId: "holder-1" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rightsHolderId, "holder-1");
  assert.deepEqual(rows[0].sources.sort(), ["dfi", "local"]);
});

test("entydigt navn eller eksternt id forbindes automatisk", () => {
  assert.deepEqual(resolveRightsHolderCreditMatch({ exactNameRightsHolderIds: ["camilla"] }), {
    rightsHolderId: "camilla", matchType: "exact_name",
  });
  assert.deepEqual(resolveRightsHolderCreditMatch({ externalRightsHolderIds: ["simon"] }), {
    rightsHolderId: "simon", matchType: "external_id",
  });
});

test("uenige eller flere identiteter giver konflikt", () => {
  assert.deepEqual(resolveRightsHolderCreditMatch({ externalRightsHolderIds: ["a", "b"], exactNameRightsHolderIds: ["a"] }), {
    rightsHolderId: null, matchType: "conflict",
  });
  assert.deepEqual(resolveRightsHolderCreditMatch({ externalRightsHolderIds: ["a"], exactNameRightsHolderIds: ["b"] }), {
    rightsHolderId: null, matchType: "conflict",
  });
  assert.deepEqual(resolveRightsHolderCreditMatch({ exactNameRightsHolderIds: ["a", "b"] }), {
    rightsHolderId: null, matchType: "conflict",
  });
  assert.deepEqual(resolveRightsHolderCreditMatch({ externalRightsHolderIds: ["a"], exactNameRightsHolderIds: ["a", "b"] }), {
    rightsHolderId: "a", matchType: "external_id",
  });
});

test("kompromisforslaget summerer præcist til 100 minus reserve", () => {
  const result = proposeWorkShareCompromise([
    { id: "a", proposedPercent: 70 },
    { id: "b", proposedPercent: null },
    { id: "c", proposedPercent: 30 },
  ], 5);
  assert.equal(result.reduce((sum, row) => sum + row.finalPercent, 0), 95);
  assert.ok(result.every(row => Number.isInteger(row.finalPercent * 10)));
});

test("ligelig fordeling er deterministisk ved manglende svar", () => {
  const input = [{ id: "a", proposedPercent: null }, { id: "b", proposedPercent: null }, { id: "c", proposedPercent: null }];
  assert.deepEqual(proposeWorkShareCompromise(input, 0), proposeWorkShareCompromise(input, 0));
  assert.deepEqual(proposeWorkShareCompromise(input, 0).map(row => row.finalPercent), [33.4, 33.3, 33.3]);
});

test("kendte andele bevares og resten fordeles ligeligt", () => {
  const result = proposeWorkShareCompromise([
    { id: "a", proposedPercent: 50 },
    { id: "b", proposedPercent: null },
    { id: "c", proposedPercent: null },
  ], 0);
  assert.deepEqual(result.map(row => row.finalPercent), [50, 25, 25]);
});

test("reserve trækkes fra før manglende andele fordeles", () => {
  const result = proposeWorkShareCompromise([
    { id: "a", proposedPercent: 40 },
    { id: "b", proposedPercent: null },
    { id: "c", proposedPercent: null },
  ], 10);
  assert.deepEqual(result.map(row => row.finalPercent), [40, 25, 25]);
});

test("invitationens pladsholdere udfyldes", () => {
  const text = renderInvitationTemplate("Kære {navn}\n{værker}\n{organisation}\n{værk}", { name: "Carla", organisation: "DFKS", worksText: "• Film A", primaryWork: "Film A" });
  assert.equal(text, "Kære Carla\n• Film A\nDFKS\nFilm A");
});

test("begge invitationstyper forklarer kontraktkravet", () => {
  for (const template of [MEMBER_WORK_INVITE_TEXT, NON_MEMBER_WORK_INVITE_TEXT]) {
    assert.match(template, /uploade dine kontrakter/i);
    assert.match(template, /rettighedspengene/i);
  }
});

test("invitationsemnet afviser linjeskift og ukendte pladsholdere", () => {
  assert.throws(() => validateWorkInvitationTemplate("Emne\nBcc: uvedkommende@example.invalid", "Hej {navn}"), /én linje/);
  assert.throws(() => validateWorkInvitationTemplate("Hej {navn}", "Ukendt {email}"), /Ukendt pladsholder/);
});
