import assert from "node:assert/strict"
import test from "node:test"
import { calculateAiCost, estimateEmbeddingTokens, normalizeAnthropicUsage, normalizeGoogleUsage } from "../lib/ai-cost"
import { getContractAiModel } from "../lib/ai-models"

test("beregner standard- og cachepris uden dobbelttælling", () => {
    const cost = calculateAiCost(
        { inputTokens: 10_000, outputTokens: 1_000, cacheWriteTokens: 2_000, cacheReadTokens: 5_000 },
        { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
    )
    assert.equal(cost, 0.054)
})

test("normaliserer Anthropic cache-tokenfelter", () => {
    assert.deepEqual(normalizeAnthropicUsage({
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 500,
        cache_read_input_tokens: 900,
    }), { inputTokens: 100, outputTokens: 20, cacheWriteTokens: 500, cacheReadTokens: 900 })
})

test("Gemini thinking-tokens medregnes præcis én gang som output", () => {
    assert.deepEqual(normalizeGoogleUsage({
        promptTokenCount: 1_000,
        candidatesTokenCount: 200,
        thoughtsTokenCount: 300,
        cachedContentTokenCount: 50,
    }), { inputTokens: 950, outputTokens: 500, thinkingTokens: 300, cacheReadTokens: 50 })
})

test("beregner et reproducerbart estimat for embedding-tokens", () => {
    assert.equal(estimateEmbeddingTokens("a".repeat(4_001)), 1_001)
    assert.equal(estimateEmbeddingTokens("a".repeat(9_000)), 2_000)
})

test("kun godkendte modeller kan vælges til hvert kontraktflow", () => {
    assert.ok(getContractAiModel("contract_extraction", "google", "gemini-3.5-flash-lite"))
    assert.ok(getContractAiModel("contract_advice", "google", "gemini-3.6-flash"))
    assert.equal(getContractAiModel("contract_extraction", "google", "gemini-3.6-flash"), null)
    assert.equal(getContractAiModel("contract_advice", "google", "gemini-3.5-flash-lite"), null)
})
