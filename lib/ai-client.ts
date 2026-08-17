/**
 * lib/ai-client.ts
 *
 * Unified server-side AI caller.
 * Understøtter Anthropic, OpenAI og Google Gemini med samme interface.
 * Bruges fra Next.js API routes — kører kun server-side.
 */

import { getApiKey } from "@/lib/ai-key-store"
import { recordAiUsage, type AiTokenUsage, type AiUsageContext } from "@/lib/ai-usage"
import { normalizeAnthropicUsage, normalizeGoogleUsage } from "@/lib/ai-cost"

const AI_REQUEST_TIMEOUT_MS = 240_000

export interface AiCallOptions {
    provider: string
    model: string
    system: string
    userMessage: string
    maxTokens?: number
    enableWebSearch?: boolean
    responseJson?: boolean
    responseSchema?: Record<string, unknown>
    promptCaching?: boolean
    usageContext?: AiUsageContext
    anthropicContent?: unknown[]
    googleParts?: unknown[]
}

export class AiProviderHttpError extends Error {
    readonly provider: string
    readonly status: number
    readonly code: string
    readonly retryAfterMs: number | null
    readonly failureClass: "configuration" | "billing" | "rate_limit" | "transient" | "input"

    constructor(input: {
        provider: string
        status: number
        code?: string | null
        retryAfterMs?: number | null
        failureClass: "configuration" | "billing" | "rate_limit" | "transient" | "input"
    }) {
        super(`${input.provider} API fejl: ${input.status}`)
        this.name = "AiProviderHttpError"
        this.provider = input.provider
        this.status = input.status
        this.code = input.code?.slice(0, 100) || `http_${input.status}`
        this.retryAfterMs = input.retryAfterMs ?? null
        this.failureClass = input.failureClass
    }
}

function retryAfterMs(headers: Headers) {
    const value = headers.get("retry-after")
    if (!value) return null
    const seconds = Number(value)
    if (Number.isFinite(seconds)) return Math.max(1_000, seconds * 1_000)
    const date = Date.parse(value)
    return Number.isFinite(date) ? Math.max(1_000, date - Date.now()) : null
}

async function providerError(provider: string, response: Response) {
    const payload = await response.json().catch(() => null) as { error?: { type?: string; code?: string; message?: string } } | null
    const providerCode = payload?.error?.type ?? payload?.error?.code ?? `http_${response.status}`
    const providerMessage = String(payload?.error?.message ?? "").toLocaleLowerCase("en")
    const failureClass = response.status === 401 || response.status === 403
        ? "configuration"
        : response.status === 402 || /credit|billing|payment/.test(providerMessage)
            ? "billing"
            : response.status === 429
                ? "rate_limit"
                : response.status >= 500
                    ? "transient"
                    : "input"
    return new AiProviderHttpError({
        provider,
        status: response.status,
        code: providerCode,
        retryAfterMs: retryAfterMs(response.headers),
        failureClass,
    })
}

export async function callAi(opts: AiCallOptions): Promise<string> {
    return (await callAiDetailed(opts)).text
}

export type AiCallResult = {
    text: string
    usage: AiTokenUsage
    providerRequestId: string | null
}

export async function callAiDetailed(opts: AiCallOptions): Promise<AiCallResult> {
    const { provider, model, system, userMessage, maxTokens = 4096, enableWebSearch = false } = opts

    switch (provider) {
        case "anthropic":
            return callAnthropic(model, system, userMessage, maxTokens, enableWebSearch, opts)
        case "openai":
            return callOpenAi(model, system, userMessage, maxTokens, opts)
        case "google":
            return callGoogle(model, system, userMessage, maxTokens, opts)
        default:
            throw new Error(`Ukendt AI-udbyder: ${provider}`)
    }
}

// ── Anthropic ─────────────────────────────────────────────────

