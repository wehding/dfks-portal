import Link from "next/link";
import { AlertCircle, Clock3, FileText, ListTodo, MessageSquare, MonitorPlay, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MemberInboxPanel } from "@/components/portal/member-inbox-panel";
import { SalaryStatsCard, type SalaryStatPoint } from "@/components/portal/salary-stats-card";
import { ListReadinessMarker } from "@/components/performance/list-readiness-marker";
import { createServiceClient } from "@/lib/supabase/service";
import { loadMemberWorkReviewTasks } from "@/lib/server/member-work-review-tasks";
import { uniqueMemberWorkReviewCount } from "@/lib/member-work-review";
import { salaryDataToWeekly } from "@/lib/statistics-calculations";
import { EXPERIENCE_GROUPS, experienceGroupAt, type ExperienceGroup } from "@/lib/experience-groups";
import { normalizeStatisticsMinimumGroupSize } from "@/lib/statistics-privacy";
import { memberSalaryBenchmark } from "@/lib/member-statistics";
import { createListLoadTimer } from "@/lib/server/list-load-timing";

type ContractRow = { id: string; working_title: string | null; work_id: string | null; contract_comments: Array<{ author_role: string; member_read_at: string | null }> | null };
type AssignmentRow = { work_id: string | null; works: { id: string; title: string | null; contracts: Array<{ id: string }> | null } | null };
type ShareTaskRow = { id: string; case_id: string; works: { title: string | null } | null };

export async function DashboardTasksSection({ orgId, rightsHolderId, userId }: { orgId: string; rightsHolderId: string; userId: string }) {
  const timer = createListLoadTimer("member-dashboard-tasks");
  const db = createServiceClient();
  const [{ data: contracts }, { data: workRequests }, { data: screeningClaims }, { data: assignments }, { data: shareTasks }, reviewTasks] = await Promise.all([
    db.from("contracts").select("id,working_title,work_id,contract_comments(author_role,member_read_at)").eq("org_id", orgId).eq("rights_holder_id", rightsHolderId),
    db.from("work_change_requests").select("id,status,created_at").eq("org_id", orgId).eq("requested_by_rights_holder_id", rightsHolderId).eq("status", "pending"),
    db.from("screening_claims").select("id,title,status,created_at").eq("org_id", orgId).eq("profile_id", userId).eq("status", "pending"),
    db.from("work_assignments").select("work_id,works(id,title,contracts(id))").eq("org_id", orgId).eq("rights_holder_id", rightsHolderId),
    db.from("work_share_participants").select("id,case_id,works:work_id(title)").eq("org_id", orgId).eq("rights_holder_id", rightsHolderId).eq("relationship_status", "pending"),
    loadMemberWorkReviewTasks(db, { orgId, rightsHolderId }),
  ]);
  timer.mark("queries");
  const contractRows = (contracts ?? []) as ContractRow[];
  const contractedWorkIds = new Set(contractRows.map(contract => contract.work_id).filter(Boolean));
  const worksWithoutContract = Array.from(new Map(((assignments ?? []) as unknown as AssignmentRow[])
    .map(assignment => assignment.works)
    .filter((work): work is NonNullable<AssignmentRow["works"]> => Boolean(work?.id))
    .map(work => [work.id, work] as const)).values())
    .filter(work => (work.contracts ?? []).length === 0 && !contractedWorkIds.has(work.id));
  const contractsWithoutWork = contractRows.filter(contract => !contract.work_id);
  const reviewWorkCount = uniqueMemberWorkReviewCount(reviewTasks);
  const actionItems = [
    ...(worksWithoutContract.length ? [{ key: "works-missing-contract", href: "/portal/mine-kontrakter", icon: Upload, title: `${worksWithoutContract.length} værk${worksWithoutContract.length === 1 ? "" : "er"} mangler kontrakt`, text: "Gå til Mine kontrakter og upload kontrakterne." }] : []),
    ...(contractsWithoutWork.length ? [{ key: "contracts-missing-work", href: "/portal/mine-kontrakter", icon: FileText, title: `${contractsWithoutWork.length} kontrakt${contractsWithoutWork.length === 1 ? "" : "er"} uden værk tilknyttet`, text: "Gå til Mine kontrakter og tilknyt de korrekte værker." }] : []),
    ...(reviewWorkCount ? [{ key: "work-review", href: "/portal/mine-vaerker?review=1", icon: ListTodo, title: `${reviewWorkCount} værk${reviewWorkCount === 1 ? "" : "er"} mangler gennemgang`, text: "Bekræft afsnit og eventuelle medklippere på dine værker." }] : []),
    ...((shareTasks ?? []) as unknown as ShareTaskRow[]).map(task => ({ key: `share-task-${task.id}`, href: `/portal/mine-vaerker?shareTask=${task.case_id}`, icon: ListTodo, title: task.works?.title ?? "Arbejdsandel på et værk", text: "Du er angivet som medklipper. Angiv din egen foreløbige procent, eller oplys at du ikke arbejdede på værket." })),
    ...contractRows.filter(contract => (contract.contract_comments ?? []).some(comment => comment.author_role === "admin" && !comment.member_read_at)).map(contract => ({ key: `message-${contract.id}`, href: `/portal/mine-kontrakter?contract=${contract.id}`, icon: MessageSquare, title: contract.working_title || "Ny kontraktbesked", text: "Læs det nye svar fra DFKS." })),
  ];
  const waitingItems = [
    ...(workRequests ?? []).map(request => ({ key: `request-${request.id}`, href: `/portal/mine-vaerker?request=${request.id}`, icon: Clock3, title: "Værksrettelse", text: "Din rettelse afventer DFKS." })),
    ...(screeningClaims ?? []).map(claim => ({ key: `claim-${claim.id}`, href: `/portal/mine-visninger?claim=${claim.id}`, icon: MonitorPlay, title: claim.title || "Visningsindberetning", text: "Din indberetning afventer DFKS." })),
  ];
  timer.finish({ actionCount: actionItems.length, waitingCount: waitingItems.length });
  return <>
    <div className="grid gap-6 lg:grid-cols-2">
      <DashboardCard title="Kræver handling" count={actionItems.length} icon={AlertCircle} items={actionItems} empty="Du har ingen åbne opgaver." />
      <DashboardCard title="Afventer DFKS" count={waitingItems.length} icon={Clock3} items={waitingItems} empty="Intet afventer behandling." />
    </div>
    <ListReadinessMarker route="member-dashboard" stage="first-row" />
  </>;
}

