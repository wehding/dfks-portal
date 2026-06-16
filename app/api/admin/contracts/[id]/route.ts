import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"

// GET /api/admin/contracts/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 })

    // Service role — omgår RLS (admin-brugere er ikke i user_org_roles)
    const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data, error } = await admin
        .from("contract_reviews")
        .select("*")
        .eq("id", id)
        .single()

    if (error || !data) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 })

    return NextResponse.json({ data })
}

// PATCH /api/admin/contracts/[id]
// Body: { status?: string, assignedTo?: string }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 })

    // Service role — omgår RLS
    const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const body = await req.json()
    const updates: Record<string, unknown> = {}

    if (body.status) updates.status = body.status
    if (body.assignedTo !== undefined) updates.assigned_to = body.assignedTo || null
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
        .select("storage_path")
        .eq("id", id)
        .single()

    const { data, error } = await admin
        .from("contract_reviews")
        .update(updates)
        .eq("id", id)
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
