/**
 * app/api/screen/route.ts
 *
 * Server-side proxy for Anthropic API calls.
 * Browsers cannot call api.anthropic.com directly due to CORS.
 * This route receives the contract text + references from the client
 * and forwards the request to Claude from the server.
 */

import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
    try {
        const { system, userMessage } = await req.json()

        if (!system || !userMessage) {
            return NextResponse.json(
                { error: "Mangler system eller userMessage" },
                { status: 400 }
            )
        }

        const apiKey = process.env.ANTHROPIC_API_KEY
        console.log("[screen] API key present:", !!apiKey)
        console.log("[screen] system length:", system?.length)
        console.log("[screen] userMessage length:", userMessage?.length)
        if (!apiKey) {
            return NextResponse.json(
                { error: "ANTHROPIC_API_KEY er ikke konfigureret på serveren" },
                { status: 500 }
            )
        }

        console.log("[screen] Calling Anthropic API...")
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 6000,
                system,
                messages: [{ role: "user", content: userMessage }],
            }),
        })

        console.log("[screen] Anthropic response status:", response.status)
        if (!response.ok) {
            const err = await response.text()
            console.error("[screen] Anthropic error:", err)
            return NextResponse.json(
                { error: `Claude API fejl: ${response.status} — ${err}` },
                { status: response.status }
            )
        }

        const data = await response.json()
        const text =
            data.content?.find((b: any) => b.type === "text")?.text ?? ""

        return NextResponse.json({ text })
    } catch (err: any) {
        console.error("[screen] Caught error:", err)
        return NextResponse.json(
            { error: err.message ?? "Ukendt serverfejl" },
            { status: 500 }
        )
    }
}
