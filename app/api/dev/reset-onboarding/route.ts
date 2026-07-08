import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

export async function POST(req: NextRequest) {
    // Kun tilgængelig i development
    if (process.env.NODE_ENV !== "development") {
        return NextResponse.json({ error: "Ikke tilgængelig" }, { status: 403 })
    }

    let email = "test@dfks.dk"
    try {
        const body = await req.json()
        if (body && body.email) {
            email = body.email
        }
    } catch {
        // Ignorer hvis der ikke er nogen JSON-body
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

    // Nulstil onboarding_completed og de indsamlede data i rettighedshavere
    const { data: updatedRows, error: updateError } = await supabase
        .from("rettighedshavere")
        .update({
            full_name: "",
            phone: null,
            address: null,
            cpr_no: null,
            bank_account: null,
            opt_out_statistics: false,
            onboarding_completed: false
        })
        .eq("user_id", user.id)
        .select()

    if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    if (!updatedRows || updatedRows.length === 0) {
        return NextResponse.json({ error: `Ingen rettighedshaver-række fundet for brugeren: ${email}` }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: `Onboarding nulstillet for ${email}` })
}
