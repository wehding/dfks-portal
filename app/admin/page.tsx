import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { loadAdminDashboardMetrics, loadRecentUserActivity } from "@/lib/admin-dashboard-server";
import { AdminDashboard } from "@/components/admin/admin-dashboard";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, ["superadmin", "admin", "org-admin", "jurist", "viewer"]);
  if (!caller) redirect("/");
  const [metrics, activities] = await Promise.all([
    loadAdminDashboardMetrics(caller.orgId, caller.userId),
    loadRecentUserActivity(caller.orgId, 8),
  ]);
  const noticeValue = (await searchParams)?.notice;
  const notice = Array.isArray(noticeValue) ? noticeValue[0] : noticeValue;
  return <AdminDashboard metrics={metrics} notice={notice} recentActivities={activities} />;
}
