import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wizard = readFileSync("components/admin/work-share-reconciliation-wizard.tsx", "utf8");
const actions = readFileSync("app/actions/work-share-cases.ts", "utf8");
const memberEditor = readFileSync("app/portal/mine-vaerker/components/EditWorkModal.tsx", "utf8");
const adminArchive = readFileSync("app/admin/vaerker/WorkArchiveClient.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260823230302_cache_work_credit_sources.sql", "utf8");

test("arbejdsandelsdialogen henter ikke hele rettighedshaverlisten", () => {
  assert.doesNotMatch(wizard, /fetchAdminRightsHolders/);
  assert.match(wizard, /rettighedshavere-search\?scope=all/);
});

test("kildeopdatering erstatter kun den aktive sag", () => {
  assert.match(wizard, /current\.map\(row => row\.id === refreshed\.id \? refreshed : row\)/);
  assert.doesNotMatch(wizard, /refreshAdminShareCaseCredits\(active\.id\)\.then\(load\)/);
  assert.match(actions, /case: await fetchAdminShareCase/);
});

test("sæsonssager samler klippere fra seriens afsnit", () => {
  const evidence = readFileSync("lib/server/work-credit-evidence.ts", "utf8");
  assert.match(evidence, /parent_work_id/);
  assert.match(evidence, /season_number/);
  assert.match(evidence, /\.in\("work_id", assignmentWorkIds\)/);
});

test("klipper og arbejdsandel vises samlet i en kompakt dialog", () => {
  assert.match(wizard, /1\. Klippere og arbejdsandele/);
  assert.match(wizard, /Arbejdsandel i procent/);
  assert.match(wizard, /grid grid-cols-2/);
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

test("arbejdsandelsdialogen forbliver øverst ved sagsnavigation", () => {
  assert.match(adminArchive, /top-\[max\(1rem,env\(safe-area-inset-top\)\)\]/);
  assert.match(adminArchive, /translate-y-0/);
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
