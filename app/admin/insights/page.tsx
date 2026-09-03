import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { fetchSuperadminInsights } from "@/lib/server/superadmin-overview";
import { InsightsPanel } from "@/components/admin/insights-panel";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function SuperadminInsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, ["superadmin"]);
  if (!caller) {
    redirect("/admin");
  }

  const requestedOrg = (await searchParams).org;
  const orgId = requestedOrg && UUID_PATTERN.test(requestedOrg) ? requestedOrg : null;
  const data = await fetchSuperadminInsights({ caller, orgId });
  return <InsightsPanel data={data} />;
}
