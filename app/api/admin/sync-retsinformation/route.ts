/**
 * POST /api/admin/sync-retsinformation
 *
 * Synkroniserer lovtekst fra retsinformation.dk til knowledge_chunks.
 * Kaldes manuelt fra AI-kontrolrum og automatisk via cron.
 */

import { NextRequest, NextResponse } from "next/server"
import { syncRetsinformation } from "@/scripts/sync-retsinformation"
import { requireStaffModuleApi } from "@/lib/api-auth"

export async function POST(req: NextRequest) {
    // Tillad cron-kald fra Vercel (Authorization header) og autentificerede admins
    const authHeader = req.headers.get("authorization")
    const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`

    if (!isCron) {
        const auth = await requireStaffModuleApi("organisation", "write")
        if (!auth.ok) return auth.response
    }

    try {
        const result = await syncRetsinformation()
        return NextResponse.json(result)
    } catch (err: unknown) {
        console.error("[sync-retsinformation]", err)
        return NextResponse.json({ error: "Synkroniseringen kunne ikke gennemføres." }, { status: 502 })
    }
}

export async function GET(req: NextRequest) {
    // Cron-kald fra Vercel
    const authHeader = req.headers.get("authorization")
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 })
    }
    try {
        const result = await syncRetsinformation()
        return NextResponse.json(result)
    } catch {
        return NextResponse.json({ error: "Synkroniseringen kunne ikke gennemføres." }, { status: 502 })
    }
}
