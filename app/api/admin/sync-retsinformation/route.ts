/**
 * POST /api/admin/sync-retsinformation
 *
 * Synkroniserer lovtekst fra retsinformation.dk til knowledge_chunks.
 * Kaldes manuelt fra AI-kontrolrum og automatisk via cron.
 */

import { NextRequest, NextResponse } from "next/server"
import { syncRetsinformation } from "@/scripts/sync-retsinformation"
import { requireCronOrAdminApi } from "@/lib/api-auth"
import { USER_ADMIN_ROLES } from "@/lib/admin-roles"

export async function POST(req: NextRequest) {
    const auth = await requireCronOrAdminApi(req, USER_ADMIN_ROLES)
    if (!auth.ok) return auth.response

    try {
        const result = await syncRetsinformation()
        return NextResponse.json(result)
    } catch (err: unknown) {
        console.error("[sync-retsinformation]", err)
        return NextResponse.json({ error: "Synkroniseringen kunne ikke gennemføres." }, { status: 502 })
    }
}

export async function GET(req: NextRequest) {
    const auth = await requireCronOrAdminApi(req, USER_ADMIN_ROLES)
    if (!auth.ok) return auth.response

    try {
        const result = await syncRetsinformation()
        return NextResponse.json(result)
    } catch {
        return NextResponse.json({ error: "Synkroniseringen kunne ikke gennemføres." }, { status: 502 })
    }
}
