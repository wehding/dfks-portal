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
        sats?: string | null
        overenskomst?: string
        gyldig_fra?: string
        [key: string]: unknown
    }
    similaritet: number
    overenskomst?: string | null
    kategori?: string | null
}

// ── Detektér overenskomst-referencer i kontrakttekst ─────────

export function detekterOverenskomst(tekst: string): string[] {
    const refs: string[] = []
    if (/\bde[\s-]?4\b|de4.{0,10}overenskomst/i.test(tekst)) refs.push("de4")
    if (/\bfaf\b.*?(dokumentar|dok)/i.test(tekst)) refs.push("faf-dokumentar")
    else if (/\bfaf\b|faf.{0,10}overenskomst/i.test(tekst)) refs.push("faf")
    if (/create[\s-]?denmark/i.test(tekst) && !refs.length) refs.push("de4")
    return refs
}

// ── Detektér kontraktdato fra råtekst ─────────────────────────

export function detekterKontraktdato(tekst: string): string | null {
    // Prøv ISO-format: 2024-01-15
    const iso = tekst.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
    if (iso) return iso[0]
    // Prøv dansk format: 15. januar 2024 / 15/01/2024 / 15.01.2024
    const dansk = tekst.match(/\b(\d{1,2})[.\/](\d{1,2})[.\/](20\d{2})\b/)
    if (dansk) return `${dansk[3]}-${dansk[2].padStart(2, "0")}-${dansk[1].padStart(2, "0")}`
    // Prøv "dd. måned yyyy"
    const måneder: Record<string, string> = {
        januar:"01",februar:"02",marts:"03",april:"04",maj:"05",juni:"06",
        juli:"07",august:"08",september:"09",oktober:"10",november:"11",december:"12"
    }
    const lang = tekst.toLowerCase().match(/\b(\d{1,2})\.\s*(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\s+(20\d{2})\b/)
    if (lang) return `${lang[3]}-${måneder[lang[2]]}-${lang[1].padStart(2, "0")}`
    return null
}

// ── Hent overenskomst-chunks — dato-baseret matching ─────────

async function hentOverenskomstKategorier(
    overenskomster: string[],
    kontraktdato?: string | null
): Promise<KnowledgeChunk[]> {
    if (!overenskomster.length) return []
    const supabase = getSupabaseAdmin()

    let query = supabase
        .from("knowledge_chunks")
        .select("kilde_id, kilde_titel, tekst, metadata, overenskomst, kategori, gyldig_fra, aktiv")
        .in("overenskomst", overenskomster)
        .neq("kategori", "fuldt-dokument")
        .order("gyldig_fra", { ascending: false })

    if (kontraktdato) {
        // Hent alle versioner der var gyldig på kontraktdatoen
        query = query.lte("gyldig_fra", kontraktdato)
    } else {
        // Ingen dato — brug kun aktive
        query = query.eq("aktiv", true)
    }

    const { data, error } = await query
    if (error) console.error("[retrieval] hentOverenskomstKategorier fejl:", error)

    if (!kontraktdato || !data?.length) {
        return (data ?? []).map(d => ({ ...d, similaritet: 1 })) as KnowledgeChunk[]
    }

    // Vælg nyeste version per overenskomst der var gyldig på kontraktdatoen
    const bedsteVersion: Record<string, string> = {}
    for (const c of data) {
        const key = c.overenskomst!
        if (!bedsteVersion[key] || c.gyldig_fra > bedsteVersion[key]) {
            bedsteVersion[key] = c.gyldig_fra
        }
    }

    return data
        .filter(c => bedsteVersion[c.overenskomst!] === c.gyldig_fra)
        .map(d => ({ ...d, similaritet: 1 })) as KnowledgeChunk[]
}

// ── Semantisk RAG — lovtekster ────────────────────────────────

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

    // Filtrér overenskomst-chunks fra (håndteres separat)
    return ((data ?? []) as KnowledgeChunk[]).filter(c => !c.overenskomst)
}

// ── Samlet kontekst — bruges af /api/gennemgang ───────────────

export interface KontekstResultat {
    videnbase: KnowledgeChunk[]
    kategorier: KnowledgeChunk[]
    overenskomstSemantisk: KnowledgeChunk[]
    mønstre: { id: string; titel: string; regel: string; semantisk_beskrivelse: string; similaritet: number }[]
    altid: { title: string; body: string }[]
    baggrund: { title: string; body: string }[]
    detekteredeOverenskomster: string[]
}

export async function hentKontekst(kontraktTekst: string, orgId?: string): Promise<KontekstResultat> {
    const supabase = getSupabaseAdmin()
    const embedding = await getEmbedding(kontraktTekst, false)
    const detekterede = detekterOverenskomst(kontraktTekst)
    const kontraktdato = detekterKontraktdato(kontraktTekst)

    const [
        videnbase,
        kategorier,
        mønstreRes,
        altidRes,
        baggrundRes,
    ] = await Promise.all([
        // 1. Lovtekster — semantisk RAG
        hentRelevanteRegler(kontraktTekst, MATCH_COUNT, orgId),

        // 2. Overenskomst kategori-match — præcise satser, dato-baseret
        hentOverenskomstKategorier(detekterede, kontraktdato),

        // 3. Lærte mønstre — semantisk
        supabase.rpc("match_learned_patterns", {
            query_embedding: embedding,
            match_threshold: 0.65,
            match_count: 3,
        }),

        // 4. Altid-noteringer
        supabase.from("legal_notes").select("title, body").eq("priority", "altid").eq("active", true),

        // 5. Baggrundsnoteringer
        supabase.from("legal_notes").select("title, body").eq("priority", "baggrund").eq("active", true),
    ])

    // 6. Semantisk overenskomst-søgning i fuldt dokument (top 3)
    let overenskomstSemantisk: KnowledgeChunk[] = []
    if (detekterede.length > 0) {
        const { data } = await supabase
            .from("knowledge_chunks")
            .select("kilde_id, kilde_titel, tekst, metadata, overenskomst, kategori, embedding")
            .in("overenskomst", detekterede)
            .eq("kategori", "fuldt-dokument")
            .eq("aktiv", true)
            .limit(50) // hent kandidater til re-ranking

        // Beregn cosine similaritet og tag top 3
        if (data?.length) {
            const scored = data
                .map(c => {
                    const emb = (c as any).embedding as number[] | null
                    if (!emb) return null
                    const dot = embedding.reduce((s, v, i) => s + v * (emb[i] ?? 0), 0)
                    const na = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0))
                    const embArray = Array.isArray(emb) ? emb : Object.values(emb)
                    const nb = Math.sqrt(embArray.reduce((s: number, v: number) => s + v * v, 0))
                    return { ...c, similaritet: na && nb ? dot / (na * nb) : 0 }
                })
                .filter((c): c is NonNullable<typeof c> => c !== null && c.similaritet >= 0.5)
                .sort((a, b) => b.similaritet - a.similaritet)
                .slice(0, 3)
            overenskomstSemantisk = scored as KnowledgeChunk[]
        }
    }

    return {
        videnbase,
        kategorier,
        overenskomstSemantisk,
        mønstre: (mønstreRes.data ?? []) as KontekstResultat["mønstre"],
        altid: (altidRes.data ?? []) as { title: string; body: string }[],
        baggrund: (baggrundRes.data ?? []) as { title: string; body: string }[],
        detekteredeOverenskomster: detekterede,
    }
}

// ── Upsert / delete helpers ───────────────────────────────────

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
