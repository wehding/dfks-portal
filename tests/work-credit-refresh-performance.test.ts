import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wizard = readFileSync("components/admin/work-share-reconciliation-wizard.tsx", "utf8");
const actions = readFileSync("app/actions/work-share-cases.ts", "utf8");
const memberEditor = readFileSync("app/portal/mine-vaerker/components/EditWorkModal.tsx", "utf8");
const memberWorkList = readFileSync("app/portal/mine-vaerker/MineVaerkerClient.tsx", "utf8");
const adminArchive = readFileSync("app/admin/vaerker/WorkArchiveClient.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260823230302_cache_work_credit_sources.sql", "utf8");

test("arbejdsandelsdialogen henter ikke hele rettighedshaverlisten", () => {
  assert.doesNotMatch(wizard, /fetchAdminRightsHolders/);
  assert.match(wizard, /rettighedshavere-search\?scope=all/);
});

test("kildeopdatering erstatter kun den aktive sag", () => {
  assert.match(wizard, /setActive\(refreshed\)/);
  assert.doesNotMatch(wizard, /refreshAdminShareCaseCredits\(active\.id\)\.then\(load\)/);
  assert.match(actions, /case: await fetchAdminShareCase/);
});

test("sæsonssager samler klippere fra seriens afsnit", () => {
  const evidence = readFileSync("lib/server/work-credit-evidence.ts", "utf8");
  assert.match(evidence, /parent_work_id/);
  assert.match(evidence, /season_number/);
  assert.match(evidence, /\.in\("work_id", assignmentWorkIds\)/);
});

test("klipper, kilder, arbejdsandel og handlinger vises samlet i en kompakt række", () => {
  assert.match(wizard, /1\. Klippere og arbejdsandele/);
  assert.match(wizard, /Arbejdsandel i procent/);
  assert.match(wizard, /grid-cols-\[minmax\(0,1fr\)_92px\]/);
  assert.match(wizard, /Oplyst: \{participant\.proposed_percent != null/);
  assert.match(wizard, />Fjern<\/Button>/);
  assert.match(wizard, /Forrige værk/);
  assert.match(wizard, /Spring til næste værk/);
  assert.doesNotMatch(wizard, /Portalens oplysninger samles med krediteringer/);
  assert.match(wizard, /2\. Kontrollér og godkend/);
  assert.doesNotMatch(wizard, /3\. Kontrollér og godkend/);
  assert.doesNotMatch(wizard, /setStep\(/);
});

test("rettighedshaverens navn åbner profilen og oprettelse kan sende invitation", () => {
  assert.match(wizard, /href={`\/admin\/rettighedshavere\?edit=/);
  assert.doesNotMatch(wizard, />Åbn rettighedshaver</);
  assert.match(wizard, />Opret uden at invitere</);
  assert.match(wizard, />Opret med invitation</);
});

test("værkeditorerne samler registrerede medklippere under rettighedshavere", () => {
  assert.match(actions, /registeredCoEditors/);
  assert.match(memberEditor, /result\.registeredCoEditors/);
  assert.match(memberEditor, />Rettighedshavere</);
  assert.match(adminArchive, /InfoPanel title="Rettighedshavere"/);
  assert.match(adminArchive, /replaceAssignments: !editingSeasonGroup/);
});

test("arbejdsandelsfanen erstatter dialogen og bruger URL-navigation", () => {
  const tab = readFileSync("components/admin/work-share-reconciliation-tab.tsx", "utf8");
  assert.doesNotMatch(adminArchive, /shareTasksOpen/);
  assert.match(adminArchive, /WorkShareReconciliationTab/);
  assert.match(tab, /shareTask/);
  assert.match(tab, /Tilbage til køen|works\.shareQueue\.back/);
});

test("ukendt medklipper bruger samme interne og eksterne krediteringsgrundlag", () => {
  assert.match(actions, /fetchMemberCoEditorSuggestions/);
  assert.match(actions, /refreshWorkCreditEvidence/);
  assert.match(actions, /buildReconciledWorkCredits/);
  assert.match(actions, /matchWorkCreditsToRightsHolders/);
  assert.match(actions, /Værket er ikke tilknyttet din profil/);
  assert.match(memberWorkList, /Kunne det være en eller flere af disse\?/);
  assert.match(memberWorkList, /reviewCoEditorSuggestions\.map/);
  assert.match(memberWorkList, /type="checkbox"/);
  assert.match(memberWorkList, /Ingen passer – registrér ukendt medklipper/);
});

test("det første gennemgangsværk forklarer hver handling", () => {
  assert.match(memberWorkList, /reviewCurrent === 1/);
  assert.match(memberWorkList, /Søg efter en bestemt person/);
  assert.match(memberWorkList, /Systemet foreslår mulige krediterede klippere/);
  assert.match(memberWorkList, /Vælg dette, hvis ingen andre klippere/);
});

test("værksmenuen adskiller almindelige opgaver fra arbejdsandele", () => {
  const route = readFileSync("app/api/navigation/badges/route.ts", "utf8");
  assert.match(route, /admin_works: Math\.max\(0, Number\([\s\S]+admin_works[\s\S]+\) - workShareTaskCount\)/);
  assert.match(route, /admin_work_share_tasks: workShareTaskCount/);
});

test("kildecache har syv dages friskhed, retrybegrænsning og atomisk claim", () => {
  assert.match(migration, /interval '7 days'/);
  assert.match(migration, /on conflict \(org_id, work_id, source\) do update/i);
  assert.match(migration, /status <> 'refreshing'/);
  assert.match(actions, /refreshWorkCreditEvidence/);
});

test("migrationen reparerer kun entydige pending-match i samme organisation", () => {
  assert.match(migration, /relationship_status = 'pending'/);
  assert.match(migration, /participant\.relationship_status = 'pending_match'/);
  assert.match(migration, /having count\(distinct claim\.rights_holder_id\) = 1/);
  assert.match(migration, /claim\.org_id = participant\.org_id/);
  assert.match(migration, /not exists/i);
});

test("TMDb-fejl kan ikke gemmes som et frisk tomt søgeresultat", () => {
  const tmdb = readFileSync("app/actions/tmdb.ts", "utf8");
  const evidence = readFileSync("lib/server/work-credit-evidence.ts", "utf8");
  assert.match(tmdb, /searchTMDBWithStatus/);
  assert.match(evidence, /if \(!result\.success\) throw new Error\(result\.error\)/);
});
