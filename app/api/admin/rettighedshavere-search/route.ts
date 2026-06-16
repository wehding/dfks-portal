/**
 * GET /api/admin/rettighedshavere-search?q=...
 * Søger i retrighedshavere der endnu ikke har en portal-bruger (user_id IS NULL).
 * Bruges ved oprettelse af portalbrugere i admin/brugere.
 */
import { NextRequest, NextResponse } from "next/server"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { assertAdminRole } from "@/lib/supabase/assert-admin"

export async function GET(req: NextRequest) {
    const supabase = await createServerClient()
    const caller = await assertAdminRole(supabase)
    if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })

    const q = req.nextUrl.searchParams.get("q") ?? ""
    if (q.length < 2) return NextResponse.json([])

    const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data, error } = await admin
        .from("rettighedshavere")
        .select("id, full_name, email")
        .is("user_id", null)
        .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
        .order("full_name")
        .limit(8)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data ?? [])
}
