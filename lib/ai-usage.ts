import "server-only"

import { createServiceClient } from "@/lib/supabase/service"
import type { AiProvider, ContractAiUseCase } from "@/lib/ai-models"
import { calculateAiCost, normalizeAiTokenCount as safeCount, type AiTokenPrice as Price, type AiTokenUsage } from "@/lib/ai-cost"

export type { AiTokenUsage } from "@/lib/ai-cost"

export type AiUsageContext = {
    runId?: string | null
    orgId?: string | null
    useCase: ContractAiUseCase
    stage: "extraction" | "classification" | "advice" | "embedding" | "query"
}

const FALLBACK_PRICES: Record<string, Price> = {
    "anthropic/claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
    "google/gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cacheWrite: 0, cacheRead: 0.03 },
    "google/gemini-3.6-flash": { input: 1.5, output: 7.5, cacheWrite: 0, cacheRead: 0.15 },
    "google/gemini-embedding-001": { input: 0.15, output: 0, cacheWrite: 0, cacheRead: 0 },
}

async function loadPrice(provider: AiProvider, model: string): Promise<Price> {
    const fallback = FALLBACK_PRICES[`${provider}/${model}`] ?? { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }
    try {
        const db = createServiceClient()
        const today = new Date().toISOString().slice(0, 10)
        const { data } = await db.from("ai_model_prices")
            .select("input_usd_per_million,output_usd_per_million,cache_write_usd_per_million,cache_read_usd_per_million")
            .eq("provider", provider).eq("model", model).eq("pricing_mode", "standard")
            .lte("effective_from", today).or(`effective_to.is.null,effective_to.gte.${today}`)
            .order("effective_from", { ascending: false }).limit(1).maybeSingle()
        if (!data) return fallback
        return {
            input: Number(data.input_usd_per_million),
            output: Number(data.output_usd_per_million),
            cacheWrite: Number(data.cache_write_usd_per_million),
            cacheRead: Number(data.cache_read_usd_per_million),
        }
    } catch {
        return fallback
    }
}

async function loadUsdDkkRate() {
    const db = createServiceClient()
    const { data } = await db.from("ai_exchange_rates").select("rate_date,usd_dkk")
        .order("rate_date", { ascending: false }).limit(1).maybeSingle()
    const today = new Date().toISOString().slice(0, 10)
    if (data?.rate_date === today) return Number(data.usd_dkk)
    try {
        const response = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", {
            signal: AbortSignal.timeout(4_000),
            cache: "no-store",
        })
        if (!response.ok) throw new Error("ECB unavailable")
        const xml = await response.text()
        const usd = Number(xml.match(/currency=['\"]USD['\"]\s+rate=['\"]([0-9.]+)['\"]/)?.[1])
        const dkk = Number(xml.match(/currency=['\"]DKK['\"]\s+rate=['\"]([0-9.]+)['\"]/)?.[1])
        if (!usd || !dkk) throw new Error("ECB currencies missing")
        const rate = dkk / usd
        await db.from("ai_exchange_rates").upsert({ rate_date: today, usd_dkk: rate, source: "ECB" })
        return rate
    } catch {
        return data ? Number(data.usd_dkk) : null
    }
}

export async function createAiUsageRun(input: {
    orgId?: string | null
    operationType: ContractAiUseCase
    entityType?: string | null
    entityId?: string | null
    actorUserId?: string | null
    source?: "portal" | "admin" | "api" | "cron" | "import"
}) {
    try {
        const db = createServiceClient()
        const { data, error } = await db.from("ai_usage_runs").insert({
            org_id: input.orgId ?? null,
            operation_type: input.operationType,
            entity_type: input.entityType ?? null,
            entity_id: input.entityId ?? null,
            actor_user_id: input.actorUserId ?? null,
            source: input.source ?? "api",
        }).select("id").single()
        if (error) return null
        return data.id as string
    } catch {
        return null
    }
}

export async function finishAiUsageRun(runId: string | null | undefined, status: "succeeded" | "failed", errorCode?: string) {
    if (!runId) return
    try {
        await createServiceClient().from("ai_usage_runs").update({
            status,
            completed_at: new Date().toISOString(),
            error_code: errorCode?.slice(0, 100) ?? null,
        }).eq("id", runId)
    } catch { /* Telemetry must not replace the result of the business operation. */ }
}

export async function recordAiUsage(input: {
    context?: AiUsageContext
    provider: AiProvider
    model: string
    usage?: AiTokenUsage
    inputChars?: number
    outputChars?: number
    latencyMs?: number
    providerRequestId?: string | null
    status: "succeeded" | "failed"
    usageEstimated?: boolean
    errorCode?: string
}) {
    if (!input.context) return
    try {
        const usage = input.usage ?? { inputTokens: 0, outputTokens: 0 }
        const [price, usdDkkRate] = await Promise.all([loadPrice(input.provider, input.model), loadUsdDkkRate()])
        const costUsd = calculateAiCost(usage, price)
        await createServiceClient().from("ai_usage_events").insert({
            run_id: input.context.runId ?? null,
            org_id: input.context.orgId ?? null,
            use_case: input.context.useCase,
            stage: input.context.stage,
            provider: input.provider,
            model: input.model,
            input_tokens: safeCount(usage.inputTokens),
            output_tokens: safeCount(usage.outputTokens),
            thinking_tokens: safeCount(usage.thinkingTokens),
            cache_write_tokens: safeCount(usage.cacheWriteTokens),
            cache_read_tokens: safeCount(usage.cacheReadTokens),
            input_chars: safeCount(input.inputChars),
            output_chars: safeCount(input.outputChars),
            input_usd_per_million: price.input,
            output_usd_per_million: price.output,
            cache_write_usd_per_million: price.cacheWrite,
            cache_read_usd_per_million: price.cacheRead,
            usd_dkk_rate: usdDkkRate,
            cost_usd: costUsd,
            cost_dkk: usdDkkRate ? costUsd * usdDkkRate : null,
            latency_ms: safeCount(input.latencyMs),
            provider_request_id: input.providerRequestId?.slice(0, 200) ?? null,
            status: input.status,
            usage_estimated: input.usageEstimated === true,
            error_code: input.errorCode?.slice(0, 100) ?? null,
        })
    } catch { /* Usage logging is deliberately content-free and fail-open. */ }
}
