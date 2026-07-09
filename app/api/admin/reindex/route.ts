import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getEmbedding } from "@/lib/embedding-provider"

function sb() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}

export async function POST() {
    const supabase = sb()

    const { data: chunks, error } = await supabase
        .from("knowledge_chunks")
        .select("kilde_id, tekst, metadata, sidst_opdateret")
        .order("kilde_id")

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!chunks?.length) return NextResponse.json({ opdateret: 0, uændret: 0, fejl: 0 })

    let opdateret = 0, fejl = 0
    const uændret = 0

    for (const chunk of chunks) {
        try {
            // Byg den tekst der skal embeddes: semantisk_beskrivelse + evt. dfks_fortolkning
            const fortolkning = (chunk.metadata as any)?.dfks_fortolkning
            const tekstTilEmbedding = [
                chunk.tekst,
                fortolkning ? `DFKS fortolkning: ${fortolkning}` : "",
            ].filter(Boolean).join(" ")

            const embedding = await getEmbedding(tekstTilEmbedding, true)

            const { error: updateErr } = await supabase
                .from("knowledge_chunks")
                .update({ embedding, sidst_opdateret: new Date().toISOString() })
                .eq("kilde_id", chunk.kilde_id)

            if (updateErr) { fejl++; continue }
            opdateret++
        } catch {
            fejl++
        }

        // Undgå rate limiting
        await new Promise(r => setTimeout(r, 100))
    }

    return NextResponse.json({ opdateret, uændret, fejl })
}

// Vercel cron: kald med GET (cron jobs bruger GET)
export async function GET() {
    return POST()
}