export async function DashboardSalarySection({ orgId, rightsHolderId, optedOut }: { orgId: string; rightsHolderId: string; optedOut: boolean }) {
  const timer = createListLoadTimer("member-dashboard-statistics");
  const db = createServiceClient();
  const [{ data: orgContracts }, { data: participantRows }, { data: organisation }] = await Promise.all([
    db.from("contracts").select("id,type,status,start_date,contract_date,rights_holder_id,rettighedshavere(professional_start_year)").eq("org_id", orgId),
    db.from("org_affiliations").select("rights_holder_id,statistics_participation").eq("org_id", orgId).eq("statistics_participation", true),
    db.from("organisations").select("statistics_minimum_group_size,statistics_contract_scope").eq("id", orgId).maybeSingle(),
  ]);
  const participatingHolderIds = new Set((participantRows ?? []).map(row => row.rights_holder_id as string));
  const contractIds = (orgContracts ?? []).map(contract => contract.id);
  const { data: validations } = contractIds.length
    ? await db.from("contract_validations").select("contract_id,extracted_data").in("contract_id", contractIds).order("created_at", { ascending: true })
    : { data: [] as Array<{ contract_id: string; extracted_data: Record<string, unknown> | null }> };
  timer.mark("facts");
  const extractedMap = new Map((validations ?? []).map(validation => [validation.contract_id, validation.extracted_data]));
  const salaryRows: Array<{ year: number; weekly: number; mine: boolean; contributes: boolean; holderId: string | null; professionalStartYear: number | null }> = [];
  for (const contract of orgContracts ?? []) {
    const includedStatus = contract.status === "valideret" || (organisation?.statistics_contract_scope === "validated_and_drafts" && contract.status === "kladde");
    if (!includedStatus) continue;
    const extracted = extractedMap.get(contract.id) as Record<string, unknown> | null | undefined;
    if (!extracted?.salary || contract.type === "leverandør") continue;
    const holderRow = Array.isArray(contract.rettighedshavere) ? contract.rettighedshavere[0] : contract.rettighedshavere;
    const holderDetails = holderRow as { professional_start_year?: number | null } | null;
    const contributes = Boolean(contract.rights_holder_id && participatingHolderIds.has(contract.rights_holder_id));
    const mine = contract.rights_holder_id === rightsHolderId;
    if (!contributes && !mine) continue;
    const dateStr = (typeof extracted.startDate === "string" ? extracted.startDate : null) ?? contract.start_date ?? (typeof extracted.contractDate === "string" ? extracted.contractDate : null) ?? contract.contract_date ?? null;
    const year = dateStr ? new Date(dateStr).getFullYear() : Number.NaN;
    const weekly = salaryDataToWeekly(extracted);
    if (Number.isFinite(weekly) && weekly > 0 && Number.isFinite(year)) salaryRows.push({ year, weekly, mine, contributes, holderId: contract.rights_holder_id ?? null, professionalStartYear: holderDetails?.professional_start_year ?? null });
  }
  const avg = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const minimum = normalizeStatisticsMinimumGroupSize(organisation?.statistics_minimum_group_size);
  const benchmark = (rows: typeof salaryRows) => memberSalaryBenchmark(rows, minimum);
  let points: SalaryStatPoint[] = [...new Set(salaryRows.map(row => row.year))].sort((a, b) => a - b).map(year => {
    const rows = salaryRows.filter(row => row.year === year);
    return { year, egen: avg(rows.filter(row => row.mine).map(row => row.weekly)), gennemsnit: benchmark(rows) };
  });
  let benchmarkPointsByExperience: Partial<Record<ExperienceGroup, SalaryStatPoint[]>> = {};
  if (!optedOut) benchmarkPointsByExperience = Object.fromEntries(EXPERIENCE_GROUPS.map(group => [group.value, points.map(point => ({ ...point, gennemsnit: benchmark(salaryRows.filter(row => row.year === point.year && experienceGroupAt(row.professionalStartYear, row.year) === group.value)) }))])) as Partial<Record<ExperienceGroup, SalaryStatPoint[]>>;
  else points = points.map(point => ({ ...point, gennemsnit: null }));
  const benchmarkAvailable = points.some(point => point.gennemsnit != null);
  timer.finish({ contractCount: orgContracts?.length ?? 0, pointCount: points.length });
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
