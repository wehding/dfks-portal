/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy Supabase or external API payloads are normalized at this module boundary. */
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
import { requireAdminApi, requireSessionApi } from "@/lib/api-auth"
import { buildPortalContractScreeningPrompt } from "@/lib/portal-contract-screening-prompt"
import { buildSystemPrompt } from "@/lib/ai"
import { maskPersonalData } from "@/lib/mask-text"
import { ADMIN_ROLES } from "@/lib/admin-roles"

export async function POST(req: NextRequest) {
    const auth = await requireSessionApi()
    if (!auth.ok) return auth.response
    try {
        const body = await req.json().catch(() => null) as {
            mode?: unknown
            contractText?: unknown
            availableRoles?: unknown
        } | null
        const mode = body?.mode === "full" ? "full" : body?.mode === "portal" ? "portal" : null
        const contractText = typeof body?.contractText === "string" ? body.contractText.trim() : ""
        if (!mode || !contractText) {
            return NextResponse.json(
                { error: "Mangler screeningstype eller kontrakttekst" },
                { status: 400 }
            )
        }
        if (contractText.length > 40_000) {
            return NextResponse.json({ error: "Kontraktteksten er for lang" }, { status: 413 })
        }
        if (mode === "full") {
            const admin = await requireAdminApi(ADMIN_ROLES)
            if (!admin.ok) return admin.response
        }
        const roles = Array.isArray(body?.availableRoles)
            ? body.availableRoles.filter((role): role is string => typeof role === "string")
            : []
        const system = mode === "portal"
            ? buildPortalContractScreeningPrompt(roles)
            : buildSystemPrompt()
        const userMessage = `${mode === "portal" ? "Analyser denne kontrakt og returner JSON til formularen" : "Analyser denne kontrakt og returner JSON"}:\n\n${maskPersonalData(contractText)}`

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
        return NextResponse.json({ error: "Kontrakten kunne ikke analyseres. Prøv igen senere." }, { status: 502 })
    }
}
