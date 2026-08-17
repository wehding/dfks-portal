import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdminApi } from "@/lib/api-auth"
import { errorMessage } from "@/lib/error-message"

function sb() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}

// GET /api/admin/overenskomst/chunks — hent indekserede sektioner for en overenskomst-version
export async function GET(req: NextRequest) {
    try {
        const auth = await requireAdminApi()
        if (!auth.ok) return auth.response

        const { searchParams } = new URL(req.url)
        const overenskomst = searchParams.get("overenskomst")
        const gyldigFra = searchParams.get("gyldigFra")
        if (!overenskomst || !gyldigFra) return NextResponse.json({ chunks: [] })

        const supabase = sb()

        const { data: agr } = await supabase.from("agreements").select("id").eq("code", overenskomst).maybeSingle()
        const agreement_id = agr?.id ?? null

        let query = supabase
            .from("knowledge_chunks")
            .select("kilde_id, kilde_titel, tekst, kategori")
            .eq("gyldig_fra", gyldigFra)
            .eq("kilde_type", "overenskomst")
            .neq("kategori", "fuldt-dokument")
            .order("kategori")

        query = agreement_id
            ? query.eq("agreement_id", agreement_id)
            : query.eq("overenskomst", overenskomst)

        const { data, error } = await query

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })

        const chunks = (data ?? []).map(c => ({
            id: c.kilde_id ?? "",
            titel: c.kilde_titel ?? "",
            tekst: c.tekst ?? "",
            kategori: c.kategori ?? "",
        }))

        return NextResponse.json({ chunks })
    } catch (e: unknown) {
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 })
    }
}
