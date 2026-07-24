export const STAFF_ROLES = ["superadmin", "admin", "org-admin", "jurist", "viewer"] as const;
export const ADMIN_ROLES = ["superadmin", "admin", "org-admin", "jurist"] as const;
export const SUPERADMIN_ROLES = ["superadmin", "admin"] as const;
export const SYSTEM_ROLES = ["member"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_RANK: Record<StaffRole, number> = {
  superadmin: 4,
  admin: 3,
  "org-admin": 2,
  jurist: 1,
  viewer: 0,
};

export function isStaffRole(role: unknown): role is StaffRole {
  return typeof role === "string" && (STAFF_ROLES as readonly string[]).includes(role);
}

export function highestStaffRole(roles: readonly string[]): StaffRole | null {
  return roles
    .filter(isStaffRole)
    .sort((left, right) => STAFF_ROLE_RANK[right] - STAFF_ROLE_RANK[left])[0] ?? null;
}
