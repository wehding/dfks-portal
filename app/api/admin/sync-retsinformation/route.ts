/**
 * POST /api/admin/sync-retsinformation
 *
 * Synkroniserer lovtekst fra retsinformation.dk til knowledge_chunks.
 * Kaldes manuelt fra AI-kontrolrum og automatisk via cron.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { syncRetsinformation } from "@/scripts/sync-retsinformation"

export async function POST(req: NextRequest) {
    // Tillad cron-kald fra Vercel (Authorization header) og autentificerede admins
    const authHeader = req.headers.get("authorization")
    const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`

    if (!isCron) {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 })
    }

    try {
        const result = await syncRetsinformation()
        return NextResponse.json(result)
    } catch (err: any) {
        console.error("[sync-retsinformation]", err)
        return NextResponse.json({ error: err.message ?? "Ukendt fejl" }, { status: 500 })
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
    } catch (err: any) {
        return NextResponse.json({ error: err.message ?? "Ukendt fejl" }, { status: 500 })
    }
}
