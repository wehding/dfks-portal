/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy Supabase or external API payloads are normalized at this module boundary. */
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireSessionApi } from "@/lib/api-auth"
import { getSupabaseServiceKey } from "@/lib/env"
import { postgrestIlikePattern } from "@/lib/postgrest-search"

// GET /api/producers/search?q=<query>
// Søger i det kanoniske producentregister. Kun ordinære, aktive
// Producentforeningen-relationer regnes som overenskomstbindende — direkte
// ELLER via et moderselskab (underselskaber er bundet på lige fod med moderen).
export async function GET(req: NextRequest) {
    const auth = await requireSessionApi()
    if (!auth.ok) return auth.response
    const q = req.nextUrl.searchParams.get("q")?.trim()
    if (!q || q.length < 2) return NextResponse.json({ results: [] })

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        getSupabaseServiceKey()
    )

    const pattern = postgrestIlikePattern(q)
    if (!pattern) return NextResponse.json({ results: [] })

    const isProfMember = (relations: unknown): boolean =>
        Array.isArray(relations) &&
        relations.some((relation: any) =>
            relation?.source === "producentforeningen" &&
            relation?.membership_type === "member" &&
            relation?.is_active === true
        )

    const { data } = await supabase
        .from("employers")
        .select(`
            id,
            name,
            parent_id,
            employer_producer_types!left(source,membership_type,is_active)
        `)
        .ilike("name", pattern)
        .order("name")
        .limit(8)

    const rows = (data ?? []) as any[]

    // Slå moderselskaber op for de hits der ikke selv er direkte medlem
    const parentIds = [...new Set(
        rows
            .filter(e => e.parent_id && !isProfMember(e.employer_producer_types))
            .map(e => e.parent_id as string)
    )]

    const parentById = new Map<string, { name: string; member: boolean }>()
    if (parentIds.length) {
        const { data: parentRows } = await supabase
            .from("employers")
            .select(`id, name, employer_producer_types!left(source,membership_type,is_active)`)
            .in("id", parentIds)
        for (const p of (parentRows ?? []) as any[]) {
            parentById.set(p.id, { name: p.name, member: isProfMember(p.employer_producer_types) })
        }
    }

    const results = rows.map((e: any) => {
        const direct = isProfMember(e.employer_producer_types)
        const parent = e.parent_id ? parentById.get(e.parent_id) : undefined
        const viaParent = !direct && parent?.member === true
        return {
            id: e.id as string,
            name: e.name as string,
            isOverenskomstBound: direct || viaParent,
            ...(viaParent ? { boundViaParent: true, parentName: parent!.name } : {}),
        }
    })

    return NextResponse.json({ results })
}
