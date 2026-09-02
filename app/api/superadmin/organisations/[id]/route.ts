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

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const supabase = await createClient()
    const caller = await assertAdminRole(supabase, ["superadmin"])
    if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })

    const { id } = await params
    const body = await req.json()

    const allowed = ["name", "cvr", "contact_name", "contact_email", "plan", "max_users",
                     "module_contracts", "module_streaming", "module_archive", "active"]
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const key of allowed) {
        if (key in body) update[key] = body[key]
    }

    const admin = getAdmin()
    const { data, error } = await admin
        .from("organisations")
        .update(update)
        .eq("id", id)
        .select()
        .single()

    if (error) return NextResponse.json({ error: "Organisationen kunne ikke opdateres." }, { status: 500 })
    await recordSensitiveFlow({ actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" }, action: "update", component: "superadmin.organisations.update", entityType: "organisations", entityId: id, orgIds: [id], purposeCode: "platform_administration", legalBasis: "GDPR Art. 6(1)(f), 24 og 32", dataCategories: ["organisation_data", "contact_data", "access_control_metadata"] })
    return NextResponse.json(data)
}
