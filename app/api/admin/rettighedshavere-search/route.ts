/**
 * GET /api/admin/rettighedshavere-search?q=...
 * Søger i retrighedshavere der endnu ikke har en portal-bruger (user_id IS NULL).
 * Bruges ved oprettelse af portalbrugere i admin/brugere.
 */
import { NextRequest, NextResponse } from "next/server"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { USER_ADMIN_ROLES } from "@/lib/admin-roles"
import { postgrestIlikePattern } from "@/lib/postgrest-search"

export async function GET(req: NextRequest) {
    const supabase = await createServerClient()
    const caller = await assertAdminRole(supabase, USER_ADMIN_ROLES)
    if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })

    const pattern = postgrestIlikePattern(req.nextUrl.searchParams.get("q") ?? "")
    if (!pattern || pattern.length < 4) return NextResponse.json([])

    const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data, error } = await admin
        .from("rettighedshavere")
        .select("id, full_name, email, org_affiliations!inner(org_id)")
        .eq("org_affiliations.org_id", caller.orgId)
        .is("user_id", null)
        .or(`full_name.ilike.${pattern},email.ilike.${pattern}`)
        .order("full_name")
        .limit(8)

    if (error) {
        console.error("[rights-holder-search] search failed", error.code)
        return NextResponse.json({ error: "Søgningen kunne ikke gennemføres." }, { status: 500 })
    }
    return NextResponse.json(data ?? [])
}
