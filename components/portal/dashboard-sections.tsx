import Link from "next/link";
import { AlertCircle, CheckCircle2, Circle, Clock3, FileSignature, FileText, ListTodo, MessageSquare, MonitorPlay, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MemberInboxPanel } from "@/components/portal/member-inbox-panel";
import { SalaryStatsCard, type SalaryStatPoint } from "@/components/portal/salary-stats-card";
import { ListReadinessMarker } from "@/components/performance/list-readiness-marker";
import { createServiceClient } from "@/lib/supabase/service";
import { salaryDataToWeekly } from "@/lib/statistics-calculations";
import { EXPERIENCE_GROUPS, experienceGroupAt, type ExperienceGroup } from "@/lib/experience-groups";
import { normalizeStatisticsMinimumGroupSize } from "@/lib/statistics-privacy";
import { medianWeeklySalary, memberSalaryBenchmark, salaryProductionGroup, type SalaryProductionGroup } from "@/lib/member-statistics";
import { createListLoadTimer } from "@/lib/server/list-load-timing";
import type { LegacyDeclarationTask } from "@/lib/work-documentation";

type DashboardTaskOverview = {
  works_missing_contract_count: number | string;
  contracts_missing_work_count: number | string;
  review_work_count: number | string;
  share_task_count: number | string;
  unread_contract_count: number | string;
  pending_work_request_count: number | string;
  pending_screening_count: number | string;
  share_tasks: Array<{ id: string; caseId: string; title: string | null }> | null;
  unread_contracts: Array<{ contractId: string; title: string | null }> | null;
  pending_work_requests: Array<{ id: string }> | null;
  pending_screenings: Array<{ id: string; title: string | null }> | null;
};

