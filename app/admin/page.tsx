import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { loadAdminDashboardMetrics } from "@/lib/admin-dashboard-server";
import { AdminDashboard } from "@/components/admin/admin-dashboard";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, ["superadmin", "admin", "org-admin", "jurist", "viewer"]);
  if (!caller) redirect("/");
  const metrics = await loadAdminDashboardMetrics(caller.orgId, caller.userId);
  return <AdminDashboard metrics={metrics} />;
}
