/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy Supabase or external API payloads are normalized at this module boundary. */
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireSessionApi } from "@/lib/api-auth"

// GET /api/producers/search?q=<query>
// Søger i det kanoniske producentregister. Kun ordinære, aktive
// Producentforeningen-relationer regnes som overenskomstbindende.
export async function GET(req: NextRequest) {
    const auth = await requireSessionApi()
    if (!auth.ok) return auth.response
    const q = req.nextUrl.searchParams.get("q")?.trim()
    if (!q || q.length < 2) return NextResponse.json({ results: [] })

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data } = await supabase
        .from("employers")
        .select(`
            id,
            name,
            employer_producer_types!left(source,membership_type,is_active)
        `)
        .ilike("name", `%${q}%`)
        .order("name")
        .limit(8)

    const results = (data ?? []).map((e: any) => ({
        id: e.id as string,
        name: e.name as string,
        isOverenskomstBound: Array.isArray(e.employer_producer_types) &&
            e.employer_producer_types.some((relation: any) =>
                relation.source === "producentforeningen" &&
                relation.membership_type === "member" &&
                relation.is_active === true
            ),
    }))

    return NextResponse.json({ results })
}
