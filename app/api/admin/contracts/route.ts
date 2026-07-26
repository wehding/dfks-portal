import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { parseContractReviewDeleteIds } from "@/lib/contract-review-delete"

// GET /api/admin/contracts
// Query params: queue=mine|all, status=afventer,behandling, productionType=..., search=..., page=1, limit=20
export async function GET(req: NextRequest) {
    const sessionClient = await createClient()
    const caller = await assertAdminRole(sessionClient)
    if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })

    // Service role omgår RLS — admin-rute, ingen bruger-data-lækage
    const supabase = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const url = new URL(req.url)
    const queue = url.searchParams.get("queue") ?? "all"
    const statusParam = url.searchParams.get("status")
    const productionTypeParam = url.searchParams.get("productionType")
    const search = url.searchParams.get("search")?.trim()
    const page = parseInt(url.searchParams.get("page") ?? "1")
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 100)
    const offset = (page - 1) * limit

    let query = supabase
        .from("contract_reviews")
        .select("*", { count: "exact" })
        .eq("org_id", caller.orgId)
        .order("reviewed_at", { ascending: false })
        .range(offset, offset + limit - 1)

    if (queue === "mine") {
        query = query
            .eq("assigned_to", caller.userId)
            .in("status", ["afventer", "behandling"])
    }

    if (statusParam) {
        const statuses = statusParam.split(",").map(s => s.trim()).filter(Boolean)
        if (statuses.length > 0) query = query.in("status", statuses)
    }

    if (productionTypeParam) {
        const types = productionTypeParam.split(",").map(s => s.trim()).filter(Boolean)
        if (types.length > 0) query = query.in("production_type", types)
    }

    if (search) {
        query = query.or(
            `member_name.ilike.%${search}%,file_name.ilike.%${search}%,producer_name.ilike.%${search}%`
        )
    }

    const { data, error, count } = await query

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ data: data ?? [], count: count ?? 0, page, limit })
}

// DELETE /api/admin/contracts
// Sletter kun kontraktgennemgange og deres reviewfiler. En eventuelt koblet
// kontrakt i contracts-tabellen bevares altid.
export async function DELETE(req: NextRequest) {
    const sessionClient = await createClient()
    const caller = await assertAdminRole(sessionClient)
    if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })

    const body = await req.json().catch(() => null) as { ids?: unknown } | null
    const parsed = parseContractReviewDeleteIds(body?.ids)
    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: rows, error: rowsError } = await admin
        .from("contract_reviews")
        .select("id, storage_path")
        .eq("org_id", caller.orgId)
        .in("id", parsed.ids)
    if (rowsError) return NextResponse.json({ error: rowsError.message }, { status: 500 })

    const rowById = new Map((rows ?? []).map(row => [row.id, row]))
    const results = await Promise.all(parsed.ids.map(async id => {
        const row = rowById.get(id)
        if (!row) return { id, error: "Kontraktgennemgangen blev ikke fundet i organisationen" }

        if (row.storage_path) {
            const { error: storageError } = await admin.storage.from("contract-reviews").remove([row.storage_path])
            if (storageError) return { id, error: `Reviewfilen kunne ikke slettes: ${storageError.message}` }
        }

        const { data: deleted, error: deleteError } = await admin
            .from("contract_reviews")
            .delete()
            .eq("id", id)
            .eq("org_id", caller.orgId)
            .select("id")
            .maybeSingle()
        if (deleteError) return { id, error: deleteError.message }
        if (!deleted) return { id, error: "Kontraktgennemgangen kunne ikke slettes" }
        return { id, error: null }
    }))

    return NextResponse.json({
        deletedIds: results.filter(result => !result.error).map(result => result.id),
        failed: results.filter(result => result.error),
    })
}
