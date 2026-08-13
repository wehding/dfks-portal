import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { readActiveOrgId } from "@/lib/active-org-context";
import { STAFF_ROLE_RANK, isStaffRole } from "@/lib/admin-roles";

// DFKS' organisation-id bruges kun til seed/scripts og eksplicit DFKS-data.
// Det må ikke bruges som automatisk fallback for indloggede brugere.
export const DEFAULT_ORG_ID =
  process.env.NEXT_PUBLIC_DEFAULT_ORG_ID ?? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";

export async function resolveOrgId(
  db: SupabaseClient,
  userId: string
): Promise<string | null> {
  const requestedOrgId = await readActiveOrgId().catch(() => null);
  const { data: roleRows } = await db
    .from("user_org_roles")
    .select("org_id,role")
    .eq("user_id", userId);
  const staffRows = (roleRows ?? [])
    .filter((row): row is { org_id: string; role: keyof typeof STAFF_ROLE_RANK } => typeof row.org_id === "string" && isStaffRole(row.role))
    .sort((left, right) => STAFF_ROLE_RANK[right.role] - STAFF_ROLE_RANK[left.role] || left.org_id.localeCompare(right.org_id));
  if (staffRows.length) {
    const global = staffRows.some(row => row.role === "superadmin");
    if (requestedOrgId) {
      if (global) {
        const { data: requestedOrganisation } = await db.from("organisations").select("id").eq("id", requestedOrgId).maybeSingle();
        if (requestedOrganisation) return requestedOrgId;
      } else if (staffRows.some(row => row.org_id === requestedOrgId)) {
        return requestedOrgId;
      }
    }
    return staffRows[0].org_id;
  }

  const { data: holder } = await db
    .from("rettighedshavere")
    .select("id,org_affiliations(org_id,created_at)")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  const affiliations = (holder?.org_affiliations as Array<{ org_id?: string | null; created_at?: string | null }> | null | undefined)
    ?.filter(affiliation => Boolean(affiliation.org_id))
    .sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? ""))) ?? [];
  if (requestedOrgId && affiliations.some(affiliation => affiliation.org_id === requestedOrgId)) return requestedOrgId;
  return affiliations[0]?.org_id ?? null;
}

export async function requireOrgId(db: SupabaseClient, userId: string): Promise<string> {
  const orgId = await resolveOrgId(db, userId);
  if (!orgId) {
    throw new Error("Din bruger er ikke knyttet til en organisation. Kontakt administrator.");
  }
  return orgId;
}
