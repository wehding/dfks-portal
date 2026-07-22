export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, Clock3, FileText, MessageSquare, MonitorPlay, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { MemberInboxPanel } from "@/components/portal/member-inbox-panel";
import { SalaryStatsCard, type SalaryStatPoint } from "@/components/portal/salary-stats-card";

type ContractRow = { id: string; working_title: string | null; work_id: string | null; contract_comments: Array<{ author_role: string; member_read_at: string | null }> | null };
type InboxThread = { id: string; subject: string; member_messages: Array<{ author_role: string; created_at: string }> | null; member_message_participants: Array<{ user_id: string; last_read_at: string | null }> | null };
type AssignmentRow = { work_id: string | null; works: { id: string; title: string | null; contracts: Array<{ id: string }> | null } | null };

export default async function PortalDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const db = createServiceClient();
  const { data: holder } = await db.from("rettighedshavere").select("id,full_name,opt_out_statistics,org_affiliations(org_id)").eq("user_id", user.id).maybeSingle();
  if (!holder) redirect("/onboarding");
  const orgId = (Array.isArray(holder.org_affiliations) ? holder.org_affiliations[0] : holder.org_affiliations)?.org_id;
  if (!orgId) redirect("/onboarding");
  const [{ data: contracts }, { data: workRequests }, { data: screeningClaims }, { data: inboxThreads }, { data: assignments }] = await Promise.all([
    db.from("contracts").select("id,working_title,work_id,contract_comments(author_role,member_read_at)").eq("org_id", orgId).eq("rights_holder_id", holder.id),
    db.from("work_change_requests").select("id,status,created_at").eq("org_id", orgId).eq("requested_by_rights_holder_id", holder.id).eq("status", "pending"),
    db.from("screening_claims").select("id,title,status,created_at").eq("org_id", orgId).eq("profile_id", user.id).eq("status", "pending"),
    db.from("member_message_threads").select("id,subject,member_messages(author_role,created_at),member_message_participants(user_id,last_read_at)").eq("org_id", orgId).eq("rights_holder_id", holder.id),
    db.from("work_assignments").select("work_id,works(id,title,contracts(id))").eq("rights_holder_id", holder.id),
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
    ...contractRows.filter(contract => (contract.contract_comments ?? []).some(comment => comment.author_role === "admin" && !comment.member_read_at)).map(contract => ({ key: `message-${contract.id}`, href: `/portal/mine-kontrakter?contract=${contract.id}`, icon: MessageSquare, title: contract.working_title || "Ny kontraktbesked", text: "Læs det nye svar fra DFKS." })),
    ...unreadThreads.map(thread => ({ key: `inbox-${thread.id}`, href: `/portal?thread=${thread.id}`, icon: MessageSquare, title: thread.subject, text: "Læs den nye besked fra DFKS." })),
  ];
  // Lønstatistik: egen grundløn pr. uge pr. år vs. gennemsnittet for bidragende medlemmer.
  const optedOut = Boolean((holder as { opt_out_statistics?: boolean | null }).opt_out_statistics);
  let salaryPoints: SalaryStatPoint[] = [];
  let membersWithContracts = 0;
  if (!optedOut) {
    const { data: orgContracts } = await db.from("contracts")
      .select("id,type,start_date,contract_date,rights_holder_id,rettighedshavere(opt_out_statistics)")
      .eq("org_id", orgId);
    const contractIds = (orgContracts ?? []).map(contract => contract.id);
    const { data: validations } = contractIds.length
      ? await db.from("contract_validations").select("contract_id,extracted_data").in("contract_id", contractIds)
      : { data: [] as Array<{ contract_id: string; extracted_data: Record<string, unknown> | null }> };
    const extractedMap = new Map((validations ?? []).map(validation => [validation.contract_id, validation.extracted_data]));
    const salaryRows: Array<{ year: number; weekly: number; mine: boolean; holderId: string | null }> = [];
    for (const contract of orgContracts ?? []) {
      const extracted = extractedMap.get(contract.id) as { salary?: number; salaryUnit?: string; startDate?: string; contractDate?: string } | null | undefined;
      if (!extracted?.salary || contract.type === "leverandør") continue;
      const holderRow = Array.isArray(contract.rettighedshavere) ? contract.rettighedshavere[0] : contract.rettighedshavere;
      const contributes = !(holderRow as { opt_out_statistics?: boolean | null } | null)?.opt_out_statistics;
      const isMine = contract.rights_holder_id === holder.id;
      if (!contributes && !isMine) continue;
      const dateStr = extracted.startDate ?? contract.start_date ?? extracted.contractDate ?? contract.contract_date ?? null;
      const year = dateStr ? new Date(dateStr).getFullYear() : new Date().getFullYear();
      const salary = Number(extracted.salary);
      const unit = extracted.salaryUnit ?? "weekly";
      // Grundløn normaliseret til ugeløn.
      const weekly = unit === "daily" ? salary * 5 : unit === "monthly" ? Math.round(salary * 12 / 52) : salary;
      if (!Number.isFinite(weekly) || weekly <= 0 || !Number.isFinite(year)) continue;
      salaryRows.push({ year, weekly, mine: isMine, holderId: contract.rights_holder_id ?? null });
    }
    membersWithContracts = new Set(salaryRows.map(row => row.holderId).filter(Boolean)).size;
    const avg = (list: number[]) => (list.length ? Math.round(list.reduce((sum, value) => sum + value, 0) / list.length) : null);
    salaryPoints = [...new Set(salaryRows.map(row => row.year))].sort((a, b) => a - b).map(year => ({
      year,
      egen: avg(salaryRows.filter(row => row.year === year && row.mine).map(row => row.weekly)),
      gennemsnit: avg(salaryRows.filter(row => row.year === year).map(row => row.weekly)),
    }));
  }
  const insufficientMembers = membersWithContracts < 10;
  const waitingItems = [
    ...(workRequests ?? []).map(request => ({ key: `request-${request.id}`, href: `/portal/mine-vaerker?request=${request.id}`, icon: Clock3, title: "Værksrettelse", text: "Din rettelse afventer DFKS." })),
    ...(screeningClaims ?? []).map(claim => ({ key: `claim-${claim.id}`, href: `/portal/mine-visninger?claim=${claim.id}`, icon: MonitorPlay, title: claim.title || "Visningsindberetning", text: "Din indberetning afventer DFKS." })),
  ];
  return <div className="space-y-6">
    <PageHeader title={`Velkommen, ${(holder.full_name ?? "").trim().split(/\s+/)[0] || holder.full_name}`} subtitle="Her er det, der kræver din opmærksomhed." />
    <div className="grid gap-6 lg:grid-cols-2">
      <DashboardCard title="Kræver handling" count={actionItems.length} icon={AlertCircle} items={actionItems} empty="Du har ingen åbne opgaver." />
      <DashboardCard title="Afventer DFKS" count={waitingItems.length} icon={Clock3} items={waitingItems} empty="Intet afventer behandling." />
    </div>
    <SalaryStatsCard points={salaryPoints} optedOut={optedOut} insufficientMembers={insufficientMembers} />
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><MessageSquare className="h-5 w-5 text-amber-500" />Beskeder fra DFKS</h2>
      <MemberInboxPanel />
    </section>
  </div>;
}

function DashboardCard({ title, count, icon: Icon, items, empty }: { title: string; count: number; icon: typeof AlertCircle; items: Array<{ key: string; href: string; icon: typeof AlertCircle; title: string; text: string }>; empty: string }) {
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Icon className="h-5 w-5 text-amber-500" />{title}<span className="ml-auto text-sm text-muted-foreground">{count}</span></CardTitle></CardHeader><CardContent className="space-y-2">{items.length ? items.map(item => <Link key={item.key} href={item.href} className="flex gap-3 rounded-md border p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><item.icon className="mt-0.5 h-4 w-4" /><span><span className="block font-medium">{item.title}</span><span className="text-sm text-muted-foreground">{item.text}</span></span></Link>) : <p className="text-sm text-muted-foreground">{empty}</p>}</CardContent></Card>;
}
