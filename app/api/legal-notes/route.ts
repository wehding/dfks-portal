import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function sb() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}

export async function GET() {
    const { data, error } = await sb()
        .from("legal_notes")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
    const body = await req.json()
    const { title, body: noteBody, priority, gyldig_fra, gyldig_til } = body
    if (!title || !noteBody || !priority) {
        return NextResponse.json({ error: "title, body og priority er påkrævet" }, { status: 400 })
    }
    const { data, error } = await sb()
        .from("legal_notes")
        .insert({ title, body: noteBody, priority, gyldig_fra: gyldig_fra || null, gyldig_til: gyldig_til || null, active: true })
        .select()
        .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
    const body = await req.json()
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: "id mangler" }, { status: 400 })
    const allowed = ["title", "body", "priority", "active", "gyldig_fra", "gyldig_til"]
    const patch: Record<string, unknown> = {}
    for (const k of allowed) if (k in updates) patch[k] = updates[k]
    const { data, error } = await sb()
        .from("legal_notes")
        .update(patch)
        .eq("id", id)
        .select()
        .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "id mangler" }, { status: 400 })
    const { error } = await sb().from("legal_notes").delete().eq("id", id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
}
