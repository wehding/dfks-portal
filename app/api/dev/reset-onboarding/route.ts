import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export async function POST(req: NextRequest) {
    // Kun tilgængelig i development
    if (process.env.NODE_ENV !== "development") {
        return NextResponse.json({ error: "Ikke tilgængelig" }, { status: 403 })
    }

    const { email } = await req.json()
    if (!email) {
        return NextResponse.json({ error: "Email mangler" }, { status: 400 })
    }

    // Service-klient med service_role-nøgle til at omgå RLS
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { cookies: { getAll: () => [], setAll: () => {} } }
    )

    // Slå bruger op via auth.users
    const { data: users, error: userError } = await supabase.auth.admin.listUsers()
    if (userError) {
        return NextResponse.json({ error: userError.message }, { status: 500 })
    }

    const user = users.users.find(u => u.email === email)
    if (!user) {
        return NextResponse.json({ error: `Ingen bruger fundet med e-mail: ${email}` }, { status: 404 })
    }

    // Nulstil onboarding_completed i rettighedshavere
    const { error: updateError } = await supabase
        .from("rettighedshavere")
        .update({ onboarding_completed: false })
        .eq("user_id", user.id)

    if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: `Onboarding nulstillet for ${email}` })
}
