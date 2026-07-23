import { NextRequest, NextResponse } from "next/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { requireAdminApi } from "@/lib/api-auth"
import { assertContractReviewInOrg } from "@/lib/authz"

// GET /api/admin/contracts/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const auth = await requireAdminApi()
    if (!auth.ok) return auth.response

    const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )
    try {
        await assertContractReviewInOrg(admin, id, auth.orgId)
    } catch {
        return NextResponse.json({ error: "Ikke fundet" }, { status: 404 })
    }

    const { data, error } = await admin
        .from("contract_reviews")
        .select("*")
        .eq("id", id)
        .single()

    if (error || !data) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 })

    const canAssign = new Set(["superadmin", "admin", "org-admin"]).has(auth.role)
    let assignees: Array<{ id: string; label: string }> = []
    if (canAssign) {
        const { data: roleRows } = await admin
            .from("user_org_roles")
            .select("user_id")
            .eq("org_id", auth.orgId)
            .in("role", ["superadmin", "admin", "org-admin", "jurist"])

        const userIds = [...new Set((roleRows ?? []).map(row => row.user_id))]
        if (userIds.length > 0) {
            const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 1000 })
            const allowedIds = new Set(userIds)
            assignees = (authUsers?.users ?? [])
                .filter(user => allowedIds.has(user.id))
                .map(user => ({
                    id: user.id,
                    label: typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()
                        ? user.user_metadata.full_name.trim()
                        : user.email ?? user.id,
                }))
                .sort((a, b) => a.label.localeCompare(b.label, "da"))
        }
    }

    return NextResponse.json({ data, assignees, canAssign })
}

// PATCH /api/admin/contracts/[id]
// Body: { status?: string, assignedTo?: string }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const auth = await requireAdminApi()
    if (!auth.ok) return auth.response

    const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )
    try {
        await assertContractReviewInOrg(admin, id, auth.orgId)
    } catch {
        return NextResponse.json({ error: "Ikke fundet" }, { status: 404 })
    }

    const body = await req.json()
    const updates: Record<string, unknown> = {}

    const allowedStatuses = new Set(["afventer", "behandling", "afsluttet"])
    if (body.status) {
        if (!allowedStatuses.has(body.status)) return NextResponse.json({ error: "Ugyldig status" }, { status: 400 })
        updates.status = body.status
    }

    if (body.action === "claim") {
        const { data: claimed, error: claimError } = await admin
            .from("contract_reviews")
            .update({ assigned_to: auth.userId, status: "behandling" })
            .eq("id", id)
            .eq("org_id", auth.orgId)
            .eq("status", "afventer")
            .is("assigned_to", null)
            .select()
            .maybeSingle()
        if (claimError) return NextResponse.json({ error: "Opgaven kunne ikke tages" }, { status: 500 })
        if (!claimed) return NextResponse.json({ error: "Opgaven er allerede taget" }, { status: 409 })
        return NextResponse.json({ data: claimed })
    }

    if (body.action === "release") {
        let release = admin.from("contract_reviews").update({ assigned_to: null, status: "afventer" }).eq("id", id).eq("org_id", auth.orgId)
        if (auth.role === "jurist") release = release.eq("assigned_to", auth.userId)
        const { data: released, error: releaseError } = await release.select().maybeSingle()
        if (releaseError) return NextResponse.json({ error: "Opgaven kunne ikke frigives" }, { status: 500 })
        if (!released) return NextResponse.json({ error: "Opgaven kan ikke frigives af denne bruger" }, { status: 403 })
        return NextResponse.json({ data: released })
    }

    if (body.action === "assign") {
        if (!new Set(["superadmin", "admin", "org-admin"]).has(auth.role)) return NextResponse.json({ error: "Kun administratorer kan tildele opgaver" }, { status: 403 })
        const assignedTo = typeof body.assignedTo === "string" ? body.assignedTo : ""
        const { data: eligible } = await admin.from("user_org_roles").select("user_id").eq("org_id", auth.orgId).eq("user_id", assignedTo).in("role", ["superadmin", "admin", "org-admin", "jurist"]).limit(1).maybeSingle()
        if (!eligible) return NextResponse.json({ error: "Modtageren kan ikke behandle opgaver i organisationen" }, { status: 400 })
        updates.assigned_to = assignedTo
        updates.status = "behandling"
    } else if (body.assignedTo !== undefined) {
        return NextResponse.json({ error: "Brug en tildelingshandling" }, { status: 400 })
    }
    if (body.jurist_response !== undefined) {
        updates.jurist_response = body.jurist_response || null
        updates.jurist_response_at = body.jurist_response ? new Date().toISOString() : null
    }

    if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: "Ingen felter at opdatere" }, { status: 400 })
    }

    // Hent nuværende kontrakt for at tjekke storage_path
    const { data: existing } = await admin
        .from("contract_reviews")
        .select("storage_path,assigned_to")
        .eq("id", id)
        .eq("org_id", auth.orgId)
        .single()

    const { data, error } = await admin
        .from("contract_reviews")
        .update(updates)
        .eq("id", id)
        .eq("org_id", auth.orgId)
        .select()
        .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Slet fil fra storage når status sættes til afsluttet
    if (body.status === "afsluttet" && existing?.storage_path) {
        try {
            const adminSupabase = createAdminClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!
            )
            await adminSupabase.storage
                .from("contract-reviews")
                .remove([existing.storage_path])

            await admin
                .from("contract_reviews")
                .update({ storage_path: null })
                .eq("id", id)
        } catch {
            // Logfejl men returner success — kontrakten er afsluttet
        }
    }

    return NextResponse.json({ data })
}
