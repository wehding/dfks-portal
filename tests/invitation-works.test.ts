import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatInvitationWorkTitles,
  formatInvitationWorks,
  reconcileInvitationWorks,
  resolveExactInvitationPerson,
} from "../lib/invitation-works";

test("et enkelt eksakt personmatch accepteres på tværs af danske tegn", () => {
  assert.deepEqual(resolveExactInvitationPerson(["Søren Ågård"], [
    { id: 42, name: "Soren Aagaard" },
    { id: 17, name: "En anden person" },
  ]), { status: "matched", id: 42 });
});

test("flere eksakte person-id'er er tvetydige og må ikke gættes", () => {
  assert.deepEqual(resolveExactInvitationPerson(["Anna Jensen"], [
    { id: 1, name: "Anna Jensen" },
    { id: 2, name: "Anna Jensen" },
  ]), { status: "ambiguous", id: null });
  assert.deepEqual(resolveExactInvitationPerson(["Anna Jensen"], [
    { id: 3, name: "Anne Jensen" },
  ]), { status: "none", id: null });
});

test("alternative navne kan give et sikkert eksakt match", () => {
  assert.deepEqual(resolveExactInvitationPerson(["Marie Nielsen", "Marie H. Nielsen"], [
    { id: 9, name: "Marie H. Nielsen" },
  ]), { status: "matched", id: 9 });
});

test("lokale, DFI- og TMDb-dubletter samles med kilder og lokal status", () => {
  const works = reconcileInvitationWorks([
    { id: "local-1", title: "Bullshit", year: 2024, sources: ["Portal"], verification: "linked", identityKeys: ["tmdb:100"] },
    { id: "dfi-50", title: "Bullshit", year: 2024, sources: ["DFI"], verification: "external_candidate", identityKeys: ["dfi:50"] },
    { id: "tmdb-100", title: "Bullshit", year: 2024, sources: ["TMDb"], verification: "external_candidate", identityKeys: ["tmdb:100"] },
  ]);
  assert.equal(works.length, 1);
  assert.equal(works[0].verification, "linked");
  assert.deepEqual(works[0].sources, ["Portal", "DFI", "TMDb"]);
});

test("foretrukket værk står først, og eksterne fund markeres som mulige", () => {
  const works = reconcileInvitationWorks([
    { id: "new", title: "Ny film", year: 2025, sources: ["DFI"], verification: "external_candidate" },
    { id: "preferred", title: "Valgt film", year: 2020, sources: ["Portal"], verification: "linked", preferred: true },
  ]);
  assert.equal(works[0].id, "preferred");
  assert.match(formatInvitationWorks(works), /Ny film \(2025\) · DFI · mulig kreditering/);
});

test("listen begrænses til ti titler og bruger neutral fallback", () => {
  const works = Array.from({ length: 12 }, (_, index) => ({
    id: String(index), title: `Film ${index}`, year: 2020 + index, sources: ["TMDb" as const], verification: "external_candidate" as const,
  }));
  assert.match(formatInvitationWorks(works), /2 øvrige titler/);
  assert.equal(formatInvitationWorks([]), "Vi kunne ikke hente en værksliste nu. Du kan gennemgå og tilføje dine værker i portalen.");
});

test("betainvitationens værkliste viser kun titler", () => {
  const works = [{
    id: "work-1", title: "Bullshit", year: 2024, sources: ["Portal" as const, "DFI" as const], verification: "external_candidate" as const,
  }];
  assert.equal(formatInvitationWorkTitles(works), "• Bullshit");
  assert.doesNotMatch(formatInvitationWorkTitles(works), /2024|Portal|DFI|mulig kreditering/);

  const route = readFileSync("app/api/admin/user/route.ts", "utf8");
  assert.match(route, /isBetaPreview[\s\S]+formatInvitationWorkTitles\(workLookup\.works\)/);
  assert.match(route, /isBetaInvitation[\s\S]+formatInvitationWorkTitles\(workLookup\.works\)/);
});

test("inviteruten bruger samme resolver til preview, standard og beta uden at lagre rådata", () => {
  const route = readFileSync("app/api/admin/user/route.ts", "utf8");
  assert.match(route, /resolveInvitationWorks\(\{ db: admin, orgId, rightsHolderId: rhId/);
  assert.doesNotMatch(route, /!isBetaInvitation \? await invitationWorkList/);
  assert.match(route, /body\.action !== "reminder"/);
  assert.match(route, /component: "admin\.user\.invitation-work-preview"/);
  assert.doesNotMatch(route, /metadata:\s*\{[^}]*worksText/);
});

test("beta-audit tillader kun tællinger og kilde-status", () => {
  const migration = readFileSync("supabase/migrations/20260903005609_beta_invite_work_lookup_audit.sql", "utf8");
  assert.match(migration, /p_work_lookup jsonb default/);
  assert.match(migration, /safe_work_lookup := jsonb_build_object/);
  assert.match(migration, /revoke all on function public\.set_beta_tester_status[\s\S]+public, anon, authenticated/);
  assert.doesNotMatch(migration, /email_address|invite_url|person_id|search_query|work_title/i);
});
