import type { SupabaseClient } from "@supabase/supabase-js";
import { mustCompleteOnboarding, resolveOnboardingStatus, type OnboardingStatus } from "@/lib/auth/onboarding-state";

export const STAFF_ROLES = ["superadmin", "admin", "org-admin", "jurist", "viewer"] as const;

export function hasStaffRole(roles: readonly string[]): boolean {
  return roles.some(role => (STAFF_ROLES as readonly string[]).includes(role));
}

export async function resolvePostLoginDestination(
  supabase: SupabaseClient,
  userId: string,
  lastSignInAt?: string | null
): Promise<string> {
  const [roleResult, rightsHolderResult, authResult] = await Promise.all([
    supabase.from("user_org_roles").select("role").eq("user_id", userId).in("role", STAFF_ROLES).limit(1),
    supabase.from("rettighedshavere").select("user_id,onboarding_completed_at,onboarding_required_at").eq("user_id", userId).limit(1).maybeSingle(),
    lastSignInAt === undefined ? supabase.auth.getUser() : Promise.resolve(null),
  ]);
  const rightsHolder = rightsHolderResult.data;
  if (rightsHolder) {
    const status = resolveOnboardingStatus({
      hasPortalUser: Boolean(rightsHolder.user_id),
      completedAt: rightsHolder.onboarding_completed_at,
      requiredAt: rightsHolder.onboarding_required_at,
      lastSignInAt: lastSignInAt === undefined ? authResult?.data.user?.last_sign_in_at : lastSignInAt,
    });
    if (mustCompleteOnboarding(status)) return "/onboarding";
  }
  if (roleResult.data?.length) {
    if (roleResult.data.some(r => r.role === "superadmin")) return "/admin/insights";
    return "/admin";
  }
  return rightsHolder ? "/portal" : "/onboarding";
}

export async function resolveCurrentOnboardingStatus(
  supabase: SupabaseClient,
  userId: string,
  lastSignInAt?: string | null
): Promise<OnboardingStatus> {
  const { data: rightsHolder } = await supabase
    .from("rettighedshavere")
    .select("user_id,onboarding_completed_at,onboarding_required_at")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return resolveOnboardingStatus({
    hasPortalUser: Boolean(rightsHolder?.user_id),
    completedAt: rightsHolder?.onboarding_completed_at,
    requiredAt: rightsHolder?.onboarding_required_at,
    lastSignInAt,
  });
}
