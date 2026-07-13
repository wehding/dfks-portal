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

const ADMIN_ROLES = ["superadmin", "admin", "org-admin", "jurist"] as const
const SUPERADMIN_ROLES = ["superadmin", "admin"] as const

/**
 * Tjekker om den indloggede bruger har en admin-rolle i user_org_roles.
 * Returnerer rollen hvis adgang er tilladt, ellers null.
 */
export async function assertAdminRole(
    supabase: SupabaseClient,
    roles: readonly string[] = ADMIN_ROLES
): Promise<{ userId: string; role: string; orgId: string } | null> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data } = await supabase
        .from("user_org_roles")
        .select("role, org_id")
        .eq("user_id", user.id)
        .in("role", roles)
        .limit(1)
        .single()

    if (!data) return null
    return { userId: user.id, role: data.role, orgId: data.org_id }
}

export { ADMIN_ROLES, SUPERADMIN_ROLES }
