import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCreditName,
  proposeWorkShareCompromise,
  reconcileWorkCredits,
  renderInvitationTemplate,
} from "../lib/work-share-reconciliation";
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
