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
import { assertUserInOrg } from "@/lib/authz"

// Rangering: højeste rolle bestemmer user_metadata.role og admin-adgang
const ROLE_RANK: Record<string, number> = {
    superadmin: 4,
    admin: 3,
    "org-admin": 2,
    jurist: 1,
    viewer: 0,
}
const ALLOWED_STAFF_ROLES = Object.keys(ROLE_RANK)
const PRESERVED_SYSTEM_ROLES = ["member"]
const ALLOWED_ORG_ROLES = new Set([...ALLOWED_STAFF_ROLES, ...PRESERVED_SYSTEM_ROLES])

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

async function ensureTargetUserInOrg(admin: ReturnType<typeof getAdmin>, userId: string, orgId: string) {
    try {
        await assertUserInOrg(admin, userId, orgId)
        return null
    } catch {
        return NextResponse.json({ error: "Brugeren tilhører ikke din organisation" }, { status: 403 })
    }
}

export async function GET() {
    const supabase = await createServerClient()
    const caller = await assertAdminRole(supabase)
    if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })
    const orgId = caller.orgId

    const admin = getAdmin()

    // Hent alle auth-brugere
    const { data: authData, error: authErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 })

    const authMap = new Map(authData.users.map(u => [u.id, u]))

    // Hent alle staff-roller fra user_org_roles
    const { data: orgRoles } = await admin
        .from("user_org_roles")
        .select("user_id, role")
        .eq("org_id", orgId)

    // Gruppér roller per bruger
    const rolesMap = new Map<string, string[]>()
    for (const row of orgRoles ?? []) {
        const existing = rolesMap.get(row.user_id) ?? []
        existing.push(row.role)
        rolesMap.set(row.user_id, existing)
    }

    // Rettighedshavere med user_id — bruges til at berige staff-entries
    let rh: Array<{ id: string; full_name: string; email: string | null; user_id: string | null; onboarding_completed: boolean | null; gender?: string | null }> | null = null
    const rhWithGender = await admin
        .from("rettighedshavere")
        .select("id, full_name, email, user_id, onboarding_completed, gender, org_affiliations!inner(org_id)")
        .eq("org_affiliations.org_id", orgId)
        .not("user_id", "is", null)
    if (rhWithGender.error && rhWithGender.error.message.includes("gender")) {
        const rhWithoutGender = await admin
            .from("rettighedshavere")
            .select("id, full_name, email, user_id, onboarding_completed, org_affiliations!inner(org_id)")
            .eq("org_affiliations.org_id", orgId)
            .not("user_id", "is", null)
        rh = rhWithoutGender.data ?? []
    } else {
        rh = rhWithGender.data ?? []
    }

    const rhByUserId = new Map((rh ?? []).map(r => [r.user_id!, r]))

    // Saml alle kendte user_ids: staff + rettighedshavere
    const allUserIds = new Set([
        ...Array.from(rolesMap.keys()),
        ...(rh ?? []).map(r => r.user_id!),
    ])

    // Én post per bruger — kombiner roller fra user_org_roles og rettighedshavere
    const users = Array.from(allUserIds).map(userId => {
        const u = authMap.get(userId)
        const orgRoleList = rolesMap.get(userId) ?? []
        const rhEntry = rhByUserId.get(userId)

        const roles = [...orgRoleList]
        if (rhEntry) roles.push("rettighedshaver")

        return {
            id: userId,
            rh_id: rhEntry?.id ?? null,
            email: rhEntry?.email ?? u?.email ?? null,
            full_name: rhEntry?.full_name ?? u?.user_metadata?.full_name ?? u?.email ?? "—",
            roles,
            org_roles: orgRoleList,       // kun roller fra user_org_roles (bruges til rediger-dialog)
            is_rettighedshaver: !!rhEntry,
            onboarding_completed: rhEntry?.onboarding_completed ?? null,
            gender: rhEntry?.gender ?? null,
            phone: u?.user_metadata?.phone ?? null,
            title: u?.user_metadata?.title ?? null,
            banned: u?.banned_until ? new Date(u.banned_until) > new Date() : false,
            last_sign_in: u?.last_sign_in_at ?? null,
            created_at: u?.created_at ?? "",
        }
    })

    // Bagudkompatibilitet: returner også staff/portal for eksisterende forbrugere
    const staff = users.filter(u => u.org_roles.length > 0)
    const portal = users.filter(u => u.is_rettighedshaver && u.org_roles.length === 0)

    let unassigned: Array<{
        id: string
        kind: "auth_user" | "rights_holder"
        full_name: string
        email: string | null
        reason: string
        created_at: string
    }> = []

    if (caller.role === "superadmin") {
        const [{ data: allRoles }, { data: allHolders }, { data: allAffiliations }] = await Promise.all([
            admin.from("user_org_roles").select("user_id"),
            admin.from("rettighedshavere").select("id, full_name, email, user_id, created_at"),
            admin.from("org_affiliations").select("rights_holder_id"),
        ])
        const assignedUserIds = new Set((allRoles ?? []).map(row => row.user_id))
        const linkedUserIds = new Set((allHolders ?? []).map(row => row.user_id).filter(Boolean))
        const affiliatedHolderIds = new Set((allAffiliations ?? []).map(row => row.rights_holder_id))

        const authWithoutProfile = authData.users
            .filter(user => !assignedUserIds.has(user.id) && !linkedUserIds.has(user.id))
            .map(user => ({
                id: `auth:${user.id}`,
                kind: "auth_user" as const,
                full_name: String(user.user_metadata?.full_name ?? user.email ?? "Ukendt bruger"),
                email: user.email ?? null,
                reason: "Login mangler både organisationsrolle og rettighedshaverprofil",
                created_at: user.created_at,
            }))
        const holdersWithoutOrganisation = (allHolders ?? [])
            .filter(holder => !affiliatedHolderIds.has(holder.id))
            .map(holder => ({
                id: `rights-holder:${holder.id}`,
                kind: "rights_holder" as const,
                full_name: holder.full_name,
                email: holder.email,
                reason: "Rettighedshaver mangler organisationstilknytning",
                created_at: holder.created_at,
            }))
        unassigned = [...authWithoutProfile, ...holdersWithoutOrganisation]
            .sort((left, right) => left.full_name.localeCompare(right.full_name, "da"))
    }

    return NextResponse.json({ users, staff, portal, unassigned, callerRole: caller.role, callerUserId: caller.userId })
}

