/**
 * lib/contract-extract-core.ts
 *
 * Kerne-logik for AI-kontraktudtræk. Kaldes både af API-ruterne
 * (contracts/extract, validate/extract) OG direkte server-side af
 * jobs/process — sidstnævnte uden HTTP-runde, så batch-udtrækket ikke
 * afhænger af en åben, uautentificeret /api-rute.
 *
 * Forudsætter at teksten allerede er maskeret (personoplysninger fjernet).
 */

import { createClient } from "@supabase/supabase-js"
import { tjekNavn } from "@/lib/rettighedshaver-tjek"
import { normaliseSources } from "@/lib/ai-sources"
import { buildContractExtractionPrompt } from "@/lib/contract-extraction-prompt"
import { callAiDetailed } from "@/lib/ai-client"
import { getAiRuntimeConfig } from "@/lib/ai-runtime"
import { createAiUsageRun, finishAiUsageRun } from "@/lib/ai-usage"
import { detectPdfSignature } from "@/lib/pdf-signature-detection"
import { applyApprovedAgreementPension } from "@/lib/agreement-pension-server"

export type ContractExtractionResult = {
    ok: boolean
    data?: Record<string, unknown>
    navneTjek?: unknown
    error?: string
}

// AI'en får kun de første CONTRACT_TEXT_LIMIT tegn. Længere kontrakter
// afkortes (rettighedsklausuler står ofte til sidst — se advarsel nedenfor).
const CONTRACT_TEXT_LIMIT = 40000

export type ContractExtractionContext = {
    orgId?: string | null
    entityId?: string | null
    actorUserId?: string | null
    source?: "portal" | "admin" | "api" | "cron" | "import"
    pdfBuffer?: Buffer | null
}

