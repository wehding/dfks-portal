/**
 * Shared server-side contract extraction. Input must already be masked.
 * Every character is processed: large documents are split at page boundaries
 * and merged deterministically instead of being cut after 40,000 characters.
 */

import { createClient } from "@supabase/supabase-js"
import { getSupabaseServiceKey } from "@/lib/env"
import { tjekNavn } from "@/lib/rettighedshaver-tjek"
import { normaliseSources, extractClauseIdFromCitation, stripClauseIdPrefix } from "@/lib/ai-sources"
import { resolveOtherSupplements } from "@/lib/contract-supplements"
import { resolvePensionSupplement } from "@/lib/contract-pension"
import { resolveContractCredit } from "@/lib/contract-credit"
import { resolveContractSalary } from "@/lib/contract-salary"
import { buildContractExtractionPrompt } from "@/lib/contract-extraction-prompt"
import { callAiDetailed } from "@/lib/ai-client"
import { getAiRuntimeConfig, type AiRuntimeConfig } from "@/lib/ai-runtime"
import { createAiUsageRun, finishAiUsageRun, type AiTokenUsage } from "@/lib/ai-usage"
import { detectPdfSignature } from "@/lib/pdf-signature-detection"
import { applyApprovedAgreementPension } from "@/lib/agreement-pension-server"
import { applyApprovedAgreementRoyalty } from "@/lib/agreement-royalty-server"
import { applyApprovedHolidayPay, applyApprovedBetaContribution, applyApprovedCopydan } from "@/lib/agreement-percentage-rule-server"
import { getAgreementSatserForContext } from "@/lib/agreement-wage-server"
import { resolveAgreementByDate, toShortCode } from "@/lib/agreement-version-resolver"
import {
    CONTRACT_EXTRACTION_MIN_TEXT_CHARS,
    CONTRACT_EXTRACTION_SCHEMA_VERSION,
    contractExtractionResponseSchema,
    hasUsableContractExtraction,
    mergeContractExtractionChunks,
    normalizeContractExtraction,
    splitContractTextForExtraction,
} from "@/lib/contract-extraction-schema"
import { CONTRACT_IMPORT_PROMPT_VERSION, ContractImportPipelineError } from "@/lib/contract-import-job"

export type ContractExtractionMetadata = {
    provider: string
    model: string
    promptVersion: string
    schemaVersion: string
    providerRequestId: string | null
    inputTokens: number
    outputTokens: number
    chunkCount: number
    usageRunId: string | null
}

export type ContractExtractionResult = {
    ok: boolean
    data?: Record<string, unknown>
    navneTjek?: unknown
    meta?: ContractExtractionMetadata
    error?: string
    errorCause?: unknown
}

export type ContractExtractionContext = {
    orgId?: string | null
    entityId?: string | null
    actorUserId?: string | null
    source?: "portal" | "admin" | "api" | "cron" | "import"
    pdfBuffer?: Buffer | null
    layout?: import("@/lib/contract-layout").ContractLayout | null
    runtimeConfig?: AiRuntimeConfig | null
    promptVersion?: string
    schemaVersion?: string
    onProgress?: (() => Promise<void>) | null
}

function addUsage(total: AiTokenUsage, current: AiTokenUsage) {
    total.inputTokens += Number(current.inputTokens ?? 0)
    total.outputTokens += Number(current.outputTokens ?? 0)
    total.cacheWriteTokens = Number(total.cacheWriteTokens ?? 0) + Number(current.cacheWriteTokens ?? 0)
    total.cacheReadTokens = Number(total.cacheReadTokens ?? 0) + Number(current.cacheReadTokens ?? 0)
}

function parseStructuredExtraction(raw: string) {
    try {
        return normalizeContractExtraction(JSON.parse(raw))
    } catch {
        const fallback = raw.match(/\{[\s\S]*\}/)?.[0]
        if (fallback) {
            try { return normalizeContractExtraction(JSON.parse(fallback)) } catch { /* handled below */ }
        }
        throw new ContractImportPipelineError({
            message: "AI-svaret var ikke gyldig JSON",
            code: "invalid_json",
            failureClass: "invalid_output",
        })
    }
}

