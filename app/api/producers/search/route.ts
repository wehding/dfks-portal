import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// GET /api/producers/search?q=<query>
// Søger i DFKS employers-tabel. Markerer om producenten er overenskomstbundet
// (dvs. har en aktiv gruppe-tilknytning i employer_registries).
export async function GET(req: NextRequest) {
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
            employer_registries!left(valid_to)
        `)
        .ilike("name", `%${q}%`)
        .order("name")
        .limit(8)

    const results = (data ?? []).map((e: any) => ({
        id: e.id as string,
        name: e.name as string,
        isOverenskomstBound: Array.isArray(e.employer_registries) &&
            e.employer_registries.some((r: any) => r.valid_to === null),
    }))

    return NextResponse.json({ results })
}
