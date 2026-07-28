export type AiTokenUsage = {
    inputTokens: number
    outputTokens: number
    thinkingTokens?: number
    cacheWriteTokens?: number
    cacheReadTokens?: number
}

export type AiTokenPrice = {
    input: number
    output: number
    cacheWrite: number
    cacheRead: number
}

function safeCount(value: unknown) {
    const parsed = Number(value ?? 0)
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0
}

export function estimateEmbeddingTokens(text: string) {
    // Google embedContent currently omits usage metadata. Four UTF-16 code units
    // per token is a transparent reporting estimate, never a quota calculation.
    return Math.ceil(text.slice(0, 8_000).length / 4)
}

export function calculateAiCost(usage: AiTokenUsage, price: AiTokenPrice) {
    return (
        safeCount(usage.inputTokens) * price.input +
        safeCount(usage.outputTokens) * price.output +
        safeCount(usage.cacheWriteTokens) * price.cacheWrite +
        safeCount(usage.cacheReadTokens) * price.cacheRead
    ) / 1_000_000
}

export function normalizeAnthropicUsage(usage: Record<string, unknown> | null | undefined): AiTokenUsage {
    return {
        inputTokens: safeCount(usage?.input_tokens),
        outputTokens: safeCount(usage?.output_tokens),
        cacheWriteTokens: safeCount(usage?.cache_creation_input_tokens),
        cacheReadTokens: safeCount(usage?.cache_read_input_tokens),
    }
}

export function normalizeGoogleUsage(metadata: Record<string, unknown> | null | undefined): AiTokenUsage {
    const thinkingTokens = safeCount(metadata?.thoughtsTokenCount ?? metadata?.thoughts_token_count)
    const promptTokens = safeCount(metadata?.promptTokenCount ?? metadata?.prompt_token_count)
    const cachedTokens = safeCount(metadata?.cachedContentTokenCount ?? metadata?.cached_content_token_count)
    return {
        inputTokens: Math.max(0, promptTokens - cachedTokens),
        // Google bills thinking as output. Keep it separate for display but include it once in outputTokens.
        outputTokens: safeCount(metadata?.candidatesTokenCount ?? metadata?.candidates_token_count) + thinkingTokens,
        thinkingTokens,
        cacheReadTokens: cachedTokens,
    }
}

export { safeCount as normalizeAiTokenCount }
