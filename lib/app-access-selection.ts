import { STAFF_ROLE_RANK, isStaffRole, type StaffRole } from "@/lib/admin-roles";

export type AccessRoleRow = { role: string; org_id: string };

export type AccessSelection = {
  orgId: string | null;
  global: boolean;
  role: StaffRole | null;
  staffOrgIds: string[];
  memberOrgIds: string[];
  availableOrgIds: string[];
  staffRoleByOrg: Record<string, StaffRole | null>;
};

function highestRole(rows: AccessRoleRow[], orgId: string, global: boolean): StaffRole | null {
  if (global) return "superadmin";
  return rows
    .filter((row): row is AccessRoleRow & { role: StaffRole } => row.org_id === orgId && isStaffRole(row.role))
    .sort((left, right) => STAFF_ROLE_RANK[right.role] - STAFF_ROLE_RANK[left.role])[0]?.role ?? null;
}

export function selectAppOrganisationAccess(params: {
  roleRows: AccessRoleRow[];
  memberOrgIds: string[];
  allOrganisationIds?: string[];
  requestedOrgId?: string | null;
}): AccessSelection {
  const roleRows = params.roleRows.filter(row => isStaffRole(row.role) && Boolean(row.org_id));
  const global = roleRows.some(row => row.role === "superadmin");
  const staffOrgIds = global
    ? [...new Set(params.allOrganisationIds ?? [])]
    : [...new Set(roleRows.map(row => row.org_id))];
  const memberOrgIds = [...new Set(params.memberOrgIds.filter(Boolean))];
  const availableOrgIds = [...new Set([...staffOrgIds, ...memberOrgIds])];

  const rankedStaffRows = [...roleRows].sort((left, right) => {
    const leftRole = left.role as StaffRole;
    const rightRole = right.role as StaffRole;
    return STAFF_ROLE_RANK[rightRole] - STAFF_ROLE_RANK[leftRole] || left.org_id.localeCompare(right.org_id);
  });
  const fallbackOrgId = rankedStaffRows[0]?.org_id ?? memberOrgIds[0] ?? availableOrgIds[0] ?? null;
  const orgId = params.requestedOrgId && availableOrgIds.includes(params.requestedOrgId)
    ? params.requestedOrgId
    : fallbackOrgId;
  const staffRoleByOrg = Object.fromEntries(availableOrgIds.map(id => [id, highestRole(roleRows, id, global)]));

  return {
    orgId,
    global,
    role: orgId ? staffRoleByOrg[orgId] ?? null : null,
    staffOrgIds,
    memberOrgIds,
    availableOrgIds,
    staffRoleByOrg,
  };
}
