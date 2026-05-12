/**
 * lib/ai-client.ts
 *
 * Unified server-side AI caller.
 * Understøtter Anthropic, OpenAI og Google Gemini med samme interface.
 * Bruges fra Next.js API routes — kører kun server-side.
 */

import { getApiKey } from "@/lib/ai-key-store"

export interface AiCallOptions {
    provider: string
    model: string
    system: string
    userMessage: string
    maxTokens?: number
    enableWebSearch?: boolean
}

export async function callAi(opts: AiCallOptions): Promise<string> {
    const { provider, model, system, userMessage, maxTokens = 4096, enableWebSearch = false } = opts

    switch (provider) {
        case "anthropic":
            return callAnthropic(model, system, userMessage, maxTokens, enableWebSearch)
        case "openai":
            return callOpenAi(model, system, userMessage, maxTokens)
        case "google":
            return callGoogle(model, system, userMessage, maxTokens)
        default:
            throw new Error(`Ukendt AI-udbyder: ${provider}`)
    }
}

// ── Anthropic ─────────────────────────────────────────────────

async function callAnthropic(model: string, system: string, userMessage: string, maxTokens: number, enableWebSearch = false): Promise<string> {
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

    const messages: Message[] = [{ role: "user", content: userMessage }]

    // Multi-turn loop for web search tool use (max 5 rounds)
    for (let i = 0; i < 5; i++) {
        const body: Record<string, unknown> = {
            model: safeModel,
            max_tokens: maxTokens,
            system,
            messages,
            ...(tools ? { tools } : {}),
        }

        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        })

        if (!res.ok) throw new Error(`Anthropic API fejl: ${res.status} — ${await res.text()}`)
        const data = await res.json()

        const stopReason: string = data.stop_reason
        const content: ContentBlock[] = data.content ?? []

        // Done — return the text response
        if (stopReason !== "tool_use") {
            return content.find(b => b.type === "text")?.text ?? ""
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

    return ""
}

// ── OpenAI ────────────────────────────────────────────────────

async function callOpenAi(model: string, system: string, userMessage: string, maxTokens: number): Promise<string> {
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
        }),
    })

    if (!res.ok) throw new Error(`OpenAI API fejl: ${res.status} — ${await res.text()}`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? ""
}

// ── Google Gemini ─────────────────────────────────────────────

async function callGoogle(model: string, system: string, userMessage: string, maxTokens: number): Promise<string> {
    const apiKey = getApiKey("google")
    if (!apiKey) throw new Error("Google AI API-nøgle mangler — sæt den i Stamdata → Indstillinger → API-nøgler")

    const ALLOWED = ["gemini-2.0-flash", "gemini-2.5-pro"]
    const safeModel = ALLOWED.includes(model) ? model : "gemini-2.0-flash"

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent?key=${apiKey}`

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: userMessage }] }],
            generationConfig: { maxOutputTokens: maxTokens },
        }),
    })

    if (!res.ok) throw new Error(`Google AI API fejl: ${res.status} — ${await res.text()}`)
    const data = await res.json()
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
}
