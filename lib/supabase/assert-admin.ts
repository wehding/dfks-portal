/**
 * lib/supabase/assert-admin.ts
 *
 * Server-side auth-hjælper til admin-ruter.
 *
 * Bruger ALDRIG user_metadata til adgangskontrol — den kan opdateres
 * af brugeren selv via Supabase Auth API og er derfor utroværdig.
 *
 * Slår i stedet op i user_org_roles-tabellen som kun kan ændres
 * server-side med service role.
 */

import { SupabaseClient } from "@supabase/supabase-js"
import { ADMIN_ROLES, SUPERADMIN_ROLES } from "@/lib/admin-roles"
import { readActiveOrgId } from "@/lib/active-org-context"
import { resolveAppAccessContext } from "@/lib/app-access-context"

/**
 * Tjekker om den indloggede bruger har en admin-rolle i user_org_roles.
 * Returnerer rollen hvis adgang er tilladt, ellers null.
 */
export async function assertAdminRole(
    supabase: SupabaseClient,
    roles: readonly string[] = ADMIN_ROLES
): Promise<{ userId: string; role: string; orgId: string } | null> {
    const access = await resolveAppAccessContext(supabase, await readActiveOrgId())
    if (!access?.canUseAdmin || !access.role || !roles.includes(access.role)) return null
    return { userId: access.userId, role: access.role, orgId: access.orgId }
}

export { ADMIN_ROLES, SUPERADMIN_ROLES }
