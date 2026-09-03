/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy Supabase or external API payloads are normalized at this module boundary. */
import { createClient } from "@supabase/supabase-js"
import { getEmbedding, getEmbeddingWithFallback } from "./embedding-provider"
import { estimateEmbeddingTokens } from "./ai-cost"
import { recordAiUsage, type AiUsageContext } from "./ai-usage"
import { detectAgreementReferences } from "./agreement-detection"
import { getSupabaseServiceKey } from "./env"

const MATCH_THRESHOLD = 0.65
const MATCH_COUNT = 6

function getSupabaseAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        getSupabaseServiceKey()
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
    return detectAgreementReferences(tekst)
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
    orgId?: string,
    precomputedEmbedding?: number[]
): Promise<KnowledgeChunk[]> {
    const embedding = precomputedEmbedding ?? await getEmbeddingWithFallback(kontraktTekst)
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
    altid: { title: string; body: string; exclude_for_overenskomst: string[] }[]
    baggrund: { title: string; body: string; exclude_for_overenskomst: string[] }[]
    detekteredeOverenskomster: string[]
    aftaleGrundlag: AgreementGrounding[]
}

export interface AgreementGrounding {
    title: string
    sourceUrl: string | null
    validFrom: string | null
    validTo: string | null
    notes: string | null
    wages: Array<{
        professionRole: string
        wageGroup: string | null
        amount: number
        unit: string
        validFrom: string
        validTo: string | null
        sourceTitle: string
        sourceUrl: string
        sourceNote: string | null
    }>
    pensions: Array<{
        employmentForm: string
        employerPercent: number
        employeePercent: number
        basis: string
        validFrom: string
        validTo: string | null
        sectionReference: string
        sourceNote: string | null
    }>
}

async function hentStruktureretAftalegrundlag(
    overenskomster: string[],
    kontraktdato?: string | null,
): Promise<AgreementGrounding[]> {
    if (!overenskomster.length) return []

    const codeMap: Record<string, string[]> = {
        de4: ["de4-fiction-2022"],
        "faf-dokumentar": ["faf-documentary"],
        faf: ["faf-fiction-2025", "faf-tv-employee-2008", "faf-tv-freelance-2008"],
        "dj-tv": ["dj-tv-2024"],
        "dr-metal": ["dr-metal-2025"],
    }
    const codes = [...new Set(overenskomster.flatMap(ref => codeMap[ref] ?? []))]
    if (!codes.length) return []

    const supabase = getSupabaseAdmin()
    const { data: agreements, error: agreementError } = await supabase
        .from("agreements")
        .select("id,title,source_url,valid_from,valid_to,notes")
        .in("code", codes)
        .eq("status", "approved")
    if (agreementError || !agreements?.length) {
        if (agreementError) console.error("[retrieval] aftaleregister fejl:", agreementError)
        return []
    }

    const agreementIds = agreements.map(agreement => agreement.id)
    const [{ data: wages, error: wageError }, { data: pensions, error: pensionError }] = await Promise.all([
        supabase
            .from("agreement_wage_rules")
            .select("agreement_id,profession_role,wage_group,amount,unit,valid_from,valid_to,source_title,source_url,source_note")
            .in("agreement_id", agreementIds)
            .eq("status", "approved"),
        supabase
            .from("agreement_pension_rules")
            .select("agreement_id,employment_form,employer_percent,employee_percent,basis,valid_from,valid_to,section_reference,source_note")
            .in("agreement_id", agreementIds)
            .eq("status", "approved"),
    ])
    if (wageError) console.error("[retrieval] lønregler fejl:", wageError)
    if (pensionError) console.error("[retrieval] pensionsregler fejl:", pensionError)

    const isApplicableOnDate = (from: string, to: string | null) =>
        !kontraktdato || (from <= kontraktdato && (!to || to >= kontraktdato))

    return agreements.map(agreement => ({
        title: agreement.title,
        sourceUrl: agreement.source_url,
        validFrom: agreement.valid_from,
        validTo: agreement.valid_to,
        notes: agreement.notes,
        wages: (wages ?? [])
            .filter(rule => rule.agreement_id === agreement.id && rule.amount !== null && rule.unit && isApplicableOnDate(rule.valid_from, rule.valid_to))
            .map(rule => ({
                professionRole: rule.profession_role,
                wageGroup: rule.wage_group,
                amount: Number(rule.amount),
                unit: rule.unit!,
                validFrom: rule.valid_from,
                validTo: rule.valid_to,
                sourceTitle: rule.source_title,
                sourceUrl: rule.source_url,
                sourceNote: rule.source_note,
            })),
        pensions: (pensions ?? [])
            .filter(rule => rule.agreement_id === agreement.id && isApplicableOnDate(rule.valid_from, rule.valid_to))
            .map(rule => ({
                employmentForm: rule.employment_form,
                employerPercent: Number(rule.employer_percent),
                employeePercent: Number(rule.employee_percent),
                basis: rule.basis,
                validFrom: rule.valid_from,
                validTo: rule.valid_to,
                sectionReference: rule.section_reference,
                sourceNote: rule.source_note,
            })),
    }))
}

