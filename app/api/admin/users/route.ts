/**
 * app/api/admin/users/route.ts
 * Henter Supabase auth-brugere med admin/staff-roller.
 */
import { NextRequest, NextResponse } from "next/server"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"

function getAdmin() {
    return createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )
}

export async function GET(req: NextRequest) {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 })
    const role = user.user_metadata?.role
    if (!["superadmin", "admin", "org-admin"].includes(role)) {
        return NextResponse.json({ error: "Mangler admin-rettigheder" }, { status: 403 })
    }

    const admin = getAdmin()
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Filtrer til staff-brugere (har rolle i user_metadata)
    const staff = data.users
        .filter(u => {
            const r = u.user_metadata?.role
            return r && r !== "member"
        })
        .map(u => ({
            id: u.id,
            email: u.email ?? null,
            full_name: u.user_metadata?.full_name ?? u.email ?? "—",
            role: u.user_metadata?.role ?? "viewer",
            last_sign_in: u.last_sign_in_at ?? null,
            created_at: u.created_at,
        }))

    return NextResponse.json({ users: staff })
}

export async function PATCH(req: NextRequest) {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 })
    if (!["superadmin", "admin"].includes(user.user_metadata?.role)) {
        return NextResponse.json({ error: "Mangler superadmin/admin rettigheder" }, { status: 403 })
    }

    const { userId, role } = await req.json()
    const admin = getAdmin()
    const { error } = await admin.auth.admin.updateUserById(userId, {
        user_metadata: { role }
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
}
