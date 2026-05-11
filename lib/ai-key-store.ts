/**
 * lib/ai-key-store.ts
 *
 * Server-side opbevaring af AI API-nøgler.
 * Env vars (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_AI_API_KEY) har altid prioritet.
 * Fallback: config/ai-keys.json (gitignored, skrives via admin-UI).
 *
 * Bruges KUN server-side (Next.js API routes) — aldrig client-side.
 */

import fs from "fs"
import path from "path"

const KEY_FILE = path.join(process.cwd(), "config", "ai-keys.json")

export interface AiKeyStore {
    anthropic?: string
    openai?: string
    google?: string
}

function readKeyStore(): AiKeyStore {
    try {
        if (!fs.existsSync(KEY_FILE)) return {}
        return JSON.parse(fs.readFileSync(KEY_FILE, "utf-8")) as AiKeyStore
    } catch {
        return {}
    }
}

export function writeKeyStore(updates: Partial<AiKeyStore>): void {
    const existing = readKeyStore()
    const merged = { ...existing, ...updates }
    // Fjern tomme strenge
    for (const k of Object.keys(merged) as (keyof AiKeyStore)[]) {
        if (!merged[k]) delete merged[k]
    }
    const dir = path.dirname(KEY_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(KEY_FILE, JSON.stringify(merged, null, 2), "utf-8")
}

export function getApiKey(provider: "anthropic" | "openai" | "google"): string | undefined {
    // Env var har altid prioritet
    const fromEnv = {
        anthropic: process.env.ANTHROPIC_API_KEY,
        openai:    process.env.OPENAI_API_KEY,
        google:    process.env.GOOGLE_AI_API_KEY,
    }[provider]
    if (fromEnv) return fromEnv

    return readKeyStore()[provider]
}

export function maskKey(key: string): string {
    if (key.length <= 4) return "•".repeat(key.length)
    return "••••••••" + key.slice(-4)
}

export type KeySource = "env" | "stored" | "missing"

export function getKeyStatus(provider: "anthropic" | "openai" | "google"): {
    configured: boolean
    source: KeySource
    masked?: string
} {
    const fromEnv = {
        anthropic: process.env.ANTHROPIC_API_KEY,
        openai:    process.env.OPENAI_API_KEY,
        google:    process.env.GOOGLE_AI_API_KEY,
    }[provider]

    if (fromEnv) return { configured: true, source: "env", masked: maskKey(fromEnv) }

    const fromStore = readKeyStore()[provider]
    if (fromStore) return { configured: true, source: "stored", masked: maskKey(fromStore) }

    return { configured: false, source: "missing" }
}
