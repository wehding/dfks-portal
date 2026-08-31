import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit"

function getAdmin() {
    return createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )
}

export async function GET() {
    const supabase = await createClient()
    const caller = await assertAdminRole(supabase, ["superadmin"])
    if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })

    const admin = getAdmin()

    const { data: orgs, error } = await admin
        .from("organisations")
        .select("*")
        .order("name")

    if (error) return NextResponse.json({ error: "Organisationerne kunne ikke hentes." }, { status: 500 })

    // Hent brugerantal per org
    const { data: roleCounts } = await admin
        .from("user_org_roles")
        .select("org_id")

    const countMap: Record<string, number> = {}
    for (const row of roleCounts ?? []) {
        countMap[row.org_id] = (countMap[row.org_id] ?? 0) + 1
    }

    const result = (orgs ?? []).map(org => ({
        ...org,
        user_count: countMap[org.id] ?? 0,
    }))

    await recordSensitiveFlow({ actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" }, action: "security_review", component: "superadmin.organisations.list", entityType: "organisations", orgIds: result.map(org => org.id), purposeCode: "platform_administration", legalBasis: "GDPR Art. 6(1)(f), 24 og 32", dataCategories: ["organisation_data", "access_control_metadata"], counts: { results: result.length } })

    return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
    const supabase = await createClient()
    const caller = await assertAdminRole(supabase, ["superadmin"])
    if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })

    const body = await req.json()
    const { name, cvr, contact_name, contact_email, plan, max_users, module_contracts, module_streaming, module_archive } = body

    if (!name || !cvr || !contact_name || !contact_email || !plan) {
        return NextResponse.json({ error: "Manglende påkrævede felter" }, { status: 400 })
    }

    const admin = getAdmin()
    const { data, error } = await admin
        .from("organisations")
        .insert({
            name,
            cvr,
            contact_name,
            contact_email,
            plan,
            max_users: max_users ?? planDefaults(plan).max_users,
            module_contracts: module_contracts ?? planDefaults(plan).module_contracts,
            module_streaming: module_streaming ?? planDefaults(plan).module_streaming,
            module_archive: module_archive ?? planDefaults(plan).module_archive,
            active: true,
        })
        .select()
        .single()

    if (error) return NextResponse.json({ error: "Organisationen kunne ikke oprettes." }, { status: 500 })
    await recordSensitiveFlow({ actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" }, action: "create", component: "superadmin.organisations.create", entityType: "organisations", entityId: data.id, orgIds: [data.id], purposeCode: "platform_administration", legalBasis: "GDPR Art. 6(1)(f), 24 og 32", dataCategories: ["organisation_data", "contact_data", "access_control_metadata"] })
    return NextResponse.json(data, { status: 201 })
}

function planDefaults(plan: string) {
    switch (plan) {
        case "enterprise": return { max_users: -1, module_contracts: true, module_streaming: true, module_archive: true }
        case "pro":        return { max_users: 20, module_contracts: true, module_streaming: true, module_archive: false }
        default:           return { max_users: 5,  module_contracts: true, module_streaming: false, module_archive: false }
    }
}
