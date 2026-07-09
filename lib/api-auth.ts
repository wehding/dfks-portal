/**
 * lib/api-auth.ts
 *
 * Genbrugelige auth-guards til /api-ruter. Middleware dækker IKKE /api,
 * så hver rute der rører følsom data / dyre eksterne kald skal selv tjekke.
 *
 * Brug øverst i hver handler:
 *   const denied = await requireAdminApi()
 *   if (denied) return denied
 */

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { assertAdminRole } from "@/lib/supabase/assert-admin"

/**
 * Kræver en indlogget bruger med admin-rolle (user_org_roles).
 * Returnerer et 403-svar hvis ikke — ellers null (fortsæt).
 */
export async function requireAdminApi(roles?: readonly string[]): Promise<NextResponse | null> {
    const supabase = await createClient()
    const caller = await assertAdminRole(supabase, roles)
    if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })
    return null
}

/**
 * Kræver blot en indlogget bruger (vilkårlig rolle). Bruges til dyre
 * proxy-/AI-ruter der skal være lukket for anonyme, men er tilgængelige
 * for både medlemmer og admins.
 */
export async function requireSessionApi(): Promise<NextResponse | null> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke logget ind" }, { status: 401 })
    return null
}