async function loadContractPrompt() {
    let systemPrompt = buildContractExtractionPrompt()
    try {
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            getSupabaseServiceKey(),
            { auth: { autoRefreshToken: false, persistSession: false } }
        )
        const { data: refDocs } = await supabase
            .from("reference_docs")
            .select("title, doc_subtype, content_text")
            .eq("archived", false)
            .not("content_text", "is", null)
        systemPrompt = buildContractExtractionPrompt(refDocs ?? undefined)
    } catch (error) {
        console.warn("[contract-extract] Referencedokumenter kunne ikke hentes:", error instanceof Error ? error.message : "ukendt fejl")
    }
    return systemPrompt
}

export async function runContractExtraction(maskedText: string, context: ContractExtractionContext = {}): Promise<ContractExtractionResult> {
    const chunks = splitContractTextForExtraction(maskedText)
    if (!chunks.length || maskedText.replace(/\s/g, "").length < CONTRACT_EXTRACTION_MIN_TEXT_CHARS) {
        const cause = new ContractImportPipelineError({
            message: "Kontrakten indeholder ikke nok læsbar tekst",
            code: "insufficient_text",
            failureClass: "input",
        })
        return { ok: false, error: cause.message, errorCause: cause }
    }

    const config = context.runtimeConfig ?? await getAiRuntimeConfig("contract_extraction")
    const promptVersion = context.promptVersion ?? CONTRACT_IMPORT_PROMPT_VERSION
    const schemaVersion = context.schemaVersion ?? CONTRACT_EXTRACTION_SCHEMA_VERSION
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

overenskomst: ${overenskomstListe}
VIGTIGT: Flere overenskomster hedder begge "Fiktionsoverenskomsten" (fx både De4's og FAF's), men er indgået mellem forskellige parter. Afgør IKKE kun ud fra ordet "fiktion" — læs hvilken organisation overenskomsten konkret er indgået mellem Producentforeningen og (typisk angivet i overskriften, fx "Overenskomst mellem Producentforeningen og FAF" eller "...og De4"), og match derefter det korrekte id. "de4-fiktion" kræver at De4 (Dansk Filmfotograf Forbund/Dansk Filmklipperselskab/Danske Scenografer/Dansk Journalistforbund) er den navngivne modpart — ikke blot at ordet "fiktion" indgår.
VIGTIGT: Ældre eller mere formelle kontraktskabeloner bruger ofte organisationens FULDE, formelle navn i stedet for den moderne forkortelse — genkend disse som samme organisation, ikke som en ukendt tredjepart: FAF = "Film- og TV-Arbejderforeningen"; "Kort- og dokumentarfilmoverenskomsten mellem Film- og TV-arbejderforeningen og Danske Film- og TV-Producenter" er FAF's dokumentar-overenskomst (samme som "faf-dokumentar"), uanset at ordet "FAF" ikke nævnes eksplicit. Anvend samme princip generelt — match på den navngivne organisations fulde, formelle navn, ikke kun på en genkendt forkortelse.
Returner "ingen" hvis kontrakten eksplicit afviser overenskomst. Returner "ukendt" hvis uklart eller ingen match.
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

    // Trin 1.5: Hent overenskomstsatser til injektion i Trin 2's prompt
    let agreementSatserForPrompt: { agreementCode: string; satser: Array<{ beskrivelse: string; vaerdi: number; enhed: string }> } | null = null
    if (detectedOverenskomst && detectedOverenskomst !== "ingen" && detectedOverenskomst !== "ukendt") {
        try {
            const versionResult = await resolveAgreementByDate(detectedOverenskomst, detectedContractDate)
            if (versionResult.found && versionResult.code) {
                const satser = await getAgreementSatserForContext(versionResult.code)
                if (satser.length > 0) {
                    agreementSatserForPrompt = { agreementCode: versionResult.code, satser }
                    console.log("[contract-extract] satser hentet til prompt:", { code: versionResult.code, antal: satser.length })
                }
            }
        } catch (e) {
            console.warn("[contract-extract] Kunne ikke hente satser til prompt:", e)
        }
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
            // Dato-bevidst opslag: find den overenskomstversion der var gyldig på kontraktdatoen.
            const versionResult = await resolveAgreementByDate(detectedOverenskomst, detectedContractDate)
            if (versionResult.found) {
                // Hent agreements.id til direkte kobling mod knowledge_chunks.agreement_id
                const { data: agrRow } = await supabaseForIds
                    .from("agreements")
                    .select("id")
                    .eq("code", versionResult.code)
                    .maybeSingle()
                if (agrRow?.id) {
                    overenskomstQuery = overenskomstQuery.eq("agreement_id", agrRow.id)
                } else {
                    overenskomstQuery = overenskomstQuery.eq("overenskomst", detectedOverenskomst)
                }
            } else {
                // Ingen dækkende version fundet — søg direkte på klassifikator-id'et
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
        systemPrompt = buildContractExtractionPrompt(refDocs ?? undefined, overenskomstChunks ?? undefined, context.layout ?? undefined, agreementSatserForPrompt ?? undefined)
    } catch (e) {
        console.warn("[contract-extract] Kunne ikke hente reference docs:", e)
    }

    const extractedChunks: Record<string, unknown>[] = []
    const usage: AiTokenUsage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 }
    let providerRequestId: string | null = null

    try {
        for (let index = 0; index < chunks.length; index += 1) {
            await context.onProgress?.()
            const response = await callAiDetailed({
                provider: config.provider,
                model: config.model,
                maxTokens: 4096,
                system: systemPrompt,
                userMessage: chunks.length === 1
                    ? `---KONTRAKT---\n${chunks[index]}`
                    : `---KONTRAKT, DEL ${index + 1} AF ${chunks.length}---\nUdtræk kun oplysninger, der fremgår af denne del.\n${chunks[index]}`,
                responseJson: true,
                responseSchema: contractExtractionResponseSchema(config.provider),
                promptCaching: config.promptCachingEnabled,
                usageContext: { runId, orgId: context.orgId, useCase: "contract_extraction", stage: "extraction" },
            })
            providerRequestId = response.providerRequestId ?? providerRequestId
            addUsage(usage, response.usage)
            extractedChunks.push(parseStructuredExtraction(response.text))
            await context.onProgress?.()
        }
    } catch (error) {
        await finishAiUsageRun(runId, "failed", error instanceof ContractImportPipelineError ? error.code : "provider_error")
        return { ok: false, error: error instanceof Error ? error.message : "AI-aflæsning fejlede", errorCause: error }
    }

    let extracted = mergeContractExtractionChunks(extractedChunks)

    // Normalisér overenskomst til kanonisk short_code — AI kan returnere gamle
    // kortformer som "faf" eller "de4"; UI-dropdownen forventer "faf-fiktion"/"de4-fiktion".
    if (extracted.overenskomst && extracted.overenskomst !== "ingen" && extracted.overenskomst !== "ukendt") {
        const canonical = toShortCode(extracted.overenskomst as string)
        if (canonical) extracted = { ...extracted, overenskomst: canonical }
    }

    if (!hasUsableContractExtraction(extracted)) {
        const cause = new ContractImportPipelineError({
            message: "AI fandt ingen genkendelige kontraktoplysninger",
            code: "no_usable_contract_data",
            failureClass: "invalid_output",
        })
        await finishAiUsageRun(runId, "failed", cause.code)
        return { ok: false, error: cause.message, errorCause: cause }
    }
    const aiSignature = {
        status: extracted.signatureStatus ?? "unknown",
        method: extracted.signatureMethod ?? "unknown",
        page: extracted.signaturePage ?? null,
    }
    if (context.pdfBuffer) {
        try {
            const signature = await detectPdfSignature(context.pdfBuffer)
            extracted._signatureDetection = { ai: aiSignature, local: signature }
            if (signature.status === "yes") {
                extracted.signatureStatus = "yes"
                extracted.signatureMethod = signature.method
                extracted.signaturePage = signature.page
                extracted.signatureEvidence = signature.evidence
                // OCR-normaliserede PDF'er kan gøre en håndskrevet dato læsbar.
                // Bevar altid en dato, som AI allerede har fundet, og brug kun
                // den lokale dato som supplement.
                extracted.signatureDate ??= signature.date
            }
        } catch (error) {
            extracted._signatureDetection = { ai: aiSignature, local: { status: "error" } }
            console.warn("[contract-extract] Lokal underskriftskontrol fejlede:", error instanceof Error ? error.message : "ukendt fejl")
        }
    }
    if (extracted._sources && typeof extracted._sources === "object") {
        const knownIds = context.layout
            ? new Set(context.layout.clauses.map(c => c.id))
            : undefined
        extracted._sources = normaliseSources(extracted._sources as Record<string, string | null>, knownIds)
    }
    const credit = resolveContractCredit(extracted, maskedText)
    if (credit.creditedRoles || credit.sourceText) {
        extracted.creditedRoles = credit.creditedRoles
        extracted._sources = {
            ...((extracted._sources as Record<string, unknown> | null) ?? {}),
            creditedRoles: credit.sourceText,
            creditedRoles_clause_id: credit.clauseId,
        }
    }
    extracted = resolveContractSalary(extracted)
    extracted.pensionSupplement = resolvePensionSupplement(extracted)
    extracted.otherSupplements = resolveOtherSupplements(extracted)
    // Strip [sX_cY]-tag fra otherSupplements[].sourceText og gem clauseId pr. post
    if (Array.isArray(extracted.otherSupplements)) {
        extracted = {
            ...extracted,
            otherSupplements: (extracted.otherSupplements as Array<Record<string, unknown>>).map(s => ({
                ...s,
                clauseId: extractClauseIdFromCitation(s.sourceText as string | null) ?? s.clauseId ?? null,
                sourceText: stripClauseIdPrefix(s.sourceText as string | null),
            })),
        }
    }

    try {
        const pension = await applyApprovedAgreementPension(extracted)
        extracted = pension.data
    } catch (error) {
        console.warn("[contract-extract] Pensionsregel kunne ikke anvendes:", error instanceof Error ? error.message : "ukendt fejl")
    }

    try {
        const royalty = await applyApprovedAgreementRoyalty(extracted)
        extracted = royalty.data
        // Persistér reason, så UI kan vise årsag til "fra" — herunder "not_found" når alle trin er gennemgået
        if (!royalty.data.royalty && !royalty.data.royaltySourceType) {
            extracted = {
                ...extracted,
                royaltySourceType: "not_found",
                royaltyResolutionReason: royalty.reason,
            }
        }
    } catch (error) {
        console.warn("[contract-extract] Royaltyregel kunne ikke anvendes:", error instanceof Error ? error.message : "ukendt fejl")
    }

    try {
        const holidayPay = await applyApprovedHolidayPay(extracted)
        extracted = holidayPay.data
    } catch (error) {
        console.warn("[contract-extract] Helligdagsbetalingsregel kunne ikke anvendes:", error instanceof Error ? error.message : "ukendt fejl")
    }

    try {
        const beta = await applyApprovedBetaContribution(extracted)
        extracted = beta.data
    } catch (error) {
        console.warn("[contract-extract] BETA-fondsregel kunne ikke anvendes:", error instanceof Error ? error.message : "ukendt fejl")
    }

    try {
        const copydan = await applyApprovedCopydan(extracted)
        extracted = copydan.data
    } catch (error) {
        console.warn("[contract-extract] Copydan-regel kunne ikke anvendes:", error instanceof Error ? error.message : "ukendt fejl")
    }

    const meta: ContractExtractionMetadata = {
        provider: config.provider,
        model: config.model,
        promptVersion,
        schemaVersion,
        providerRequestId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        chunkCount: chunks.length,
        usageRunId: runId,
    }
    extracted._extractionMeta = meta

    let navneTjek: unknown = null
    if (extracted.rightsHolderName) {
        try { navneTjek = await tjekNavn(String(extracted.rightsHolderName), undefined, context.orgId) }
        catch (error) { console.warn("[contract-extract] Navnetjek fejlede:", error instanceof Error ? error.message : "ukendt fejl") }
    }

    await finishAiUsageRun(runId, "succeeded")
    return { ok: true, data: extracted, navneTjek, meta }
}
