/**
 * app/api/admin/satser/route.ts
 *
 * GET  — hent aktuelle satser per overenskomst
 * POST — tilføj ny sats
 * PUT  — ny overenskomstrunde (luk alle gamle, opret nye)
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { requireAdminApi } from "@/lib/api-auth"

export async function GET(request: NextRequest) {
    const auth = await requireAdminApi()
    if (!auth.ok) return auth.response
    const overenskomst = request.nextUrl.searchParams.get("overenskomst")
    const supabase = await createClient()

    if (!overenskomst) {
        // Returnér liste over tilgængelige overenskomster
        const { data, error } = await supabase
            .from("overenskomst_satser")
            .select("overenskomst")
            .is("gyldig_til", null)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        const unikke = [...new Set((data ?? []).map(r => r.overenskomst))]
        return NextResponse.json(unikke)
    }

    const { data, error } = await supabase
        .from("overenskomst_satser")
        .select()
        .eq("overenskomst", overenskomst)
        .is("gyldig_til", null)
        .order("kategori")

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data ?? [])
}

export async function POST(request: NextRequest) {
    const auth = await requireAdminApi()
    if (!auth.ok) return auth.response
    const supabase = await createClient()
    const body = await request.json()

    const { overenskomst, kategori, beskrivelse, vaerdi, enhed, gyldig_fra } = body
    if (!overenskomst || !kategori || !beskrivelse || vaerdi == null || !enhed || !gyldig_fra) {
        return NextResponse.json({ error: "Mangler påkrævede felter" }, { status: 400 })
    }

    const { data, error } = await supabase
        .from("overenskomst_satser")
        .insert({ overenskomst, kategori, beskrivelse, vaerdi, enhed, gyldig_fra })
        .select()
        .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data, { status: 201 })
}

export async function PUT(request: NextRequest) {
    const auth = await requireAdminApi()
    if (!auth.ok) return auth.response
    // Ny overenskomstrunde: luk alle aktuelle satser og opret nye
    const supabase = await createClient()
    const body = await request.json()

    const { overenskomst, satser, gyldig_fra } = body
    if (!overenskomst || !satser || !gyldig_fra) {
        return NextResponse.json({ error: "Mangler påkrævede felter" }, { status: 400 })
    }

    const today = new Date().toISOString().slice(0, 10)

    // Luk alle aktuelle satser
    const { error: lukError } = await supabase
        .from("overenskomst_satser")
        .update({ gyldig_til: today })
        .eq("overenskomst", overenskomst)
        .is("gyldig_til", null)

    if (lukError) return NextResponse.json({ error: lukError.message }, { status: 500 })

    // Opret nye satser
    const nye = satser.map((s: { kategori: string; beskrivelse: string; vaerdi: number; enhed: string }) => ({
        overenskomst,
        kategori: s.kategori,
        beskrivelse: s.beskrivelse,
        vaerdi: s.vaerdi,
        enhed: s.enhed,
        gyldig_fra,
    }))

    const { data, error: insertError } = await supabase
        .from("overenskomst_satser")
        .insert(nye)
        .select()

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
    return NextResponse.json(data)
}

export async function DELETE(request: NextRequest) {
    const auth = await requireAdminApi()
    if (!auth.ok) return auth.response
    const supabase = await createClient()
    const id = request.nextUrl.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "Mangler id" }, { status: 400 })

    const { error } = await supabase.from("overenskomst_satser").delete().eq("id", id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
}
