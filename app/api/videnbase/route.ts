import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getEmbedding } from "@/lib/embedding-provider"

function getSupabase() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}

export async function GET() {
    const supabase = getSupabase()
    const { data, error } = await supabase
        .from("knowledge_chunks")
        .select("kilde_id, kilde_titel, tekst, metadata, kilde_type, sidst_opdateret")
        .order("kilde_id")
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
    const { kilde_id, dfks_fortolkning } = await req.json()
    if (!kilde_id) return NextResponse.json({ error: "kilde_id mangler" }, { status: 400 })

    const supabase = getSupabase()

    // Hent eksisterende chunk
    const { data: chunk, error: fetchErr } = await supabase
        .from("knowledge_chunks")
        .select("tekst, metadata")
        .eq("kilde_id", kilde_id)
        .single()
    if (fetchErr || !chunk) return NextResponse.json({ error: "Chunk ikke fundet" }, { status: 404 })

    // Opdatér metadata
    const nyMetadata = { ...(chunk.metadata ?? {}), dfks_fortolkning: dfks_fortolkning || null }

    // Genindeksér: embed semantisk_beskrivelse + ny fortolkning
    const tekstTilEmbedding = [
        chunk.tekst,
        dfks_fortolkning ? `DFKS fortolkning: ${dfks_fortolkning}` : "",
    ].filter(Boolean).join(" ")

    const embedding = await getEmbedding(tekstTilEmbedding, true)

    const { error: updateErr } = await supabase
        .from("knowledge_chunks")
        .update({ metadata: nyMetadata, embedding })
        .eq("kilde_id", kilde_id)

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
    return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
    const body = await req.json()
    const { kilde_id, kilde_titel, tekst, kilde_type, dfks_fortolkning } = body
    if (!kilde_id || !kilde_titel || !tekst) {
        return NextResponse.json({ error: "kilde_id, kilde_titel og tekst er påkrævet" }, { status: 400 })
    }

    const supabase = getSupabase()

    const tekstTilEmbedding = [
        tekst,
        dfks_fortolkning ? `DFKS fortolkning: ${dfks_fortolkning}` : "",
    ].filter(Boolean).join(" ")

    const embedding = await getEmbedding(tekstTilEmbedding, true)

    const { error } = await supabase.from("knowledge_chunks").upsert({
        kilde_id,
        kilde_titel,
        tekst,
        kilde_type: kilde_type || "lovtekst",
        metadata: { dfks_fortolkning: dfks_fortolkning || null },
        embedding,
    }, { onConflict: "kilde_id" })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
}
