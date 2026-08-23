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

test("Mit overblik streamer opgaver før statistik og indbakke", async () => {
  const page = await source("app/portal/page.tsx");
  const sections = await source("components/portal/dashboard-sections.tsx");
  assert.match(page, /<Suspense[\s\S]*DashboardTasksSection/);
  assert.match(page, /DashboardSalarySection/);
  assert.match(page, /DashboardInboxSection/);
  assert.match(sections, /member-dashboard-tasks/);
  assert.match(sections, /member-dashboard-statistics/);
  assert.doesNotMatch(page, /contract_validations/);
});

test("Kontraktgennemgang bruger smal side og målrettede medarbejderopslag", async () => {
  const route = await source("app/api/admin/contracts/route.ts");
  const page = await source("app/admin/kontraktgennemgang/page.tsx");
  const client = await source("app/admin/kontraktgennemgang/review-page-client.tsx");
  const queue = await source("app/admin/kontraktgennemgang/review-queue.tsx");
  assert.doesNotMatch(route, /select\("\*"/);
  assert.doesNotMatch(route, /listUsers/);
  assert.match(route, /getAuthUserLabels/);
  assert.match(queue, /pageSize/);
  assert.match(queue, /filter: `org_id=eq\.\$\{orgId\}`/);
  assert.match(queue, /scheduleRefresh/);
  assert.match(client, /dynamic\([\s\S]*manual-contract-review/);
  assert.match(page, /getContractReviews/);
});

test("Producentlisten bruger pagineret RPC uden skjulte rettighedshaver-id'er", async () => {
  const route = await source("app/api/admin/producers/route.ts");
  const migration = await source("supabase/migrations/20260822183000_paginated_admin_producers.sql");
  assert.match(route, /list_admin_producer_summaries/);
  assert.match(migration, /revoke all on function public\.list_admin_producer_summaries/);
  assert.match(migration, /grant execute[\s\S]*service_role/);
  assert.doesNotMatch(migration, /rights_holder_ids/);
  assert.match(migration, /limit least\(greatest\(page_size, 1\), 100\)/);
});

test("medlemsindbakken henter først beskedindhold ved åbning", async () => {
  const action = await source("app/actions/member-inbox.ts");
  const panel = await source("components/portal/member-inbox-panel.tsx");
  const listSection = action.slice(action.indexOf("export async function fetchMemberInbox()"), action.indexOf("export async function fetchMemberInboxThread"));
  assert.doesNotMatch(listSection, /member_messages\([^)]*body/);
  assert.match(panel, /fetchMemberInboxThread/);
});
