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
const ROLE_RANK: Record<string, number> = { superadmin: 4, admin: 3, "org-admin": 2, jurist: 1 }

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
    // ANTAGELSE: "én admin = én org". Har en bruger admin-roller i flere organisationer, bindes
    // hele admin-sessionen til org'en for den HØJEST-rangerede rolle. Der er (bevidst) ingen
    // org-vælger endnu — skal multi-org-admin understøttes, skal orgId gøres til et eksplicit
    // valg/parameter i stedet for at udledes af rolle-rank her.
    const highestRole = data?.slice().sort((a, b) => (ROLE_RANK[b.role] ?? 0) - (ROLE_RANK[a.role] ?? 0))[0]

    if (!highestRole) return null
    return { userId: user.id, role: highestRole.role, orgId: highestRole.org_id }
}

export { ADMIN_ROLES, SUPERADMIN_ROLES }
