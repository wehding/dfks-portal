/**
 * Shared server-side contract extraction. Input must already be masked.
 * Every character is processed: large documents are split at page boundaries
 * and merged deterministically instead of being cut after 40,000 characters.
 */

import { createClient } from "@supabase/supabase-js"
import { tjekNavn } from "@/lib/rettighedshaver-tjek"
import { normaliseSources } from "@/lib/ai-sources"
import { buildContractExtractionPrompt } from "@/lib/contract-extraction-prompt"
import { callAiDetailed } from "@/lib/ai-client"
import { getAiRuntimeConfig, type AiRuntimeConfig } from "@/lib/ai-runtime"
import { createAiUsageRun, finishAiUsageRun, type AiTokenUsage } from "@/lib/ai-usage"
import { detectPdfSignature } from "@/lib/pdf-signature-detection"
import { applyApprovedAgreementPension } from "@/lib/agreement-pension-server"
import {
    CONTRACT_EXTRACTION_MIN_TEXT_CHARS,
    CONTRACT_EXTRACTION_SCHEMA_VERSION,
    contractExtractionResponseSchema,
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
            process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

    const systemPrompt = await loadContractPrompt()
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
            }
        } catch (error) {
            extracted._signatureDetection = { ai: aiSignature, local: { status: "error" } }
            console.warn("[contract-extract] Lokal underskriftskontrol fejlede:", error instanceof Error ? error.message : "ukendt fejl")
        }
    }
    if (extracted._sources && typeof extracted._sources === "object") {
        extracted._sources = normaliseSources(extracted._sources as Record<string, string | null>)
    }

    try {
        const pension = await applyApprovedAgreementPension(extracted)
        extracted = pension.data
    } catch (error) {
        console.warn("[contract-extract] Pensionsregel kunne ikke anvendes:", error instanceof Error ? error.message : "ukendt fejl")
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
        try { navneTjek = await tjekNavn(String(extracted.rightsHolderName)) }
        catch (error) { console.warn("[contract-extract] Navnetjek fejlede:", error instanceof Error ? error.message : "ukendt fejl") }
    }

    await finishAiUsageRun(runId, "succeeded")
    return { ok: true, data: extracted, navneTjek, meta }
}
