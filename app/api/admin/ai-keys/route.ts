/**
 * app/api/admin/ai-keys/route.ts
 *
 * GET  — returnerer nøgle-status (konfigureret/mangler, kilde, maskeret)
 * POST — gemmer én eller flere nøgler i config/ai-keys.json
 */

import { NextRequest, NextResponse } from "next/server"
import { getKeyStatus, writeKeyStore } from "@/lib/ai-key-store"

const PROVIDERS = ["anthropic", "openai", "google"] as const

export async function GET() {
    const status = Object.fromEntries(
        PROVIDERS.map(p => [p, getKeyStatus(p)])
    )
    return NextResponse.json(status)
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json() as Partial<Record<typeof PROVIDERS[number], string>>

        const updates: Record<string, string> = {}
        for (const p of PROVIDERS) {
            const val = body[p]
            if (typeof val === "string") {
                updates[p] = val.trim()
            }
        }

        writeKeyStore(updates)
        return NextResponse.json({ ok: true })
    } catch (err) {
        console.error("[ai-keys] POST fejl:", err)
        return NextResponse.json({ error: "Kunne ikke gemme nøgler" }, { status: 500 })
    }
}
