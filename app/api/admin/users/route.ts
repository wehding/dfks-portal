/**
 * app/api/admin/users/route.ts
 *
 * GET  — henter alle brugere (staff fra user_org_roles + portal fra rettighedshavere)
 * PATCH — opdaterer roller i user_org_roles + user_metadata; deaktiverer/aktiverer
 */
import { NextRequest, NextResponse } from "next/server"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { assertAdminRole, SUPERADMIN_ROLES } from "@/lib/supabase/assert-admin"

const DFKS_ORG_ID = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5"

// Rangering: højeste rolle bestemmer user_metadata.role og admin-adgang
const ROLE_RANK: Record<string, number> = {
    superadmin: 4,
    admin: 3,
    "org-admin": 2,
    jurist: 1,
    viewer: 0,
}

function primaryRole(roles: string[]): string {
    return roles.reduce((best, r) => (ROLE_RANK[r] ?? -1) > (ROLE_RANK[best] ?? -1) ? r : best, "viewer")
}

function getAdmin() {
    return createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )
}

export async function GET(req: NextRequest) {
    const supabase = await createServerClient()
    const caller = await assertAdminRole(supabase)
    if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })

    const admin = getAdmin()

    // Hent alle auth-brugere
    const { data: authData, error: authErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 })

    const authMap = new Map(authData.users.map(u => [u.id, u]))

    // Hent alle staff-roller fra user_org_roles
    const { data: orgRoles } = await admin
        .from("user_org_roles")
        .select("user_id, role")
        .eq("org_id", DFKS_ORG_ID)

    // Gruppér roller per bruger
    const rolesMap = new Map<string, string[]>()
    for (const row of orgRoles ?? []) {
        const existing = rolesMap.get(row.user_id) ?? []
        existing.push(row.role)
        rolesMap.set(row.user_id, existing)
    }

    // Staff-brugere: har mindst én rolle i user_org_roles
    const staff = Array.from(rolesMap.entries())
        .map(([userId, roles]) => {
            const u = authMap.get(userId)
            return {
                id: userId,
                email: u?.email ?? null,
                full_name: u?.user_metadata?.full_name ?? u?.email ?? "—",
                roles,
                banned: u?.banned_until ? new Date(u.banned_until) > new Date() : false,
                last_sign_in: u?.last_sign_in_at ?? null,
                created_at: u?.created_at ?? "",
            }
        })

    // Portal-brugere: rettighedshavere med user_id
    const { data: rh } = await admin
        .from("rettighedshavere")
        .select("id, full_name, email, user_id, onboarding_completed")
        .not("user_id", "is", null)

    const portal = (rh ?? []).map(r => {
        const u = r.user_id ? authMap.get(r.user_id) : null
        return {
            id: r.user_id!,
            rh_id: r.id,
            email: r.email ?? u?.email ?? null,
            full_name: r.full_name,
            roles: ["portal"],
            banned: u?.banned_until ? new Date(u.banned_until) > new Date() : false,
            last_sign_in: u?.last_sign_in_at ?? null,
            created_at: u?.created_at ?? "",
            onboarding_completed: r.onboarding_completed,
        }
    })

    return NextResponse.json({ staff, portal })
}

export async function PATCH(req: NextRequest) {
    const supabase = await createServerClient()
    const patchCaller = await assertAdminRole(supabase, SUPERADMIN_ROLES)
    if (!patchCaller) return NextResponse.json({ error: "Mangler superadmin/admin rettigheder" }, { status: 403 })

    const body = await req.json()
    const admin = getAdmin()

    // ── Opdater roller ────────────────────────────────────────
    if (body.action === "set-roles") {
        const { userId, roles }: { userId: string; roles: string[] } = body
        if (!userId || !roles?.length) {
            return NextResponse.json({ error: "userId og roles er påkrævet" }, { status: 400 })
        }

        // Slet eksisterende roller for denne bruger i org
        await admin.from("user_org_roles").delete().eq("user_id", userId).eq("org_id", DFKS_ORG_ID)

        // Indsæt nye roller
        const { error: insertErr } = await admin.from("user_org_roles").insert(
            roles.map(role => ({ user_id: userId, org_id: DFKS_ORG_ID, role }))
        )
        if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

        // Opdater user_metadata.role til den højeste rolle (bruges af admin layout)
        const primary = primaryRole(roles)
        await admin.auth.admin.updateUserById(userId, { user_metadata: { role: primary } })

        return NextResponse.json({ ok: true })
    }

    // ── Deaktiver bruger ──────────────────────────────────────
    if (body.action === "deactivate") {
        const { userId } = body
        if (!userId) return NextResponse.json({ error: "userId påkrævet" }, { status: 400 })
        const far = new Date()
        far.setFullYear(far.getFullYear() + 100)
        const { error } = await admin.auth.admin.updateUserById(userId, {
            ban_duration: "876000h", // ~100 år
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true })
    }

    // ── Genaktiver bruger ─────────────────────────────────────
    if (body.action === "activate") {
        const { userId } = body
        if (!userId) return NextResponse.json({ error: "userId påkrævet" }, { status: 400 })
        const { error } = await admin.auth.admin.updateUserById(userId, {
            ban_duration: "none",
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true })
    }

    // Bagudkompatibilitet: enkel rolle-sætning uden action
    if (body.userId && body.role && !body.action) {
        const { error } = await admin.auth.admin.updateUserById(body.userId, {
            user_metadata: { role: body.role }
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: "Ukendt action" }, { status: 400 })
}
