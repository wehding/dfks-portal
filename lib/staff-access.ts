import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { STAFF_ROLE_RANK, isStaffRole, type StaffRole } from "@/lib/admin-roles";

export type StaffModule = "rights_holders" | "contracts" | "messages" | "contract_reviews" | "statistics" | "advice_statistics" | "users" | "payouts" | "organisation" | "works" | "producers";
export type StaffOperation = "read" | "write" | "validate" | "delete";
export type StaffModulePermission = Record<StaffOperation, boolean>;

const NONE: StaffModulePermission = { read: false, write: false, validate: false, delete: false };
const READ: StaffModulePermission = { read: true, write: false, validate: false, delete: false };
const WRITE: StaffModulePermission = { read: true, write: true, validate: true, delete: false };
const FULL: StaffModulePermission = { read: true, write: true, validate: true, delete: true };

function modulePermissions(role: StaffRole): Record<StaffModule, StaffModulePermission> {
  const all = role === "superadmin" || role === "admin" || role === "org-admin";
  const legal = role === "jurist";
  const viewer = role === "viewer";
  return {
    rights_holders: all ? FULL : legal ? WRITE : viewer ? READ : NONE,
    contracts: all ? FULL : legal ? WRITE : viewer ? READ : NONE,
    messages: all ? FULL : legal ? WRITE : viewer ? READ : NONE,
    contract_reviews: all ? FULL : legal ? WRITE : viewer ? READ : NONE,
    statistics: all ? READ : NONE,
    advice_statistics: all || legal ? READ : NONE,
    users: all ? FULL : NONE,
    payouts: all ? FULL : NONE,
    organisation: all ? FULL : NONE,
    works: all ? FULL : legal || viewer ? READ : NONE,
    producers: all ? FULL : legal || viewer ? READ : NONE,
  };
}

export type StaffAccess = {
  userId: string;
  roles: Array<{ role: StaffRole; orgId: string }>;
  global: boolean;
  allowedOrgIds: string[];
  activeOrgId: string;
  activeRole: StaffRole;
  modules: Record<StaffModule, StaffModulePermission>;
};

export async function resolveStaffAccess(db: SupabaseClient, requestedOrgId?: string | null): Promise<StaffAccess | null> {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data, error } = await db.from("user_org_roles")
    .select("role,org_id")
    .eq("user_id", user.id)
    .in("role", ["superadmin", "admin", "org-admin", "jurist", "viewer"]);
  if (error) throw new Error(error.message);
  const rows = (data ?? [])
    .filter((row): row is { role: StaffRole; org_id: string } => isStaffRole(row.role) && typeof row.org_id === "string")
    .sort((a, b) => (STAFF_ROLE_RANK[b.role] - STAFF_ROLE_RANK[a.role]) || a.org_id.localeCompare(b.org_id));
  if (!rows.length) return null;
  const global = rows.some(row => row.role === "superadmin");
  let allowedOrgIds = [...new Set(rows.map(row => row.org_id))];
  if (global) {
    const { data: organisations, error: orgError } = await db.from("organisations").select("id").order("name");
    if (orgError) throw new Error(orgError.message);
    allowedOrgIds = (organisations ?? []).map(org => org.id);
  }
  const activeOrgId = requestedOrgId && allowedOrgIds.includes(requestedOrgId)
    ? requestedOrgId
    : rows[0].org_id;
  const activeRole = global
    ? "superadmin"
    : rows.filter(row => row.org_id === activeOrgId)[0]?.role ?? rows[0].role;
  return {
    userId: user.id,
    roles: rows.map(row => ({ role: row.role, orgId: row.org_id })),
    global,
    allowedOrgIds,
    activeOrgId,
    activeRole,
    modules: modulePermissions(activeRole),
  };
}
