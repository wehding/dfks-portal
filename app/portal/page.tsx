export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, Clock3, FileText, ListTodo, MessageSquare, MonitorPlay, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortalPageHeader } from "@/components/portal/portal-page-header";
import { MemberInboxPanel } from "@/components/portal/member-inbox-panel";
import { SalaryStatsCard, type SalaryStatPoint } from "@/components/portal/salary-stats-card";
import { salaryDataToWeekly } from "@/lib/statistics-calculations";
import { EXPERIENCE_GROUPS, experienceGroupAt, type ExperienceGroup } from "@/lib/experience-groups";

type ContractRow = { id: string; working_title: string | null; work_id: string | null; contract_comments: Array<{ author_role: string; member_read_at: string | null }> | null };
type InboxThread = { id: string; subject: string; member_messages: Array<{ author_role: string; created_at: string }> | null; member_message_participants: Array<{ user_id: string; last_read_at: string | null }> | null };
type AssignmentRow = { work_id: string | null; works: { id: string; title: string | null; contracts: Array<{ id: string }> | null } | null };
type EpisodeScopeRow = { id: string; season_number: number; works: { title: string | null } | null };

export default async function PortalDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const db = createServiceClient();
  const { data: holder } = await db.from("rettighedshavere").select("id,full_name,opt_out_statistics,org_affiliations(org_id)").eq("user_id", user.id).maybeSingle();
  if (!holder) {
    const { data: staffRole } = await db.from("user_org_roles").select("org_id").eq("user_id", user.id).limit(1).maybeSingle();
    if (staffRole) redirect("/admin");
    redirect("/onboarding");
  }
  const orgId = (Array.isArray(holder.org_affiliations) ? holder.org_affiliations[0] : holder.org_affiliations)?.org_id;
  if (!orgId) {
    const { data: staffRole } = await db.from("user_org_roles").select("org_id").eq("user_id", user.id).limit(1).maybeSingle();
    if (staffRole) redirect("/admin");
    redirect("/onboarding");
  }
  const [{ data: contracts }, { data: workRequests }, { data: screeningClaims }, { data: inboxThreads }, { data: assignments }, { data: episodeScopes }] = await Promise.all([
    db.from("contracts").select("id,working_title,work_id,contract_comments(author_role,member_read_at)").eq("org_id", orgId).eq("rights_holder_id", holder.id),
    db.from("work_change_requests").select("id,status,created_at").eq("org_id", orgId).eq("requested_by_rights_holder_id", holder.id).eq("status", "pending"),
    db.from("screening_claims").select("id,title,status,created_at").eq("org_id", orgId).eq("profile_id", user.id).eq("status", "pending"),
    db.from("member_message_threads").select("id,subject,member_messages(author_role,created_at),member_message_participants(user_id,last_read_at)").eq("org_id", orgId).eq("rights_holder_id", holder.id),
    db.from("work_assignments").select("work_id,works(id,title,contracts(id))").eq("rights_holder_id", holder.id),
    db.from("member_series_episode_scopes").select("id,season_number,works:series_work_id(title)").eq("org_id", orgId).eq("rights_holder_id", holder.id).eq("status", "pending"),
  ]);
  const contractRows = (contracts ?? []) as ContractRow[];
  const unreadThreads = ((inboxThreads ?? []) as InboxThread[]).filter(thread => {
    const lastRead = thread.member_message_participants?.find(participant => participant.user_id === user.id)?.last_read_at ?? "";
    return (thread.member_messages ?? []).some(message => message.author_role === "admin" && message.created_at > lastRead);
  });
  // Værker uden tilknyttet kontrakt: hverken en kontrakt på selve værket
  // eller en af medlemmets kontrakter, der peger på værket.
  const contractedWorkIds = new Set(contractRows.map(contract => contract.work_id).filter(Boolean));
  const worksWithoutContract = Array.from(
    new Map(
      ((assignments ?? []) as unknown as AssignmentRow[])
        .map(assignment => assignment.works)
        .filter((work): work is NonNullable<AssignmentRow["works"]> => Boolean(work?.id))
        .map(work => [work.id, work] as const)
    ).values()
  ).filter(work => (work.contracts ?? []).length === 0 && !contractedWorkIds.has(work.id));
  const contractsWithoutWork = contractRows.filter(contract => !contract.work_id);
  const actionItems = [
    // Samlede opgaver med antal — klik fører hen hvor opgaven løses.
    ...(worksWithoutContract.length ? [{
      key: "works-missing-contract",
      href: "/portal/mine-kontrakter",
      icon: Upload,
      title: `${worksWithoutContract.length} værk${worksWithoutContract.length === 1 ? "" : "er"} mangler kontrakt`,
      text: "Gå til Mine kontrakter og upload kontrakterne.",
    }] : []),
    ...(contractsWithoutWork.length ? [{
      key: "contracts-missing-work",
      href: "/portal/mine-kontrakter",
      icon: FileText,
      title: `${contractsWithoutWork.length} kontrakt${contractsWithoutWork.length === 1 ? "" : "er"} uden værk tilknyttet`,
      text: "Gå til Mine kontrakter og tilknyt de korrekte værker.",
    }] : []),
    ...((episodeScopes ?? []) as unknown as EpisodeScopeRow[]).map(scope => ({
      key: `episode-scope-${scope.id}`,
      href: `/portal/mine-vaerker?episodeScope=${scope.id}`,
      icon: ListTodo,
      title: `${scope.works?.title ?? "Serie"} · sæson ${scope.season_number}`,
      text: "Vælg de afsnit, du arbejdede på, eller bekræft hele sæsonen.",
    })),
    ...contractRows.filter(contract => (contract.contract_comments ?? []).some(comment => comment.author_role === "admin" && !comment.member_read_at)).map(contract => ({ key: `message-${contract.id}`, href: `/portal/mine-kontrakter?contract=${contract.id}`, icon: MessageSquare, title: contract.working_title || "Ny kontraktbesked", text: "Læs det nye svar fra DFKS." })),
    ...unreadThreads.map(thread => ({ key: `inbox-${thread.id}`, href: `/portal?thread=${thread.id}`, icon: MessageSquare, title: thread.subject, text: "Læs den nye besked fra DFKS." })),
  ];
  // Lønstatistik: egen grundløn pr. uge pr. år vs. gennemsnittet for bidragende medlemmer.
  const optedOut = Boolean((holder as { opt_out_statistics?: boolean | null }).opt_out_statistics);
  let salaryPoints: SalaryStatPoint[] = [];
  let benchmarkAvailable = false;
  let benchmarkPointsByExperience: Partial<Record<ExperienceGroup, SalaryStatPoint[]>> = {};
  let ownStatisticsContracts: Array<{ id: string; title: string; year: number; weekly: number }> = [];
  {
    const { data: orgContracts } = await db.from("contracts")
      .select("id,type,working_title,start_date,contract_date,rights_holder_id,rettighedshavere(opt_out_statistics,professional_start_year)")
      .eq("org_id", orgId);
    const contractIds = (orgContracts ?? []).map(contract => contract.id);
    const { data: validations } = contractIds.length
      ? await db.from("contract_validations").select("contract_id,extracted_data").in("contract_id", contractIds)
      : { data: [] as Array<{ contract_id: string; extracted_data: Record<string, unknown> | null }> };
    const extractedMap = new Map((validations ?? []).map(validation => [validation.contract_id, validation.extracted_data]));
    const salaryRows: Array<{ year: number; weekly: number; mine: boolean; contributes: boolean; holderId: string | null; professionalStartYear: number | null }> = [];
    for (const contract of orgContracts ?? []) {
      const extracted = extractedMap.get(contract.id) as Record<string, unknown> | null | undefined;
      if (!extracted?.salary || contract.type === "leverandør") continue;
      const holderRow = Array.isArray(contract.rettighedshavere) ? contract.rettighedshavere[0] : contract.rettighedshavere;
      const holderDetails = holderRow as { opt_out_statistics?: boolean | null; professional_start_year?: number | null } | null;
      const contributes = !holderDetails?.opt_out_statistics;
      const isMine = contract.rights_holder_id === holder.id;
      if (!contributes && !isMine) continue;
      const dateStr = (typeof extracted.startDate === "string" ? extracted.startDate : null) ?? contract.start_date ?? (typeof extracted.contractDate === "string" ? extracted.contractDate : null) ?? contract.contract_date ?? null;
      const year = dateStr ? new Date(dateStr).getFullYear() : Number.NaN;
      const weekly = salaryDataToWeekly(extracted);
      if (!Number.isFinite(weekly) || weekly <= 0 || !Number.isFinite(year)) continue;
      salaryRows.push({ year, weekly, mine: isMine, contributes, holderId: contract.rights_holder_id ?? null, professionalStartYear: holderDetails?.professional_start_year ?? null });
      if (isMine) ownStatisticsContracts.push({ id: contract.id, title: contract.working_title || "Kontrakt", year, weekly: Math.round(weekly) });
    }
    const MIN_BENCHMARK_CONTRACTS = 10;
    const avg = (list: number[]) => (list.length ? Math.round(list.reduce((sum, value) => sum + value, 0) / list.length) : null);
    // Gennemsnit pr. MEDLEM (ikke pr. kontrakt) og kun for år med nok distinkte bidragydere.
    // Det sikrer at et enkelt medlems ugeløn aldrig kan aflæses som "gennemsnit" et år med få bidragydere.
    const yearlyAverage = (rows: typeof salaryRows) => {
      const byHolder = new Map<string, number[]>();
      for (const row of rows) {
        if (!row.contributes || !row.holderId) continue;
        const list = byHolder.get(row.holderId) ?? [];
        list.push(row.weekly);
        byHolder.set(row.holderId, list);
      }
      const contributingRows = rows.filter(row => row.contributes && row.holderId);
      const largestContribution = Math.max(0, ...Array.from(byHolder.values()).map(values => values.length));
      if (contributingRows.length < MIN_BENCHMARK_CONTRACTS || byHolder.size < 3 || largestContribution / contributingRows.length > 0.4) return null;
      const perHolderMeans = Array.from(byHolder.values()).map(list => list.reduce((sum, value) => sum + value, 0) / list.length);
      return Math.round(perHolderMeans.reduce((sum, value) => sum + value, 0) / perHolderMeans.length);
    };
    salaryPoints = [...new Set(salaryRows.map(row => row.year))].sort((a, b) => a - b).map(year => {
      const yearRows = salaryRows.filter(row => row.year === year);
      return {
        year,
        egen: avg(yearRows.filter(row => row.mine).map(row => row.weekly)),
        gennemsnit: yearlyAverage(yearRows),
      };
    });
    if (!optedOut) {
      benchmarkPointsByExperience = Object.fromEntries(EXPERIENCE_GROUPS.map(group => [
        group.value,
        salaryPoints.map(point => ({
          ...point,
          gennemsnit: yearlyAverage(salaryRows.filter(row => row.year === point.year && experienceGroupAt(row.professionalStartYear, row.year) === group.value)),
        })),
      ])) as Partial<Record<ExperienceGroup, SalaryStatPoint[]>>;
    } else {
      salaryPoints = salaryPoints.map(point => ({ ...point, gennemsnit: null }));
    }
    benchmarkAvailable = salaryPoints.some(point => point.gennemsnit != null);
    ownStatisticsContracts = ownStatisticsContracts.sort((left, right) => right.year - left.year || left.title.localeCompare(right.title, "da"));
  }
  const waitingItems = [
    ...(workRequests ?? []).map(request => ({ key: `request-${request.id}`, href: `/portal/mine-vaerker?request=${request.id}`, icon: Clock3, title: "Værksrettelse", text: "Din rettelse afventer DFKS." })),
    ...(screeningClaims ?? []).map(claim => ({ key: `claim-${claim.id}`, href: `/portal/mine-visninger?claim=${claim.id}`, icon: MonitorPlay, title: claim.title || "Visningsindberetning", text: "Din indberetning afventer DFKS." })),
  ];
  return <div className="space-y-6">
    <PortalPageHeader title="Overblik" subtitle={`Velkommen, ${(holder.full_name ?? "").trim().split(/\s+/)[0] || holder.full_name}. Her er det, der kræver din opmærksomhed.`} />
    <div className="grid gap-6 lg:grid-cols-2">
      <DashboardCard title="Kræver handling" count={actionItems.length} icon={AlertCircle} items={actionItems} empty="Du har ingen åbne opgaver." />
      <DashboardCard title="Afventer DFKS" count={waitingItems.length} icon={Clock3} items={waitingItems} empty="Intet afventer behandling." />
    </div>
    <SalaryStatsCard points={salaryPoints} benchmarkPointsByExperience={benchmarkPointsByExperience} optedOut={optedOut} benchmarkAvailable={benchmarkAvailable} contracts={ownStatisticsContracts} />
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><MessageSquare className="h-5 w-5 text-amber-500" />Beskeder fra DFKS</h2>
      <MemberInboxPanel />
    </section>
  </div>;
}

function DashboardCard({ title, count, icon: Icon, items, empty }: { title: string; count: number; icon: typeof AlertCircle; items: Array<{ key: string; href: string; icon: typeof AlertCircle; title: string; text: string }>; empty: string }) {
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Icon className="h-5 w-5 text-amber-500" />{title}<span className="ml-auto text-sm text-muted-foreground">{count}</span></CardTitle></CardHeader><CardContent className="space-y-2">{items.length ? items.map(item => <Link key={item.key} href={item.href} className="flex gap-3 rounded-md border p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><item.icon className="mt-0.5 h-4 w-4" /><span><span className="block font-medium">{item.title}</span><span className="text-sm text-muted-foreground">{item.text}</span></span></Link>) : <p className="text-sm text-muted-foreground">{empty}</p>}</CardContent></Card>;
}
