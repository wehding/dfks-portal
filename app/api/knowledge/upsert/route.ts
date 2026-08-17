/**
 * app/api/knowledge/upsert/route.ts
 *
 * Server-side endpoint til at gemme/opdatere et knowledge chunk med embedding.
 * Kaldes fra klient efter at en sagserfaring eller juridisk note er gemt i DB.
 */

import { NextRequest, NextResponse } from "next/server"
import { upsertKnowledgeChunk, deleteKnowledgeChunk } from "@/lib/retrieval"
import { requireStaffModuleApi } from "@/lib/api-auth"

function scopedSourceId(orgId: string | null, sourceId: string): string {
    return `${orgId ?? "global"}:${sourceId}`
}

export async function POST(req: NextRequest) {
    const auth = await requireStaffModuleApi("contract_reviews", "write")
    if (!auth.ok) return auth.response
    try {
        const body = await req.json() as Record<string, unknown>
        const { kilde_id, kilde_type, kilde_titel, tekst, org_id, metadata } = body

        if (typeof kilde_id !== "string" || typeof kilde_type !== "string" || typeof tekst !== "string"
            || !kilde_id.trim() || !kilde_type.trim() || !tekst.trim()
            || kilde_id.length > 200 || kilde_type.length > 80 || tekst.length > 100_000) {
            return NextResponse.json({ error: "kilde_id, kilde_type og tekst er påkrævet" }, { status: 400 })
        }
        const requestedOrgId = typeof org_id === "string" && org_id ? org_id : null
        if (requestedOrgId && !auth.allowedOrgIds?.includes(requestedOrgId)) {
            return NextResponse.json({ error: "Ingen adgang til organisationen" }, { status: 403 })
        }
        if (!requestedOrgId && !auth.global) {
            return NextResponse.json({ error: "Kun superadmin kan oprette global viden" }, { status: 403 })
        }
        const targetOrgId = requestedOrgId ?? null
        const safeMetadata = metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? metadata as Record<string, unknown>
            : undefined
        await upsertKnowledgeChunk({
            kilde_id: scopedSourceId(targetOrgId, kilde_id.trim()),
            kilde_type: kilde_type.trim(),
            kilde_titel: typeof kilde_titel === "string" ? kilde_titel.slice(0, 250) : tekst.slice(0, 60),
            tekst,
            org_id: targetOrgId,
            metadata: safeMetadata,
        })
        return NextResponse.json({ ok: true })
    } catch (err: unknown) {
        console.error("[knowledge/upsert]", err)
        return NextResponse.json({ error: "Viden kunne ikke gemmes." }, { status: 500 })
    }
}

export async function DELETE(req: NextRequest) {
    const auth = await requireStaffModuleApi("contract_reviews", "write")
    if (!auth.ok) return auth.response
    try {
        const body = await req.json() as { kilde_id?: unknown; org_id?: unknown }
        const kildeId = typeof body.kilde_id === "string" ? body.kilde_id.trim() : ""
        if (!kildeId || kildeId.length > 200) return NextResponse.json({ error: "kilde_id påkrævet" }, { status: 400 })
        const requestedOrgId = typeof body.org_id === "string" && body.org_id ? body.org_id : null
        if (requestedOrgId && !auth.allowedOrgIds?.includes(requestedOrgId)) {
            return NextResponse.json({ error: "Ingen adgang til organisationen" }, { status: 403 })
        }
        if (!requestedOrgId && !auth.global) {
            return NextResponse.json({ error: "Kun superadmin kan slette global viden" }, { status: 403 })
        }
        await deleteKnowledgeChunk(scopedSourceId(requestedOrgId, kildeId), requestedOrgId)
        return NextResponse.json({ ok: true })
    } catch (err: unknown) {
        console.error("[knowledge/delete]", err)
        return NextResponse.json({ error: "Viden kunne ikke slettes." }, { status: 500 })
    }
}
