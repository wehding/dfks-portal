export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { PortalPageHeader } from "@/components/portal/portal-page-header";
import { OrgContextNotice } from "@/components/navigation/org-context-notice";
import { requireMemberContext } from "@/lib/org";
import { ListReadinessMarker } from "@/components/performance/list-readiness-marker";
import { DashboardInboxSection, DashboardSalarySection, DashboardTasksSection } from "@/components/portal/dashboard-sections";

function SectionSkeleton({ className = "h-52" }: { className?: string }) {
  return <div className={`${className} animate-pulse rounded-lg border bg-muted/30`} />;
}

export default async function PortalDashboardPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const db = createServiceClient();
  const memberContext = await requireMemberContext(db, user.id).catch(() => null);
  if (!memberContext?.rightsHolderId) {
    const { data: staffRole } = await db.from("user_org_roles").select("org_id").eq("user_id", user.id).limit(1).maybeSingle();
    if (staffRole) redirect("/admin?notice=member-org-required");
    redirect("/onboarding");
  }
  const { data: holder } = await db.from("rettighedshavere")
    .select("id,full_name,opt_out_statistics,org_affiliations(org_id,statistics_participation)")
    .eq("id", memberContext.rightsHolderId)
    .maybeSingle();
  if (!holder) redirect("/onboarding");
  const affiliations = Array.isArray(holder.org_affiliations) ? holder.org_affiliations : [holder.org_affiliations];
  const affiliation = affiliations.find(row => row?.org_id === memberContext.orgId) ?? null;
  const optedOut = typeof affiliation?.statistics_participation === "boolean"
    ? !affiliation.statistics_participation
    : Boolean(holder.opt_out_statistics);
  const noticeValue = (await searchParams)?.notice;
  const notice = Array.isArray(noticeValue) ? noticeValue[0] : noticeValue;

  return <div className="space-y-6">
    <PortalPageHeader title="Overblik" subtitle={`Velkommen, ${(holder.full_name ?? "").trim().split(/\s+/)[0] || holder.full_name}. Her er det, der kræver din opmærksomhed.`} />
    <OrgContextNotice notice={notice} />
    <ListReadinessMarker route="member-dashboard" stage="access" />
    <Suspense fallback={<SectionSkeleton />}>
      <DashboardTasksSection orgId={memberContext.orgId} rightsHolderId={holder.id} userId={user.id} />
    </Suspense>
    <Suspense fallback={<SectionSkeleton className="h-80" />}>
      <DashboardSalarySection orgId={memberContext.orgId} rightsHolderId={holder.id} optedOut={optedOut} />
    </Suspense>
    <Suspense fallback={<SectionSkeleton />}>
      <DashboardInboxSection />
    </Suspense>
  </div>;
}