export async function PATCH(req: NextRequest) {
    const supabase = await createServerClient()
    const patchCaller = await assertAdminRole(supabase, SUPERADMIN_ROLES)
    if (!patchCaller) return NextResponse.json({ error: "Mangler superadmin/admin rettigheder" }, { status: 403 })
    const orgId = patchCaller.orgId

    const body = await req.json()
    const admin = getAdmin()

    // ── Opdater roller ────────────────────────────────────────
    if (body.action === "set-roles") {
        const { userId, roles }: { userId: string; roles: string[] } = body
        if (!userId || !Array.isArray(roles) || !roles.length) {
            return NextResponse.json({ error: "userId og roles er påkrævet" }, { status: 400 })
        }
        const nextRoles = Array.from(new Set(roles))
        const invalidRoles = nextRoles.filter(role => !ALLOWED_ORG_ROLES.has(role))
        if (invalidRoles.length > 0) {
            return NextResponse.json({
                error: `En eller flere roller er ugyldige: ${invalidRoles.join(", ")}`,
            }, { status: 400 })
        }
        const targetError = await ensureTargetUserInOrg(admin, userId, orgId)
        if (targetError) return targetError

        const { data: currentRoleRows } = await admin
            .from("user_org_roles")
            .select("role")
            .eq("user_id", userId)
            .eq("org_id", orgId)
        const targetIsSuperadmin = currentRoleRows?.some(row => row.role === "superadmin") ?? false
        const targetWillBeSuperadmin = nextRoles.includes("superadmin")
        if ((targetIsSuperadmin || targetWillBeSuperadmin) && patchCaller.role !== "superadmin") {
            return NextResponse.json({ error: "Kun superadmin kan ændre superadmin-rollen" }, { status: 403 })
        }
        if (targetIsSuperadmin && !targetWillBeSuperadmin) {
            const { count } = await admin
                .from("user_org_roles")
                .select("user_id", { count: "exact", head: true })
                .eq("org_id", orgId)
                .eq("role", "superadmin")
            if ((count ?? 0) <= 1) {
                return NextResponse.json({ error: "Organisationens sidste superadmin kan ikke fjernes" }, { status: 400 })
            }
        }

        // Slet eksisterende roller for denne bruger i org
        await admin.from("user_org_roles").delete().eq("user_id", userId).eq("org_id", orgId)

        // Indsæt nye roller
        const { error: insertErr } = await admin.from("user_org_roles").insert(
            nextRoles.map(role => ({ user_id: userId, org_id: orgId, role }))
        )
        if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

        // Opdater user_metadata.role til den højeste rolle (bruges af admin layout)
        const primary = primaryRole(nextRoles)
        await admin.auth.admin.updateUserById(userId, { user_metadata: { role: primary } })

        return NextResponse.json({ ok: true })
    }

    // ── Deaktiver bruger ──────────────────────────────────────
    if (body.action === "deactivate") {
        const { userId } = body
        if (!userId) return NextResponse.json({ error: "userId påkrævet" }, { status: 400 })
        if (patchCaller.role !== "superadmin") {
            return NextResponse.json({ error: "Kun superadmin kan deaktivere brugere" }, { status: 403 })
        }
        const targetError = await ensureTargetUserInOrg(admin, userId, orgId)
        if (targetError) return targetError
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
        if (patchCaller.role !== "superadmin") {
            return NextResponse.json({ error: "Kun superadmin kan aktivere brugere" }, { status: 403 })
        }
        const targetError = await ensureTargetUserInOrg(admin, userId, orgId)
        if (targetError) return targetError
        const { error } = await admin.auth.admin.updateUserById(userId, {
            ban_duration: "none",
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true })
    }

    // Bagudkompatibilitet: enkel rolle-sætning uden action
    if (body.userId && body.role && !body.action) {
        const targetError = await ensureTargetUserInOrg(admin, body.userId, orgId)
        if (targetError) return targetError
        const { error } = await admin.auth.admin.updateUserById(body.userId, {
            user_metadata: { role: body.role }
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: "Ukendt action" }, { status: 400 })
}
