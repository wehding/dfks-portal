import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isStaffRole, type StaffRole } from "@/lib/admin-roles";
import { resolveBranding, resolveTerminology } from "@/lib/branding";
import { staffModulePermissions, type StaffModulePermission, type StaffModule } from "@/lib/staff-access";
import { selectAppOrganisationAccess } from "@/lib/app-access-selection";

export type OrganisationAccess = {
  id: string;
  name: string;
  canUseAdmin: boolean;
  canUseMember: boolean;
  staffRole: StaffRole | null;
};

export type AppAccessContext = {
  userId: string;
  orgId: string;
  rightsHolderId: string | null;
  role: StaffRole | null;
  global: boolean;
  canUseAdmin: boolean;
  canUseMember: boolean;
  allowedOrgIds: string[];
  organisations: OrganisationAccess[];
  modules: Record<StaffModule, StaffModulePermission> | null;
  brand: { logo_url: string | null; short_name: string; long_name: string };
  terminology: {
    member_word: string;
    coeditor_word: string;
    role_labels: string[];
    default_role_label: string;
  };
};

type RoleRow = { role: string; org_id: string };
type AffiliationRow = { org_id: string; created_at?: string | null };

export async function resolveAppAccessContext(
  db: SupabaseClient,
  requestedOrgId?: string | null,
  verifiedUserId?: string | null,
): Promise<AppAccessContext | null> {
  let userId = verifiedUserId ?? null;
  if (!userId) {
    const { data: { user } } = await db.auth.getUser();
    userId = user?.id ?? null;
  }
  if (!userId) return null;

  const [{ data: roleData, error: roleError }, { data: holderData, error: holderError }] = await Promise.all([
    db.from("user_org_roles").select("role,org_id").eq("user_id", userId),
    db.from("rettighedshavere")
      .select("id,org_affiliations(org_id,created_at)")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
  ]);
  if (roleError) throw new Error(roleError.message);
  if (holderError) throw new Error(holderError.message);

  const roleRows = ((roleData ?? []) as RoleRow[]).filter(row => isStaffRole(row.role) && typeof row.org_id === "string");
  const global = roleRows.some(row => row.role === "superadmin");
  const affiliations = (((holderData as { org_affiliations?: AffiliationRow[] | null } | null)?.org_affiliations ?? []) as AffiliationRow[])
    .filter(row => typeof row.org_id === "string")
    .sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")));
  const memberOrgIds = new Set(affiliations.map(row => row.org_id));

  let allOrganisationIds: string[] = [];
  if (global) {
    const { data: allOrganisations, error } = await db.from("organisations").select("id").order("name");
    if (error) throw new Error(error.message);
    allOrganisationIds = (allOrganisations ?? []).map(row => row.id);
  }
  const selection = selectAppOrganisationAccess({
    roleRows,
    memberOrgIds: [...memberOrgIds],
    allOrganisationIds,
    requestedOrgId,
  });
  const { orgId, role, availableOrgIds } = selection;
  if (!availableOrgIds.length) return null;
  if (!orgId) return null;

  const { data: organisationRows, error: organisationsError } = await db
    .from("organisations")
    .select("id,name,logo_url,branding,terminology")
    .in("id", availableOrgIds)
    .order("name");
  if (organisationsError) throw new Error(organisationsError.message);
  const activeOrganisation = (organisationRows ?? []).find(row => row.id === orgId) ?? null;
  if (!activeOrganisation) return null;

  const brand = resolveBranding(activeOrganisation as never);
  const terminology = resolveTerminology(activeOrganisation as never);
  const organisations = (organisationRows ?? []).map(row => ({
    id: row.id,
    name: row.name,
    canUseAdmin: selection.staffOrgIds.includes(row.id),
    canUseMember: memberOrgIds.has(row.id),
    staffRole: selection.staffRoleByOrg[row.id] ?? null,
  }));

  return {
    userId,
    orgId,
    rightsHolderId: memberOrgIds.has(orgId) ? (holderData?.id ?? null) : null,
    role,
    global,
    canUseAdmin: selection.staffOrgIds.includes(orgId),
    canUseMember: memberOrgIds.has(orgId),
    allowedOrgIds: organisations.map(row => row.id),
    organisations,
    modules: role ? staffModulePermissions(role) : null,
    brand: {
      logo_url: activeOrganisation.logo_url ?? null,
      short_name: brand.short_name,
      long_name: brand.long_name,
    },
    terminology: {
      member_word: terminology.member_word,
      coeditor_word: terminology.coeditor_word,
      role_labels: terminology.role_labels,
      default_role_label: terminology.default_role_label,
    },
  };
}
