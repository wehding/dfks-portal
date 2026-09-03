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
  const logStatement = timer.match(/console\.info\("\[list-performance\]"[^;]+;/)?.[0] ?? "";
  assert.ok(logStatement);
  assert.doesNotMatch(logStatement, /\b(?:contract|email|name|title)\b/i);
});

test("Mine værker starter data på serveren og parallelt", async () => {
  const page = await source("app/portal/mine-vaerker/page.tsx");
  const action = await source("app/actions/member-works.ts");
  const loader = await source("lib/server/member-work-overview.ts");
  const client = await source("app/portal/mine-vaerker/MineVaerkerClient.tsx");
  assert.doesNotMatch(page, /^\s*["']use client["']/);
  assert.match(page, /Promise\.all\(\[/);
  assert.match(page, /loadMemberWorkOverview/);
  assert.match(page, /getRequestAppAccessContext/);
  assert.doesNotMatch(page, /\.from\("contracts"\)/);
  assert.match(loader, /list_member_work_overview_page/);
  assert.doesNotMatch(loader, /\.from\(/);
  assert.match(action, /return loadMemberWorkOverview/);
  assert.doesNotMatch(action.slice(action.indexOf("export async function fetchMemberWorkOverview"), action.indexOf("export async function fetchMemberSeasonEpisodes")), /list_member_work_page|\.from\(/);
  assert.match(client, /fetchMemberContractsForWorks/);
  assert.match(client, /requestIdleCallback/);
  assert.match(client, /refreshReviews = false/);
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
  const overviewMigration = await source("supabase/migrations/20260902211659_member_dashboard_and_work_overview.sql");
  const migration = await source("supabase/migrations/20260831143000_member_dashboard_performance.sql");
  const supplementFix = await source("supabase/migrations/20260831152652_fix_member_salary_supplements.sql");
  assert.match(page, /<Suspense[\s\S]*DashboardTasksSection/);
  assert.match(page, /getRequestAppAccessContext/);
  assert.match(page, /DashboardSalarySection/);
  assert.match(page, /DashboardInboxSection/);
  assert.match(sections, /member-dashboard-tasks/);
  assert.match(sections, /member-dashboard-statistics/);
  assert.match(sections, /get_member_dashboard_overview_v2/);
  assert.doesNotMatch(sections, /Kom godt i gang|Tjek profil og DFI|Trin \{index/);
  assert.match(sections, /href: "\/portal\/okonomi"/);
  assert.match(overviewMigration, /count_member_contract_required_works/);
  assert.match(overviewMigration, /economy_overview_viewed_at/);
  assert.match(sections, /get_member_salary_facts/);
  assert.match(migration, /create or replace function public\.get_member_dashboard_task_overview/);
  assert.match(migration, /create or replace function public\.get_member_salary_facts/);
  assert.match(supplementFix, /otherSupplements/);
  assert.match(supplementFix, /structured_post_production > 0/);
  assert.match(supplementFix, /else raw\.legacy_post_production/);
  assert.doesNotMatch(sections, /db\.from\("contracts"\)[\s\S]{0,180}\.eq\("org_id", orgId\)(?![\s\S]{0,120}rights_holder_id)/);
  assert.doesNotMatch(page, /contract_validations/);
});

test("performance-markøren for Mine værker følger det faktiske listområde", async () => {
  const client = await source("app/portal/mine-vaerker/MineVaerkerClient.tsx");
  const firstRowMarker = client.indexOf('<ListReadinessMarker route="member-works" stage="first-row"');
  const listRows = client.indexOf("visibleAssignments.map");
  assert.ok(firstRowMarker > 0);
  assert.ok(listRows > 0);
  assert.ok(Math.abs(firstRowMarker - listRows) < 1_000);
});

test("Kontraktgennemgang bruger smal side og målrettede medarbejderopslag", async () => {
  const route = await source("app/api/admin/contracts/route.ts");
  const loader = await source("lib/server/contract-review-list.ts");
  const page = await source("app/admin/kontraktgennemgang/page.tsx");
  const client = await source("app/admin/kontraktgennemgang/review-page-client.tsx");
  const queue = await source("app/admin/kontraktgennemgang/review-queue.tsx");
  assert.doesNotMatch(route, /select\("\*"/);
  assert.doesNotMatch(route, /listUsers/);
  assert.match(loader, /getAuthUserLabels/);
  assert.match(loader, /get_contract_review_job_statuses/);
  assert.doesNotMatch(page, /NextRequest|api\/admin\/contracts\/route/);
  assert.match(queue, /pageSize/);
  assert.match(queue, /filter: `org_id=eq\.\$\{orgId\}`/);
  assert.match(queue, /scheduleRefresh/);
  assert.match(client, /dynamic\([\s\S]*manual-contract-review/);
  assert.match(page, /loadContractReviewList/);
  assert.match(queue, /api\/admin\/contracts\/status/);
});

test("Producentlisten bruger pagineret RPC uden skjulte rettighedshaver-id'er", async () => {
  const route = await source("app/api/admin/producers/route.ts");
  const loader = await source("lib/server/admin-producer-list.ts");
  const page = await source("app/admin/producenter/page.tsx");
  const client = await source("app/admin/producenter/producer-list-client.tsx");
  const migration = await source("supabase/migrations/20260823020711_fix_producer_summary_filters_and_counts.sql");
  assert.match(route, /loadAdminProducerList/);
  assert.match(loader, /list_admin_producer_summaries/);
  assert.match(loader, /association_filter:[^\n]*associationGroup/);
  assert.match(loader, /producer_type_filter:[^\n]*producerType/);
  assert.doesNotMatch(page, /NextRequest|api\/admin\/producers\/route/);
  assert.match(client, /params\.set\("associationGroup", associationGroup\)/);
  assert.match(client, /params\.set\("producerType", producerType\)/);
  assert.match(migration, /revoke all on function public\.list_admin_producer_summaries/);
  assert.match(migration, /grant execute[\s\S]*service_role/);
  assert.doesNotMatch(migration, /rights_holder_ids/);
  assert.match(migration, /limit least\(greatest\(page_size, 1\), 100\)/);
  assert.match(migration, /contract_aggregates/);
  assert.match(migration, /work_aggregates/);
  assert.match(migration, /'summary'/);
});

test("medlemsindbakken henter først beskedindhold ved åbning", async () => {
  const action = await source("app/actions/member-inbox.ts");
  const panel = await source("components/portal/member-inbox-panel.tsx");
  const listSection = action.slice(action.indexOf("export async function fetchMemberInbox()"), action.indexOf("export async function fetchMemberInboxThread"));
  assert.doesNotMatch(listSection, /member_messages\([^)]*body/);
  assert.match(panel, /fetchMemberInboxThread/);
});