export async function DashboardTasksSection({ orgId, rightsHolderId, userId }: { orgId: string; rightsHolderId: string; userId: string }) {
  const timer = createListLoadTimer("member-dashboard-tasks");
  const db = createServiceClient();
  const [taskResult, holderResult, contractCountResult, validatedCountResult, declarationResult, contractRequiredResult] = await Promise.all([
    db.rpc("get_member_dashboard_task_overview", { p_org_id: orgId, p_rights_holder_id: rightsHolderId, p_user_id: userId, p_preview_limit: 5 }),
    db.from("rettighedshavere").select("full_name,email,phone,address,dfi_person_id,tmdb_person_id").eq("id", rightsHolderId).maybeSingle(),
    db.from("contracts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("rights_holder_id", rightsHolderId).is("superseded_by_contract_id", null),
    db.from("contracts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("rights_holder_id", rightsHolderId).eq("status", "valideret").is("superseded_by_contract_id", null),
    db.rpc("list_member_legacy_declaration_tasks", { p_org_id: orgId, p_rights_holder_id: rightsHolderId }),
    db.rpc("count_member_contract_required_works", { p_org_id: orgId, p_rights_holder_id: rightsHolderId }),
  ]);
  const { data, error } = taskResult;
  if (error || holderResult.error || contractCountResult.error || validatedCountResult.error || declarationResult.error || contractRequiredResult.error) return <DashboardSectionError title="Dine opgaver kunne ikke hentes" stage="first-row" />;
  const overview = ((Array.isArray(data) ? data[0] : data) ?? {}) as DashboardTaskOverview;
  timer.mark("queries");
  const declarationTaskCount = new Set(((declarationResult.data ?? []) as Array<{ root_work_id: LegacyDeclarationTask["rootWorkId"] }>).map(task => task.root_work_id)).size;
  const worksWithoutContractCount = Number(contractRequiredResult.data ?? 0);
  const contractsWithoutWorkCount = Number(overview.contracts_missing_work_count ?? 0);
  const reviewWorkCount = Number(overview.review_work_count ?? 0);
  const shareTaskCount = Number(overview.share_task_count ?? 0);
  const unreadContractCount = Number(overview.unread_contract_count ?? 0);
  const actionItems = [
    ...(declarationTaskCount ? [{ key: "legacy-declaration", href: "/portal/mine-vaerker?declaration=1", icon: FileSignature, title: `${declarationTaskCount} ældre ${declarationTaskCount === 1 ? "værk mangler" : "værker mangler"} tro-og-loveerklæring`, text: "Bekræft samlet de titler, du har arbejdet på." }] : []),
    ...(worksWithoutContractCount ? [{ key: "works-missing-contract", href: "/portal/mine-kontrakter", icon: Upload, title: `${worksWithoutContractCount} værk${worksWithoutContractCount === 1 ? "" : "er"} mangler kontrakt`, text: "Gå til Mine kontrakter og upload kontrakterne." }] : []),
    ...(contractsWithoutWorkCount ? [{ key: "contracts-missing-work", href: "/portal/mine-kontrakter", icon: FileText, title: `${contractsWithoutWorkCount} kontrakt${contractsWithoutWorkCount === 1 ? "" : "er"} uden værk tilknyttet`, text: "Gå til Mine kontrakter og tilknyt de korrekte værker." }] : []),
    ...(reviewWorkCount ? [{ key: "work-review", href: "/portal/mine-vaerker?review=1", icon: ListTodo, title: `${reviewWorkCount} værk${reviewWorkCount === 1 ? "" : "er"} mangler gennemgang`, text: "Bekræft afsnit og eventuelle medklippere på dine værker." }] : []),
    ...((overview.share_tasks ?? []).map(task => ({ key: `share-task-${task.id}`, href: `/portal/mine-vaerker?shareTask=${task.caseId}`, icon: ListTodo, title: task.title ?? "Arbejdsandel på et værk", text: "Du er angivet som medklipper. Angiv din egen foreløbige procent, eller oplys at du ikke arbejdede på værket." }))),
    ...((overview.unread_contracts ?? []).map(contract => ({ key: `message-${contract.contractId}`, href: `/portal/mine-kontrakter?contract=${contract.contractId}`, icon: MessageSquare, title: contract.title || "Ny kontraktbesked", text: "Læs det nye svar fra DFKS." }))),
  ];
  const waitingItems = [
    ...(overview.pending_work_requests ?? []).map(request => ({ key: `request-${request.id}`, href: `/portal/mine-vaerker?request=${request.id}`, icon: Clock3, title: "Værksrettelse", text: "Din rettelse afventer DFKS." })),
    ...(overview.pending_screenings ?? []).map(claim => ({ key: `claim-${claim.id}`, href: `/portal/mine-visninger?claim=${claim.id}`, icon: MonitorPlay, title: claim.title || "Visningsindberetning", text: "Din indberetning afventer DFKS." })),
  ];
  const actionCount = (declarationTaskCount ? 1 : 0) + (worksWithoutContractCount ? 1 : 0) + (contractsWithoutWorkCount ? 1 : 0)
    + (reviewWorkCount ? 1 : 0) + shareTaskCount + unreadContractCount;
  const waitingCount = Number(overview.pending_work_request_count ?? 0) + Number(overview.pending_screening_count ?? 0);
  const holder = holderResult.data;
  const checklist = [
    { label: "Tjek profil og DFI", href: "/portal/min-profil", complete: Boolean(holder?.full_name?.trim() && holder.email?.trim() && holder.phone?.trim() && holder.address?.trim() && (holder.dfi_person_id || holder.tmdb_person_id)) },
    { label: "Bekræft værker", href: "/portal/mine-vaerker?review=1", complete: reviewWorkCount === 0 },
    { label: "Upload kontrakter", href: "/portal/mine-kontrakter?upload=true", complete: Number(contractCountResult.count ?? 0) > 0 },
    { label: "Tjek rettigheder", href: "/portal/mine-kontrakter", complete: Number(validatedCountResult.count ?? 0) > 0 },
  ];
  const showChecklist = checklist.some(item => !item.complete);
  timer.finish({ actionCount, waitingCount });
  return <>
    {showChecklist && <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
      <CardHeader><CardTitle className="flex items-center gap-2"><ListTodo className="h-5 w-5" />Kom godt i gang</CardTitle></CardHeader>
      <CardContent><ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{checklist.map((item, index) => <li key={item.label}>
        <Link href={item.href} className="flex h-full items-start gap-2 rounded-md border bg-background p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {item.complete ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
          <span><span className="block text-xs text-muted-foreground">Trin {index + 1}</span><span className="font-medium">{item.label}</span></span>
        </Link>
      </li>)}</ol></CardContent>
    </Card>}
    <div className="grid gap-6 lg:grid-cols-2">
      <DashboardCard title="Kræver handling" count={actionCount} icon={AlertCircle} items={actionItems} empty="Du har ingen åbne opgaver." />
      <DashboardCard title="Afventer DFKS" count={waitingCount} icon={Clock3} items={waitingItems} empty="Intet afventer behandling." />
    </div>
    <ListReadinessMarker route="member-dashboard" stage="first-row" />
  </>;
}

export async function DashboardSalarySection({ orgId, rightsHolderId, optedOut }: { orgId: string; rightsHolderId: string; optedOut: boolean }) {
  const timer = createListLoadTimer("member-dashboard-statistics");
  const db = createServiceClient();
  const { data: organisation } = await db.from("organisations")
    .select("statistics_minimum_group_size,statistics_contract_scope")
    .eq("id", orgId)
    .maybeSingle();
  const includeDrafts = organisation?.statistics_contract_scope === "validated_and_drafts";
  const [{ data: facts, error: factsError }, ownContractsResult] = await Promise.all([
    db.rpc("get_member_salary_facts", { p_org_id: orgId, p_include_drafts: includeDrafts }),
    optedOut
      ? db.from("contracts").select("id,type,status,start_date,contract_date,rights_holder_id,rettighedshavere(professional_start_year)").eq("org_id", orgId).eq("rights_holder_id", rightsHolderId)
      : Promise.resolve({ data: [] as Array<{ id: string; type: string; status: string; start_date: string | null; contract_date: string | null; rights_holder_id: string | null; rettighedshavere: { professional_start_year: number | null } | Array<{ professional_start_year: number | null }> | null }> }),
  ]);
  if (factsError || "error" in ownContractsResult && ownContractsResult.error) {
    return <DashboardSectionError title="Lønstatistikken kunne ikke hentes" stage="secondary" />;
  }
  const ownContracts = ownContractsResult.data ?? [];
  const ownIds = ownContracts.map(contract => contract.id);
  const { data: ownValidations } = ownIds.length
    ? await db.from("contract_validations").select("contract_id,extracted_data").in("contract_id", ownIds).order("created_at", { ascending: true })
    : { data: [] as Array<{ contract_id: string; extracted_data: Record<string, unknown> | null }> };
  timer.mark("facts");
  const salaryRows: Array<{ year: number; weekly: number; mine: boolean; contributes: boolean; holderId: string | null; professionalStartYear: number | null; productionGroup: SalaryProductionGroup | null }> = [];
  for (const fact of facts ?? []) {
    const weekly = Number(fact.weekly_salary);
    const year = Number(fact.period_year);
    if (Number.isFinite(weekly) && weekly > 0 && Number.isFinite(year)) salaryRows.push({
      year,
      weekly,
      mine: fact.rights_holder_id === rightsHolderId,
      contributes: true,
      holderId: fact.rights_holder_id,
      professionalStartYear: fact.professional_start_year == null ? null : Number(fact.professional_start_year),
      productionGroup: salaryProductionGroup(fact.production_type),
    });
  }
  if (optedOut) {
    const extractedMap = new Map((ownValidations ?? []).map(validation => [validation.contract_id, validation.extracted_data]));
    for (const contract of ownContracts) {
      const includedStatus = contract.status === "valideret" || (includeDrafts && contract.status === "kladde");
      const extracted = extractedMap.get(contract.id) as Record<string, unknown> | null | undefined;
      if (!includedStatus || !extracted?.salary || contract.type === "leverandør") continue;
      const dateValue = (typeof extracted.startDate === "string" ? extracted.startDate : null) ?? contract.start_date ?? (typeof extracted.contractDate === "string" ? extracted.contractDate : null) ?? contract.contract_date;
      const year = dateValue ? new Date(dateValue).getFullYear() : Number.NaN;
      const weekly = salaryDataToWeekly(extracted);
      const holderRow = Array.isArray(contract.rettighedshavere) ? contract.rettighedshavere[0] : contract.rettighedshavere;
      if (Number.isFinite(weekly) && weekly > 0 && Number.isFinite(year)) salaryRows.push({
        year,
        weekly,
        mine: true,
        contributes: false,
        holderId: rightsHolderId,
        professionalStartYear: holderRow?.professional_start_year ?? null,
        productionGroup: salaryProductionGroup(extracted.productionType ?? extracted.category),
      });
    }
  }
  const minimum = normalizeStatisticsMinimumGroupSize(organisation?.statistics_minimum_group_size);
  const benchmark = (rows: typeof salaryRows) => memberSalaryBenchmark(rows, minimum);
  let points: SalaryStatPoint[] = [...new Set(salaryRows.map(row => row.year))].sort((a, b) => a - b).map(year => {
    const rows = salaryRows.filter(row => row.year === year);
    return {
      year,
      ownFiction: medianWeeklySalary(rows.filter(row => row.mine && row.productionGroup === "fiction").map(row => row.weekly)),
      ownDocumentary: medianWeeklySalary(rows.filter(row => row.mine && row.productionGroup === "documentary").map(row => row.weekly)),
      benchmarkFiction: benchmark(rows.filter(row => row.productionGroup === "fiction")),
      benchmarkDocumentary: benchmark(rows.filter(row => row.productionGroup === "documentary")),
    };
  });
  let benchmarkPointsByExperience: Partial<Record<ExperienceGroup, SalaryStatPoint[]>> = {};
  if (!optedOut) benchmarkPointsByExperience = Object.fromEntries(EXPERIENCE_GROUPS.map(group => [group.value, points.map(point => {
    const rows = salaryRows.filter(row => row.year === point.year && experienceGroupAt(row.professionalStartYear, row.year) === group.value);
    return {
      ...point,
      benchmarkFiction: benchmark(rows.filter(row => row.productionGroup === "fiction")),
      benchmarkDocumentary: benchmark(rows.filter(row => row.productionGroup === "documentary")),
    };
  })])) as Partial<Record<ExperienceGroup, SalaryStatPoint[]>>;
  else points = points.map(point => ({ ...point, benchmarkFiction: null, benchmarkDocumentary: null }));
  const benchmarkAvailable = points.some(point => point.benchmarkFiction != null || point.benchmarkDocumentary != null);
  timer.finish({ factCount: facts?.length ?? 0, pointCount: points.length });
  return <><SalaryStatsCard points={points} benchmarkPointsByExperience={benchmarkPointsByExperience} optedOut={optedOut} benchmarkAvailable={benchmarkAvailable} /><ListReadinessMarker route="member-dashboard" stage="secondary" /></>;
}

export async function DashboardInboxSection() {
  return <section className="space-y-3">
    <h2 className="flex items-center gap-2 text-lg font-semibold"><MessageSquare className="h-5 w-5 text-amber-500" />Beskeder fra DFKS</h2>
    <MemberInboxPanel />
    <ListReadinessMarker route="member-dashboard" stage="complete" />
  </section>;
}

function DashboardCard({ title, count, icon: Icon, items, empty }: { title: string; count: number; icon: typeof AlertCircle; items: Array<{ key: string; href: string; icon: typeof AlertCircle; title: string; text: string }>; empty: string }) {
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Icon className="h-5 w-5 text-amber-500" />{title}<span className="ml-auto text-sm text-muted-foreground">{count}</span></CardTitle></CardHeader><CardContent className="space-y-2">{items.length ? items.map(item => <Link key={item.key} href={item.href} className="flex gap-3 rounded-md border p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><item.icon className="mt-0.5 h-4 w-4" /><span><span className="block font-medium">{item.title}</span><span className="text-sm text-muted-foreground">{item.text}</span></span></Link>) : <p className="text-sm text-muted-foreground">{empty}</p>}</CardContent></Card>;
}

function DashboardSectionError({ title, stage }: { title: string; stage: "first-row" | "secondary" | "complete" }) {
  return <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
    <p className="font-medium">{title}</p>
    <p className="mt-1 text-xs">Prøv at genindlæse siden. De øvrige dele af overblikket virker fortsat.</p>
    <ListReadinessMarker route="member-dashboard" stage={stage} />
  </div>;
}
