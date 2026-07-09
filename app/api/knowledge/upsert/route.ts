/**
 * app/api/knowledge/upsert/route.ts
 *
 * Server-side endpoint til at gemme/opdatere et knowledge chunk med embedding.
 * Kaldes fra klient efter at en sagserfaring eller juridisk note er gemt i DB.
 */

import { NextRequest, NextResponse } from "next/server"
import { upsertKnowledgeChunk, deleteKnowledgeChunk } from "@/lib/retrieval"
import { requireAdminApi } from "@/lib/api-auth"

export async function POST(req: NextRequest) {
    const denied = await requireAdminApi()
    if (denied) return denied
    try {
        const body = await req.json()
        const { kilde_id, kilde_type, kilde_titel, tekst, org_id, metadata } = body

        if (!kilde_id || !kilde_type || !tekst) {
            return NextResponse.json({ error: "kilde_id, kilde_type og tekst er påkrævet" }, { status: 400 })
        }

        await upsertKnowledgeChunk({ kilde_id, kilde_type, kilde_titel: kilde_titel ?? tekst.slice(0, 60), tekst, org_id: org_id ?? null, metadata })
        return NextResponse.json({ ok: true })
    } catch (err: any) {
        console.error("[knowledge/upsert]", err)
        return NextResponse.json({ error: err.message ?? "Ukendt fejl" }, { status: 500 })
    }
}

export async function DELETE(req: NextRequest) {
    const denied = await requireAdminApi()
    if (denied) return denied
    try {
        const { kilde_id } = await req.json()
        if (!kilde_id) return NextResponse.json({ error: "kilde_id påkrævet" }, { status: 400 })
        await deleteKnowledgeChunk(kilde_id)
        return NextResponse.json({ ok: true })
    } catch (err: any) {
        console.error("[knowledge/delete]", err)
        return NextResponse.json({ error: err.message ?? "Ukendt fejl" }, { status: 500 })
    }
}
