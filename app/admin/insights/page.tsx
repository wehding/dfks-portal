import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { fetchSuperadminInsights } from "@/lib/server/superadmin-overview";
import { InsightsPanel } from "@/components/admin/insights-panel";

export const dynamic = "force-dynamic";

export default async function SuperadminInsightsPage() {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, ["superadmin"]);
  if (!caller) {
    redirect("/admin");
  }

  const data = await fetchSuperadminInsights();
  return <InsightsPanel data={data} />;
}
