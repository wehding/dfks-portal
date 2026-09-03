import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireStaffModuleApi } from "@/lib/api-auth"

function sb() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}

export async function GET() {
    const auth = await requireStaffModuleApi("contract_reviews", "read")
    if (!auth.ok) return auth.response
    const { data, error } = await sb()
        .from("legal_notes")
        .select("*")
        .or(`org_id.is.null,org_id.eq.${auth.orgId}`)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false })
    if (error) return NextResponse.json({ error: "Juridiske noter kunne ikke hentes." }, { status: 500 })
    return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
    const auth = await requireStaffModuleApi("contract_reviews", "write")
    if (!auth.ok) return auth.response
    const body = await req.json()
    const { title, body: noteBody, priority, gyldig_fra, gyldig_til } = body as Record<string, unknown>
    if (typeof title !== "string" || typeof noteBody !== "string" || typeof priority !== "string"
        || !title.trim() || title.length > 250 || noteBody.length > 50_000 || priority.length > 50) {
        return NextResponse.json({ error: "title, body og priority er påkrævet" }, { status: 400 })
    }
    const globalNote = body.global === true
    if (globalNote && auth.role !== "superadmin") return NextResponse.json({ error: "Kun superadmin kan oprette globale noter" }, { status: 403 })
    const { data, error } = await sb()
        .from("legal_notes")
        .insert({ org_id: globalNote ? null : auth.orgId, title: title.trim(), body: noteBody, priority, gyldig_fra: typeof gyldig_fra === "string" ? gyldig_fra : null, gyldig_til: typeof gyldig_til === "string" ? gyldig_til : null, active: true })
        .select()
        .single()
    if (error) return NextResponse.json({ error: "Den juridiske note kunne ikke oprettes." }, { status: 500 })
    return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
    const auth = await requireStaffModuleApi("contract_reviews", "write")
    if (!auth.ok) return auth.response
    const body = await req.json()
    const { id, ...updates } = body as Record<string, unknown>
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "id mangler" }, { status: 400 })
    const { data: existing } = await sb().from("legal_notes").select("org_id").eq("id", id).maybeSingle()
    if (!existing || (existing.org_id === null ? auth.role !== "superadmin" : existing.org_id !== auth.orgId)) {
        return NextResponse.json({ error: "Noten blev ikke fundet" }, { status: 404 })
    }
    const allowed = ["title", "body", "priority", "active", "gyldig_fra", "gyldig_til", "exclude_for_overenskomst"]
    const patch: Record<string, unknown> = {}
    for (const k of allowed) {
        if (!(k in updates)) continue
        if (k === "exclude_for_overenskomst") {
            const v = updates[k]
            patch[k] = Array.isArray(v)
                ? v.filter((x): x is string => typeof x === "string").slice(0, 20)
                : []
        } else {
            patch[k] = updates[k]
        }
    }
    const { data, error } = await sb()
        .from("legal_notes")
        .update(patch)
        .eq("id", id)
        .select()
        .single()
    if (error) return NextResponse.json({ error: "Den juridiske note kunne ikke opdateres." }, { status: 500 })
    return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
    const auth = await requireStaffModuleApi("contract_reviews", "delete")
    if (!auth.ok) return auth.response
    const { id } = await req.json()
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "id mangler" }, { status: 400 })
    const { data: existing } = await sb().from("legal_notes").select("org_id").eq("id", id).maybeSingle()
    if (!existing || (existing.org_id === null ? auth.role !== "superadmin" : existing.org_id !== auth.orgId)) {
        return NextResponse.json({ error: "Noten blev ikke fundet" }, { status: 404 })
    }
    const { error } = await sb().from("legal_notes").delete().eq("id", id)
    if (error) return NextResponse.json({ error: "Den juridiske note kunne ikke slettes." }, { status: 500 })
    return NextResponse.json({ ok: true })
}
