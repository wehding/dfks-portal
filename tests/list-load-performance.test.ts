import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("listetimer opdeler serverarbejdet i sikre målbare faser", async () => {
  const timer = await source("lib/server/list-load-timing.ts");
  assert.match(timer, /stages: Record<string, number>/);
  assert.match(timer, /console\.info\("\[list-performance\]"/);
  assert.doesNotMatch(timer, /contract|email|name|title/i);
});

test("Mine værker starter data på serveren og parallelt", async () => {
  const page = await source("app/portal/mine-vaerker/page.tsx");
  assert.doesNotMatch(page, /^\s*["']use client["']/);
  assert.match(page, /Promise\.all\(\[/);
  assert.match(page, /fetchMemberWorkOverview/);
  assert.match(page, /visibleWorkIds/);
  assert.match(page, /\.in\("work_id", visibleWorkIds\)/);
});

test("Mine kontrakter henter kontrakter og værkvalg i samme netværksrunde", async () => {
  const page = await source("app/portal/mine-kontrakter/page.tsx");
  assert.match(page, /\[pageResult, myWorksResult\]\s*=\s*await Promise\.all/);
  assert.match(page, /fetchMemberContractsPage/);
});

test("adminlister genbruger adgangskontekst og indlæser bootstrapdata samlet", async () => {
  const contractsAction = await source("app/actions/member-contracts.ts");
  const worksAction = await source("app/actions/work-management.ts");
  const contractsPage = await source("app/admin/kontrakter/ContractArchiveClient.tsx");
  const worksPage = await source("app/admin/vaerker/WorkArchiveClient.tsx");

  const contractLoad = contractsPage.slice(contractsPage.indexOf("const lookupsLoadedRef"), contractsPage.indexOf("// ── Live AI-jobstatus"));
  assert.doesNotMatch(contractLoad, /\/api\/admin\/context/);
  assert.match(contractLoad, /includeLookups/);
  assert.match(contractLoad, /includeSummary/);
  assert.match(contractsAction, /getContractImportStatesForOrg\(db, orgId, contractIds\)/);

  assert.match(worksAction, /assertAdminRole\(supabase, ADMIN_ROLES, user\.id\)/);
  assert.match(worksAction, /const orgId = admin\.orgId/);
  assert.match(worksPage, /includeLookups/);
  assert.match(worksPage, /includeSummary/);
});

test("layouts løser adgang server-side og sprog genbruger serverens terminologi", async () => {
  const portalLayout = await source("app/portal/layout.tsx");
  const adminLayout = await source("app/admin/layout.tsx");
  const i18n = await source("lib/i18n.tsx");

  assert.match(portalLayout, /getRequestAppAccessContext/);
  assert.match(adminLayout, /getRequestAppAccessContext/);
  assert.doesNotMatch(portalLayout, /use client/);
  assert.doesNotMatch(adminLayout, /use client/);
  assert.match(i18n, /dfks-terminology/);
  assert.doesNotMatch(i18n, /\/api\/access\/context/);
});
