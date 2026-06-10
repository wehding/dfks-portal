import { createClient } from "@supabase/supabase-js"
import { getEmbedding, getEmbeddingWithFallback } from "./embedding-provider"

const MATCH_THRESHOLD = 0.65
const MATCH_COUNT = 6

function getSupabaseAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
}

export interface KnowledgeChunk {
    kilde_id: string
    kilde_titel: string
    tekst: string
    metadata: {
        roede_flag?: string[]
        dfks_fortolkning?: string
        standard_formulering?: string
        [key: string]: unknown
    }
    similaritet: number
}

export async function hentRelevanteRegler(
    kontraktTekst: string,
    maxResultater = MATCH_COUNT,
    orgId?: string
): Promise<KnowledgeChunk[]> {
    const embedding = await getEmbeddingWithFallback(kontraktTekst)
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase.rpc("match_knowledge_chunks", {
        query_embedding: embedding,
        match_threshold: MATCH_THRESHOLD,
        match_count: maxResultater,
        p_org_id: orgId ?? null,
    })

    if (error) {
        console.error("[retrieval] match_knowledge_chunks fejl:", error)
        return []
    }

    return (data ?? []) as KnowledgeChunk[]
}

export async function upsertKnowledgeChunk(params: {
    kilde_id: string
    kilde_type: string
    kilde_titel: string
    tekst: string
    org_id: string | null
    metadata?: Record<string, unknown>
}): Promise<void> {
    const embedding = await getEmbedding(params.tekst, true)
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

export async function deleteKnowledgeChunk(kildeId: string): Promise<void> {
    const supabase = getSupabaseAdmin()
    await supabase.from("knowledge_chunks").delete().eq("kilde_id", kildeId)
}
