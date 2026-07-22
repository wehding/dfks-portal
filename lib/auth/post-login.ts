import type { SupabaseClient } from "@supabase/supabase-js";

const ADMIN_ROLES = ["superadmin", "admin", "org-admin", "jurist"];

export async function resolvePostLoginDestination(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const { data: roleRows } = await supabase
    .from("user_org_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ADMIN_ROLES)
    .limit(1);

  if (roleRows?.length) return "/admin/kontraktgennemgang";

  const { data: rightsHolder } = await supabase
    .from("rettighedshavere")
    .select("onboarding_completed")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  return rightsHolder?.onboarding_completed ? "/portal" : "/onboarding";
}
