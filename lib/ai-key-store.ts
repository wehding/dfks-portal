/**
 * lib/ai-key-store.ts
 *
 * Server-side opbevaring af AI API-nøgler.
 * Nøgler læses udelukkende fra serverens environment variables.
 *
 * Bruges KUN server-side (Next.js API routes) — aldrig client-side.
 */

export function getApiKey(provider: "anthropic" | "openai" | "google"): string | undefined {
    return {
        anthropic: process.env.ANTHROPIC_API_KEY,
        openai:    process.env.OPENAI_API_KEY,
        google:    process.env.GOOGLE_AI_API_KEY ?? process.env.GOOGLE_API_KEY,
    }[provider]
}

export function maskKey(key: string): string {
    if (key.length <= 4) return "•".repeat(key.length)
    return "••••••••" + key.slice(-4)
}

export type KeySource = "env" | "missing"

export function getKeyStatus(provider: "anthropic" | "openai" | "google"): {
    configured: boolean
    source: KeySource
    masked?: string
} {
    const fromEnv = {
        anthropic: process.env.ANTHROPIC_API_KEY,
        openai:    process.env.OPENAI_API_KEY,
        google:    process.env.GOOGLE_AI_API_KEY ?? process.env.GOOGLE_API_KEY,
    }[provider]

    if (fromEnv) return { configured: true, source: "env", masked: maskKey(fromEnv) }

    return { configured: false, source: "missing" }
}