export async function runContractExtraction(maskedText: string, context: ContractExtractionContext = {}): Promise<ContractExtractionResult> {
    const config = await getAiRuntimeConfig("contract_extraction")
    const runId = await createAiUsageRun({
        orgId: context.orgId,
        operationType: "contract_extraction",
        entityType: "contract",
        entityId: context.entityId,
        actorUserId: context.actorUserId,
        source: context.source,
    })

    // Trin 0: Hent aktive overenskomst-IDs fra knowledge_chunks — bruges i klassifikatorens prompt
    // så klassifikatoren altid kender præcis de overenskomster der er indekseret i RAG'en.
    const supabaseForIds = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )
    let aktiveOverenskomstIds: string[] = []
    try {
        const { data: idRows } = await supabaseForIds
            .from("knowledge_chunks")
            .select("overenskomst")
            .eq("kilde_type", "overenskomst")
            .eq("aktiv", true)
            .not("overenskomst", "is", null)
            .neq("kategori", "fuldt-dokument")
        aktiveOverenskomstIds = [...new Set((idRows ?? []).map(r => r.overenskomst as string))]
    } catch {
        // Fallback — klassifikatoren returnerer "ukendt" og alle chunks hentes
    }
    const overenskomstListe = aktiveOverenskomstIds.length > 0
        ? `Tilgængelige overenskomst-id'er i videnbasen: ${aktiveOverenskomstIds.map(id => `"${id}"`).join(", ")}. Brug præcis ét af disse id'er.`
        : `Returner overenskomstens navn som et kortform-id med bindestreg (fx "de4-fiktion", "faf", "faf-dokumentar").`

    // Trin 1: Hurtig klassifikation — find overenskomst og kontraktdato uden at kende reglerne endnu
    let detectedOverenskomst: string | null = null
    let detectedContractDate: string | null = null
    try {
        const classifyResponse = await callAiDetailed({
            provider: config.provider,
            model: config.model,
            maxTokens: 256,
            system: `Du er en kontraktklassifikator. Læs kontrakten og returner KUN dette JSON-objekt uden forklaring:
{"overenskomst": "<overenskomst-id eller ingen eller ukendt>", "contractDate": "<YYYY-MM-DD eller null>"}

overenskomst: ${overenskomstListe} Returner "ingen" hvis kontrakten eksplicit afviser overenskomst. Returner "ukendt" hvis uklart eller ingen match.
contractDate: kontraktens underskriftsdato eller startdato, YYYY-MM-DD format.`,
            userMessage: `---KONTRAKT START---\n${maskedText.slice(0, 2000)}\n\n---KONTRAKT SLUT---\n${maskedText.slice(-1500)}`,
            responseJson: true,
        })
        const classifyMatch = classifyResponse.text.match(/\{[\s\S]*\}/)
        if (classifyMatch) {
            const c = JSON.parse(classifyMatch[0]) as { overenskomst?: string; contractDate?: string }
            detectedOverenskomst = c.overenskomst ?? null
            detectedContractDate = c.contractDate ?? null
        }
        console.log("[contract-extract] klassifikation:", { detectedOverenskomst, detectedContractDate, raw: classifyResponse.text.slice(0, 200) })
    } catch (e) {
        console.warn("[contract-extract] Klassifikation fejlede, fortsætter uden overenskomst-kontekst:", e)
    }

    // Trin 2: Hent reference docs + relevante overenskomst-chunks baseret på klassifikation
    let systemPrompt = buildContractExtractionPrompt()
    try {
        const supabase = supabaseForIds  // genbrug klienten fra Trin 0

        let overenskomstQuery = supabase
            .from("knowledge_chunks")
            .select("kilde_titel, tekst, overenskomst, kategori, gyldig_fra")
            .eq("kilde_type", "overenskomst")
            .neq("kategori", "fuldt-dokument")
            .neq("kategori", "lønskema")

        if (detectedOverenskomst && detectedOverenskomst !== "ingen" && detectedOverenskomst !== "ukendt") {
            // Slå agreement_id op via agreements.code — dækker både nye og migrerede chunks
            const { data: agrRow } = await supabaseForIds
                .from("agreements")
                .select("id")
                .eq("code", detectedOverenskomst)
                .maybeSingle()
            if (agrRow?.id) {
                overenskomstQuery = overenskomstQuery.eq("agreement_id", agrRow.id)
            } else {
                // Ingen agreements-række fundet — søg direkte på overenskomst-streng
                overenskomstQuery = overenskomstQuery.eq("overenskomst", detectedOverenskomst)
            }
        } else if (detectedOverenskomst === "ingen") {
            overenskomstQuery = overenskomstQuery.eq("overenskomst", "INGEN_MATCH")
        }

        if (detectedContractDate) {
            // Kun versioner der var gyldig på kontraktdatoen — nyeste version per kategori
            overenskomstQuery = overenskomstQuery.lte("gyldig_fra", detectedContractDate)
        }

        overenskomstQuery = overenskomstQuery.order("gyldig_fra", { ascending: false })

        const [{ data: refDocs }, { data: overenskomstChunks, error: chunksError }] = await Promise.all([
            supabase
                .from("reference_docs")
                .select("title, doc_subtype, content_text")
                .eq("archived", false)
                .not("content_text", "is", null),
            overenskomstQuery,
        ])
        console.log("[contract-extract] chunks hentet:", { count: overenskomstChunks?.length ?? 0, error: chunksError?.message ?? null, kategorier: overenskomstChunks?.map(c => c.kategori) })
        systemPrompt = buildContractExtractionPrompt(refDocs ?? undefined, overenskomstChunks ?? undefined)
    } catch (e) {
        console.warn("[contract-extract] Kunne ikke hente reference docs:", e)
    }

    let raw: string
    try {
        const response = await callAiDetailed({
            provider: config.provider,
            model: config.model,
            maxTokens: 4096,
            system: systemPrompt,
            userMessage: `---KONTRAKT---\n${maskedText.slice(0, CONTRACT_TEXT_LIMIT)}`,
            responseJson: true,
            promptCaching: config.promptCachingEnabled,
            usageContext: { runId, orgId: context.orgId, useCase: "contract_extraction", stage: "extraction" },
        })
        raw = response.text
    } catch (error) {
        await finishAiUsageRun(runId, "failed", error instanceof Error ? error.message : "provider_error")
        return { ok: false, error: error instanceof Error ? error.message : "AI-aflæsning fejlede" }
    }

    // Udtræk JSON mellem første { og sidste } (håndterer prose-wrapping)
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
        await finishAiUsageRun(runId, "failed", "invalid_json")
        return { ok: false, error: "Kunne ikke parse AI-svar" }
    }

    let extracted: Record<string, unknown>
    try {
        extracted = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    } catch {
        await finishAiUsageRun(runId, "failed", "invalid_json")
        return { ok: false, error: "Kunne ikke parse AI-svar" }
    }
    if (context.pdfBuffer) {
        try {
            const signature = await detectPdfSignature(context.pdfBuffer)
            if (signature.status === "yes") {
                extracted.signatureStatus = "yes"
                extracted.signatureMethod = signature.method
                extracted.signaturePage = signature.page
                extracted.signatureEvidence = signature.evidence
                extracted._signatureDetection = { method: signature.method, detectedLocally: true }
            }
        } catch (error) {
            console.warn("[contract-extract] Lokal underskriftskontrol fejlede:", error instanceof Error ? error.message : "ukendt fejl")
        }
    }
    if (extracted._sources && typeof extracted._sources === "object") {
        extracted._sources = normaliseSources(extracted._sources as Record<string, string | null>)
    }

    // AI'en udtrækker kun det, der står i kontrakten. En godkendt og
    // datofastsat regel anvendes deterministisk bagefter. Leverandør/B2B
    // er altid udelukket, også hvis kontrakten omtaler en overenskomst.
    try {
        const pension = await applyApprovedAgreementPension(extracted)
        extracted = pension.data
    } catch (error) {
        console.warn("[contract-extract] Pensionsregel kunne ikke anvendes:", error instanceof Error ? error.message : "ukendt fejl")
    }

    // Advar hvis kontrakten blev afkortet — rettighedsklausuler (Copydan/SVOD/
    // Create Denmark) står typisk til sidst og kan være klippet væk.
    if (maskedText.length > CONTRACT_TEXT_LIMIT) {
        extracted._truncated = true
        const advarsel = `⚠ ADVARSEL: Kontrakten er meget lang (${maskedText.length.toLocaleString("da-DK")} tegn) og blev afkortet til de første ${CONTRACT_TEXT_LIMIT.toLocaleString("da-DK")} tegn ved AI-læsning. Kontrollér især rettighedsklausuler til sidst i dokumentet.`
        extracted.specialNotes = extracted.specialNotes ? `${advarsel}\n${String(extracted.specialNotes)}` : advarsel
        console.warn(`[contract-extract] Kontrakt afkortet: ${maskedText.length} > ${CONTRACT_TEXT_LIMIT} tegn`)
    }

    // Navnetjek mod DFKS-register (kun full_name)
    let navneTjek: unknown = null
    if (extracted.rightsHolderName) {
        try {
            navneTjek = await tjekNavn(String(extracted.rightsHolderName))
        } catch (e) {
            console.warn("[contract-extract] Navnetjek fejlede:", e)
        }
    }

    await finishAiUsageRun(runId, "succeeded")
    return { ok: true, data: extracted, navneTjek }
}
