import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdminApi } from "@/lib/api-auth"
import { ADMIN_ROLES } from "@/lib/admin-roles"
import { errorMessage } from "@/lib/error-message"

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

        const { contractId, employerId, contractType, overenskomst, rightsHolderId } = await req.json()
        if (!contractId) return NextResponse.json({ error: "contractId er påkrævet" }, { status: 400 })

        const supabase = sb()

        const { error } = await supabase.rpc("admin_validate_contract", {
            p_contract_id: contractId,
            p_status: "valideret",
            p_employer_id: employerId ?? null,
            p_type: contractType ?? null,
            p_overenskomst: overenskomst !== undefined ? (overenskomst ?? null) : null,
            p_rights_holder_id: rightsHolderId ?? null,
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })

        return NextResponse.json({ ok: true })
    } catch (e) {
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 })
    }
}