async function callAnthropic(model: string, system: string, userMessage: string, maxTokens: number, enableWebSearch = false, opts?: AiCallOptions): Promise<AiCallResult> {
    const apiKey = getApiKey("anthropic")
    if (!apiKey) throw new Error("Anthropic API-nøgle mangler — sæt den i Stamdata → Indstillinger → API-nøgler")

    const ALLOWED = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"]
    const safeModel = ALLOWED.includes(model) ? model : "claude-sonnet-4-6"

    const headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        ...(enableWebSearch ? { "anthropic-beta": "web-search-2025-03-05" } : {}),
    }

    const tools = enableWebSearch
        ? [{ type: "web_search_20250305", name: "web_search" }]
        : undefined

    type ContentBlock = { type: string; text?: string; id?: string; name?: string; input?: unknown; content?: unknown }
    type Message = { role: string; content: string | ContentBlock[] }

    const messages: Message[] = [{ role: "user", content: (opts?.anthropicContent as ContentBlock[] | undefined) ?? userMessage }]
    const totalUsage: AiTokenUsage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 }
    let providerRequestId: string | null = null
    const startedAt = Date.now()

    // Multi-turn loop for web search tool use (max 5 rounds)
    for (let i = 0; i < 5; i++) {
        const body: Record<string, unknown> = {
            model: safeModel,
            max_tokens: maxTokens,
            system: opts?.promptCaching
                ? [{ type: "text", text: system, cache_control: { type: "ephemeral", ttl: "5m" } }]
                : system,
            messages,
            ...(tools ? { tools } : {}),
            ...(opts?.responseJson && opts.responseSchema ? {
                output_config: { format: { type: "json_schema", schema: opts.responseSchema } },
            } : {}),
        }

        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
        })

        providerRequestId = res.headers.get("request-id") ?? res.headers.get("x-request-id")
        if (!res.ok) {
            await recordAiUsage({
                context: opts?.usageContext,
                provider: "anthropic",
                model: safeModel,
                inputChars: system.length + userMessage.length,
                latencyMs: Date.now() - startedAt,
                providerRequestId,
                status: "failed",
                errorCode: `http_${res.status}`,
            })
            throw await providerError("anthropic", res)
        }
        const data = await res.json()
        const currentUsage = normalizeAnthropicUsage(data.usage)
        totalUsage.inputTokens += currentUsage.inputTokens
        totalUsage.outputTokens += currentUsage.outputTokens
        totalUsage.cacheWriteTokens = Number(totalUsage.cacheWriteTokens ?? 0) + Number(currentUsage.cacheWriteTokens ?? 0)
        totalUsage.cacheReadTokens = Number(totalUsage.cacheReadTokens ?? 0) + Number(currentUsage.cacheReadTokens ?? 0)

        const stopReason: string = data.stop_reason
        const content: ContentBlock[] = data.content ?? []

        // Done — return the last text block (web search may produce multiple text blocks)
        if (stopReason !== "tool_use") {
            const textBlocks = content.filter(b => b.type === "text" && b.text)
            const text = textBlocks[textBlocks.length - 1]?.text ?? ""
            await recordAiUsage({
                context: opts?.usageContext,
                provider: "anthropic",
                model: safeModel,
                usage: totalUsage,
                inputChars: system.length + userMessage.length,
                outputChars: text.length,
                latencyMs: Date.now() - startedAt,
                providerRequestId,
                status: "succeeded",
            })
            return { text, usage: totalUsage, providerRequestId }
        }

        // Model called a tool — append its turn and provide tool results
        messages.push({ role: "assistant", content })

        const toolResults = content
            .filter(b => b.type === "tool_use")
            .map(b => ({
                type: "tool_result",
                tool_use_id: b.id,
                content: "Search executed.",
            }))

        messages.push({ role: "user", content: toolResults })
    }

    await recordAiUsage({ context: opts?.usageContext, provider: "anthropic", model: safeModel, usage: totalUsage, inputChars: system.length + userMessage.length, latencyMs: Date.now() - startedAt, providerRequestId, status: "failed", errorCode: "tool_round_limit" })
    return { text: "", usage: totalUsage, providerRequestId }
}

// ── OpenAI ────────────────────────────────────────────────────

async function callOpenAi(model: string, system: string, userMessage: string, maxTokens: number, opts?: AiCallOptions): Promise<AiCallResult> {
    const apiKey = getApiKey("openai")
    if (!apiKey) throw new Error("OpenAI API-nøgle mangler — sæt den i Stamdata → Indstillinger → API-nøgler")

    const ALLOWED = ["gpt-4o-mini", "gpt-4o", "o3-mini"]
    const safeModel = ALLOWED.includes(model) ? model : "gpt-4o"

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: safeModel,
            max_tokens: maxTokens,
            messages: [
                { role: "system", content: system },
                { role: "user", content: userMessage },
            ],
            ...(opts?.responseJson ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
    })

    if (!res.ok) throw await providerError("openai", res)
    const data = await res.json()
    return {
        text: data.choices?.[0]?.message?.content ?? "",
        usage: { inputTokens: Number(data.usage?.prompt_tokens ?? 0), outputTokens: Number(data.usage?.completion_tokens ?? 0) },
        providerRequestId: res.headers.get("x-request-id"),
    }
}

// ── Google Gemini ─────────────────────────────────────────────

async function callGoogle(model: string, system: string, userMessage: string, maxTokens: number, opts?: AiCallOptions): Promise<AiCallResult> {
    const apiKey = getApiKey("google")
    if (!apiKey) throw new Error("Google AI API-nøgle mangler — sæt den i Stamdata → Indstillinger → API-nøgler")

    const ALLOWED = ["gemini-2.0-flash", "gemini-2.5-pro", "gemini-3.5-flash-lite", "gemini-3.6-flash"]
    const safeModel = ALLOWED.includes(model) ? model : "gemini-3.5-flash-lite"

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent?key=${apiKey}`

    const startedAt = Date.now()
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: opts?.googleParts ?? [{ text: userMessage }] }],
            generationConfig: {
                maxOutputTokens: maxTokens,
                ...(opts?.responseJson ? {
                    responseMimeType: "application/json",
                    ...(opts.responseSchema ? { responseJsonSchema: opts.responseSchema } : {}),
                } : {}),
            },
        }),
        signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
    })

    const providerRequestId = res.headers.get("x-request-id") ?? res.headers.get("x-guploader-uploadid")
    if (!res.ok) {
        await recordAiUsage({ context: opts?.usageContext, provider: "google", model: safeModel, inputChars: system.length + userMessage.length, latencyMs: Date.now() - startedAt, providerRequestId, status: "failed", errorCode: `http_${res.status}` })
        throw await providerError("google", res)
    }
    const data = await res.json()
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((part: { text?: string }) => part.text ?? "").join("")
    const metadata = data.usageMetadata ?? data.usage_metadata ?? {}
    const usage = normalizeGoogleUsage(metadata)
    await recordAiUsage({ context: opts?.usageContext, provider: "google", model: safeModel, usage, inputChars: system.length + userMessage.length, outputChars: text.length, latencyMs: Date.now() - startedAt, providerRequestId, status: "succeeded" })
    return { text, usage, providerRequestId }
}