export async function hentKontekst(
    kontraktTekst: string,
    orgId?: string,
    usageContext?: AiUsageContext
): Promise<KontekstResultat> {
    const supabase = getSupabaseAdmin()
    const embeddingInput = kontraktTekst.slice(0, 8_000)
    const embeddingStartedAt = Date.now()
    let embedding: number[]
    try {
        embedding = await getEmbedding(embeddingInput, false)
        if ((process.env.EMBEDDING_PROVIDER || "google") === "google") {
            await recordAiUsage({
                context: usageContext,
                provider: "google",
                model: "gemini-embedding-001",
                usage: { inputTokens: estimateEmbeddingTokens(embeddingInput), outputTokens: 0 },
                inputChars: embeddingInput.length,
                latencyMs: Date.now() - embeddingStartedAt,
                status: "succeeded",
                usageEstimated: true,
            })
        }
    } catch (error) {
        if ((process.env.EMBEDDING_PROVIDER || "google") === "google") {
            await recordAiUsage({
                context: usageContext,
                provider: "google",
                model: "gemini-embedding-001",
                inputChars: embeddingInput.length,
                latencyMs: Date.now() - embeddingStartedAt,
                status: "failed",
                usageEstimated: true,
                errorCode: "embedding_failed",
            })
        }
        throw error
    }
    const detekterede = detekterOverenskomst(kontraktTekst)
    const kontraktdato = detekterKontraktdato(kontraktTekst)

    const [
        videnbase,
        kategorier,
        mønstreRes,
        altidRes,
        baggrundRes,
        aftaleGrundlag,
    ] = await Promise.all([
        // 1. Lovtekster — semantisk RAG
        hentRelevanteRegler(kontraktTekst, MATCH_COUNT, orgId, embedding),

        // 2. Overenskomst kategori-match — præcise satser, dato-baseret
        hentOverenskomstKategorier(detekterede, kontraktdato),

        // 3. Lærte mønstre — semantisk
        supabase.rpc("match_learned_patterns", {
            query_embedding: embedding,
            match_threshold: 0.65,
            match_count: 3,
            p_org_id: orgId,
        }),

        // 4. Altid-noteringer
        supabase.from("legal_notes").select("title, body, exclude_for_overenskomst").or(`org_id.is.null,org_id.eq.${orgId}`).eq("priority", "altid").eq("active", true),

        // 5. Baggrundsnoteringer
        supabase.from("legal_notes").select("title, body, exclude_for_overenskomst").or(`org_id.is.null,org_id.eq.${orgId}`).eq("priority", "baggrund").eq("active", true),

        // 6. Godkendte, strukturerede aftale-, løn- og pensionskilder
        hentStruktureretAftalegrundlag(detekterede, kontraktdato),
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
                    const embArray: number[] = Array.isArray(emb) ? emb : Object.values(emb as Record<string, number>)
                    const nb = Math.sqrt(embArray.reduce((s, v) => s + v * v, 0))
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
        altid: (altidRes.data ?? []) as KontekstResultat["altid"],
        baggrund: (baggrundRes.data ?? []) as KontekstResultat["baggrund"],
        detekteredeOverenskomster: detekterede,
        aftaleGrundlag,
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
    if (error) throw new Error("Knowledge chunk kunne ikke gemmes")
}

export async function deleteKnowledgeChunk(kildeId: string, orgId: string | null): Promise<void> {
    const supabase = getSupabaseAdmin()
    let query = supabase.from("knowledge_chunks").delete().eq("kilde_id", kildeId)
    query = orgId ? query.eq("org_id", orgId) : query.is("org_id", null)
    const { error } = await query
    if (error) throw new Error("Knowledge chunk kunne ikke slettes")
}
