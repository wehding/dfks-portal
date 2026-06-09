/**
 * lib/retrieval.ts
 *
 * RAG-baseret retrieval med Google text-embedding-004.
 * Bruges til at finde relevante sagserfaringer og juridiske noter
 * baseret på semantisk lighed med kontraktteksten.
 */

import { createClient } from "@supabase/supabase-js"

const MATCH_THRESHOLD = 0.65
const MATCH_COUNT = 8

function getSupabaseAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
}

/**
 * Laver et Google text-embedding-004 embedding via direkte REST-kald til v1 API.
 * SDK'et (v0.24) bruger v1beta som ikke understøtter text-embedding-004.
 */
export async function embedText(text: string): Promise<number[]> {
    const key = process.env.GOOGLE_API_KEY
    if (!key) throw new Error("GOOGLE_API_KEY mangler i miljøvariable")

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "models/gemini-embedding-001",
                content: { parts: [{ text: text.slice(0, 8000) }] },
                outputDimensionality: 768,   // Matryoshka: 768 dim < pgvector 2000-grænse
            }),
        }
    )
    if (!res.ok) {
        const err = await res.text()
        throw new Error(`Google Embedding API fejl ${res.status}: ${err}`)
    }
    const data = await res.json()
    return data.embedding.values
}

/**
 * Henter de mest relevante knowledge chunks for en given kontrakttekst.
 * Bruges i gennemgangs-ruten til at injicere kun relevante regler.
 */
export async function hentRelevanteRegler(kontraktTekst: string, orgId?: string): Promise<{
    kilde_id: string
    kilde_titel: string
    tekst: string
    metadata: Record<string, unknown>
    similaritet: number
}[]> {
    const embedding = await embedText(kontraktTekst)
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase.rpc("match_knowledge_chunks", {
        query_embedding: embedding,
        match_threshold: MATCH_THRESHOLD,
        match_count: MATCH_COUNT,
        p_org_id: orgId ?? null,
    })

    if (error) {
        console.error("[retrieval] match_knowledge_chunks fejl:", error)
        return []
    }

    return data ?? []
}

/**
 * Gemmer eller opdaterer et knowledge chunk med embedding.
 * Kaldes når en sagserfaring eller juridisk note gemmes/opdateres.
 */
export async function upsertKnowledgeChunk(params: {
    kilde_id: string        // fx sagserfaring UUID
    kilde_type: string      // "sagserfaring" | "juridisk-note"
    kilde_titel: string
    tekst: string           // den tekst der embeddes
    org_id: string | null
    metadata?: Record<string, unknown>
}): Promise<void> {
    const embedding = await embedText(params.tekst)
    const supabase = getSupabaseAdmin()

    const { error } = await supabase.from("knowledge_chunks").upsert({
        kilde_id: params.kilde_id,
        kilde_type: params.kilde_type,
        kilde_titel: params.kilde_titel,
        tekst: params.tekst,
        org_id: params.org_id,
        metadata: params.metadata ?? {},
        embedding,
    }, { onConflict: "kilde_id" })

    if (error) console.error("[retrieval] upsertKnowledgeChunk fejl:", error)
}

/**
 * Sletter et knowledge chunk når kilden slettes.
 */
export async function deleteKnowledgeChunk(kildeId: string): Promise<void> {
    const supabase = getSupabaseAdmin()
    await supabase.from("knowledge_chunks").delete().eq("kilde_id", kildeId)
}
