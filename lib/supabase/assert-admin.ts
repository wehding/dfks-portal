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
import { ADMIN_ROLES, STAFF_ROLE_RANK, SUPERADMIN_ROLES, type StaffRole } from "@/lib/admin-roles"

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
    const highestRole = data?.slice().sort(
        (a, b) => (STAFF_ROLE_RANK[b.role as StaffRole] ?? -1) - (STAFF_ROLE_RANK[a.role as StaffRole] ?? -1)
    )[0]

    if (!highestRole) return null
    return { userId: user.id, role: highestRole.role, orgId: highestRole.org_id }
}

export { ADMIN_ROLES, SUPERADMIN_ROLES }
