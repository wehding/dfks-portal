export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, Clock3, FileText, MessageSquare, MonitorPlay } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

type ContractRow = { id: string; working_title: string | null; work_id: string | null; contract_comments: Array<{ author_role: string; member_read_at: string | null }> | null };
type InboxThread = { id: string; subject: string; member_messages: Array<{ author_role: string; created_at: string }> | null; member_message_participants: Array<{ user_id: string; last_read_at: string | null }> | null };

export default async function PortalDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const db = createServiceClient();
  const { data: holder } = await db.from("rettighedshavere").select("id,full_name,org_affiliations(org_id)").eq("user_id", user.id).maybeSingle();
  if (!holder) redirect("/onboarding");
  const orgId = (Array.isArray(holder.org_affiliations) ? holder.org_affiliations[0] : holder.org_affiliations)?.org_id;
  if (!orgId) redirect("/onboarding");
  const [{ data: contracts }, { data: workRequests }, { data: screeningClaims }, { data: inboxThreads }] = await Promise.all([
    db.from("contracts").select("id,working_title,work_id,contract_comments(author_role,member_read_at)").eq("org_id", orgId).eq("rights_holder_id", holder.id),
    db.from("work_change_requests").select("id,status,created_at").eq("org_id", orgId).eq("requested_by_rights_holder_id", holder.id).eq("status", "pending"),
    db.from("screening_claims").select("id,title,status,created_at").eq("org_id", orgId).eq("profile_id", user.id).eq("status", "pending"),
    db.from("member_message_threads").select("id,subject,member_messages(author_role,created_at),member_message_participants(user_id,last_read_at)").eq("org_id", orgId).eq("rights_holder_id", holder.id),
  ]);
  const contractRows = (contracts ?? []) as ContractRow[];
  const unreadThreads = ((inboxThreads ?? []) as InboxThread[]).filter(thread => {
    const lastRead = thread.member_message_participants?.find(participant => participant.user_id === user.id)?.last_read_at ?? "";
    return (thread.member_messages ?? []).some(message => message.author_role === "admin" && message.created_at > lastRead);
  });
  const actionItems = [
    ...contractRows.filter(contract => !contract.work_id).map(contract => ({ key: `work-${contract.id}`, href: `/portal/mine-kontrakter?contract=${contract.id}`, icon: FileText, title: contract.working_title || "Kontrakt uden værk", text: "Tilknyt kontrakten til det korrekte værk." })),
    ...contractRows.filter(contract => (contract.contract_comments ?? []).some(comment => comment.author_role === "admin" && !comment.member_read_at)).map(contract => ({ key: `message-${contract.id}`, href: `/portal/mine-kontrakter?contract=${contract.id}`, icon: MessageSquare, title: contract.working_title || "Ny kontraktbesked", text: "Læs det nye svar fra DFKS." })),
    ...unreadThreads.map(thread => ({ key: `inbox-${thread.id}`, href: `/portal/beskeder?thread=${thread.id}`, icon: MessageSquare, title: thread.subject, text: "Læs den nye besked fra DFKS." })),
  ];
  const waitingItems = [
    ...(workRequests ?? []).map(request => ({ key: `request-${request.id}`, href: `/portal/mine-vaerker?request=${request.id}`, icon: Clock3, title: "Værksrettelse", text: "Din rettelse afventer DFKS." })),
    ...(screeningClaims ?? []).map(claim => ({ key: `claim-${claim.id}`, href: `/portal/mine-visninger?claim=${claim.id}`, icon: MonitorPlay, title: claim.title || "Visningsindberetning", text: "Din indberetning afventer DFKS." })),
  ];
  return <div className="space-y-6">
    <PageHeader title={`Velkommen, ${holder.full_name}`} subtitle="Her er det, der kræver din opmærksomhed." />
    <div className="grid gap-6 lg:grid-cols-2">
      <DashboardCard title="Kræver handling" count={actionItems.length} icon={AlertCircle} items={actionItems} empty="Du har ingen åbne opgaver." />
      <DashboardCard title="Afventer DFKS" count={waitingItems.length} icon={Clock3} items={waitingItems} empty="Intet afventer behandling." />
    </div>
  </div>;
}

function DashboardCard({ title, count, icon: Icon, items, empty }: { title: string; count: number; icon: typeof AlertCircle; items: Array<{ key: string; href: string; icon: typeof AlertCircle; title: string; text: string }>; empty: string }) {
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Icon className="h-5 w-5 text-amber-500" />{title}<span className="ml-auto text-sm text-muted-foreground">{count}</span></CardTitle></CardHeader><CardContent className="space-y-2">{items.length ? items.map(item => <Link key={item.key} href={item.href} className="flex gap-3 rounded-md border p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><item.icon className="mt-0.5 h-4 w-4" /><span><span className="block font-medium">{item.title}</span><span className="text-sm text-muted-foreground">{item.text}</span></span></Link>) : <p className="text-sm text-muted-foreground">{empty}</p>}</CardContent></Card>;
}
