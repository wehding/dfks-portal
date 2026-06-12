import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// GET /api/admin/contracts
// Query params: queue=mine|all, status=afventer,behandling, productionType=..., search=..., page=1, limit=20
export async function GET(req: NextRequest) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 })

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
        .order("reviewed_at", { ascending: false })
        .range(offset, offset + limit - 1)

    if (queue === "mine") {
        query = query
            .eq("assigned_to", user.id)
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
