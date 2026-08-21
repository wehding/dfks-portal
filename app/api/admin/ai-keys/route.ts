/**
 * app/api/admin/ai-keys/route.ts
 *
 * GET  — returnerer nøgle-status (konfigureret/mangler, kilde, maskeret)
 * POST — afvises; hemmeligheder administreres kun i servermiljøet.
 */

import { NextResponse } from "next/server"
import { getKeyStatus } from "@/lib/ai-key-store"
import { requireAdminApi } from "@/lib/api-auth"
import { USER_ADMIN_ROLES } from "@/lib/admin-roles"

const PROVIDERS = ["anthropic", "google"] as const

export async function GET() {
    const auth = await requireAdminApi(USER_ADMIN_ROLES)
    if (!auth.ok) return auth.response
    const status = Object.fromEntries(
        PROVIDERS.map(p => [p, getKeyStatus(p)])
    )
    return NextResponse.json(status)
}

export async function POST() {
    const auth = await requireAdminApi(USER_ADMIN_ROLES)
    if (!auth.ok) return auth.response
    return NextResponse.json({
        error: "AI-nøgler administreres som serverhemmeligheder i .env.local og Vercel Environment Variables.",
        code: "ENV_MANAGED_SECRETS",
    }, { status: 409 })
}
