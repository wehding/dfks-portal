/**
 * app/api/screen/route.ts
 *
 * Server-side proxy for Anthropic API calls.
 * Browsers cannot call api.anthropic.com directly due to CORS.
 * This route receives the contract text + references from the client
 * and forwards the request to Claude from the server.
 */

import { NextRequest, NextResponse } from "next/server"
import { callAi } from "@/lib/ai-client"
import { AI_CONFIG_DEFAULTS } from "@/lib/ai-providers"

export async function POST(req: NextRequest) {
    try {
        const { system, userMessage, provider, model } = await req.json()

        if (!system || !userMessage) {
            return NextResponse.json(
                { error: "Mangler system eller userMessage" },
                { status: 400 }
            )
        }

        const aiProvider = provider ?? AI_CONFIG_DEFAULTS.kontrakt.provider
        const aiModel    = model    ?? AI_CONFIG_DEFAULTS.kontrakt.model

        const text = await callAi({ provider: aiProvider, model: aiModel, system, userMessage, maxTokens: 6000 })

        console.log("[screen] AI raw response (first 500 chars):", text.slice(0, 500))

        // Parse JSON on server side so client receives a clean object
        const clean = text
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim()

        let parsed: any
        try {
            parsed = JSON.parse(clean)
        } catch (parseErr) {
            console.error("[screen] JSON parse error:", parseErr)
            console.error("[screen] Raw text:", text)
            return NextResponse.json(
                { error: "AI returnerede ugyldigt JSON — prøv igen" },
                { status: 500 }
            )
        }

        return NextResponse.json({ result: parsed })
    } catch (err: any) {
        console.error("[screen] Caught error:", err)
        return NextResponse.json(
            { error: err.message ?? "Ukendt serverfejl" },
            { status: 500 }
        )
    }
}
