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
import { getAiRuntimeConfig } from "@/lib/ai-runtime"
import { errorMessage, logWarn } from "@/lib/server-log"
import { requireSessionApi } from "@/lib/api-auth"

export async function POST(req: NextRequest) {
    const auth = await requireSessionApi()
    if (!auth.ok) return auth.response
    try {
        const { system, userMessage } = await req.json()

        if (!system || !userMessage) {
            return NextResponse.json(
                { error: "Mangler system eller userMessage" },
                { status: 400 }
            )
        }

        const runtime = await getAiRuntimeConfig("contract_advice")

        const text = await callAi({ provider: runtime.provider, model: runtime.model, system, userMessage, maxTokens: 6000, responseJson: true, promptCaching: runtime.promptCachingEnabled })

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
            logWarn("screen", "AI returnerede ugyldigt JSON", { error: errorMessage(parseErr) })
            return NextResponse.json(
                { error: "AI returnerede ugyldigt JSON — prøv igen" },
                { status: 500 }
            )
        }

        return NextResponse.json({ result: parsed })
    } catch (err: unknown) {
        logWarn("screen", "Screening fejlede", { error: errorMessage(err) })
        return NextResponse.json(
            { error: errorMessage(err, "Ukendt serverfejl") },
            { status: 500 }
        )
    }
}
