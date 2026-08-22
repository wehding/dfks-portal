import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createListLoadTimer } from "../lib/server/list-load-timing";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("listetimer opdeler serverarbejdet i målbare faser", () => {
  const samples = [100, 125, 180, 205];
  const originalInfo = console.info;
  console.info = () => undefined;
  try {
    const timer = createListLoadTimer("test", () => samples.shift() ?? 205);
    timer.mark("access");
    timer.mark("list");
    assert.deepEqual(timer.finish({ rowCount: 20 }), {
      totalMs: 105,
      stages: { access: 25, list: 55 },
    });
  } finally {
    console.info = originalInfo;
  }
});

test("Mine værker starter data på serveren og parallelt", async () => {
  const page = await source("app/portal/mine-vaerker/page.tsx");
  assert.doesNotMatch(page, /^\s*["']use client["']/);
  assert.match(page, /Promise\.all\(\[/);
  assert.match(page, /fetchMemberWorkOverview/);
  assert.match(page, /fetchMemberContractsList/);
});

test("Mine kontrakter henter kontrakter og værkvalg i samme netværksrunde", async () => {
  const page = await source("app/portal/mine-kontrakter/page.tsx");
  assert.match(page, /\[listRes, myWorksResult\]\s*=\s*await Promise\.all/);
});

test("adminlister genbruger adgangskontekst og indlæser bootstrapdata samlet", async () => {
  const contractsAction = await source("app/actions/member-contracts.ts");
  const worksAction = await source("app/actions/work-management.ts");
  const contractsPage = await source("app/admin/kontrakter/page.tsx");
  const worksPage = await source("app/admin/vaerker/page.tsx");

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

test("layouts og sprog deler ét kortlivet adgangskontekstopslag", async () => {
  const portalLayout = await source("app/portal/layout.tsx");
  const adminLayout = await source("app/admin/layout.tsx");
  const i18n = await source("lib/i18n.tsx");
  const contextClient = await source("lib/access-context-client.ts");

  assert.match(portalLayout, /getAccessContextCached<AccessContextResponse>/);
  assert.match(adminLayout, /getAccessContextCached</);
  assert.match(i18n, /getAccessContextCached</);
  assert.match(contextClient, /if \(inFlight\) return inFlight/);
  assert.match(contextClient, /CACHE_TTL_MS = 5_000/);
});
