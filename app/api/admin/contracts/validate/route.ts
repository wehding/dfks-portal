import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdminApi } from "@/lib/api-auth"
import { ADMIN_ROLES } from "@/lib/admin-roles"
import { errorMessage } from "@/lib/error-message"
import { auditRequestContext } from "@/lib/audit-access-server"
import { recordAuditEvent } from "@/lib/audit-log-server"

function sb() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )
}

export async function POST(req: NextRequest) {
    try {
        const auth = await requireAdminApi(ADMIN_ROLES)
        if (!auth.ok) return auth.response

        const { contractId, employerId, contractType, overenskomst } = await req.json()
        if (!contractId) return NextResponse.json({ error: "contractId er påkrævet" }, { status: 400 })

        const supabase = sb()

        // Scope and lock the owner source before the RPC. A client-provided
        // rights-holder id is never accepted by the validation endpoint.
        const { data: contract, error: contractError } = await supabase.from("contracts")
            .select("rights_holder_id")
            .eq("id", contractId)
            .eq("org_id", auth.orgId)
            .maybeSingle()
        if (contractError) return NextResponse.json({ error: contractError.message }, { status: 500 })
        if (!contract) return NextResponse.json({ error: "Kontrakten blev ikke fundet" }, { status: 404 })

        const { error } = await supabase.rpc("admin_validate_contract", {
            p_contract_id: contractId,
            p_status: "valideret",
            p_employer_id: employerId ?? null,
            p_type: contractType ?? null,
            p_overenskomst: overenskomst !== undefined ? (overenskomst ?? null) : null,
            p_rights_holder_id: contract.rights_holder_id,
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })

        await recordAuditEvent({
            context: auditRequestContext(req, auth, "admin", "admin.contracts.validate"),
            action: "validate",
            entityType: "contracts",
            entityId: contractId,
            entityLabel: "Kontrakt godkendt",
            targetMemberUuid: contract.rights_holder_id,
            purposeCode: "contract_case_management",
            legalBasis: "GDPR Art. 6(1)(b) og 6(1)(f)",
            dataCategories: ["contract_data", "salary_data"],
            orgIds: [auth.orgId],
        })

        return NextResponse.json({ ok: true })
    } catch (e) {
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 })
    }
}
