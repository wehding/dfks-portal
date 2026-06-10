import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getEmbedding } from "@/lib/embedding-provider"

function sb() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}

export async function GET() {
    const supabase = sb()
    const [patternsRes, feedbackRes] = await Promise.all([
        supabase
            .from("learned_patterns")
            .select("*")
            .order("created_at", { ascending: false }),
        supabase
            .from("analysis_feedback")
            .select("id, fund_titel, fund_svaerhedsgrad, korrektion_beskrivelse, jurist_korrektion, created_at")
            .eq("godkendt", false)
            .eq("skal_ignoreres", false)
            .order("created_at", { ascending: false }),
    ])
    return NextResponse.json({
        patterns: patternsRes.data ?? [],
        pending: feedbackRes.data ?? [],
    })
}

export async function POST(req: NextRequest) {
    const body = await req.json()
    const { titel, regel, semantisk_beskrivelse, kilde_feedback_id, godkendt_af } = body
    if (!titel || !regel || !semantisk_beskrivelse) {
        return NextResponse.json({ error: "titel, regel og semantisk_beskrivelse er påkrævet" }, { status: 400 })
    }
    const embedding = await getEmbedding(semantisk_beskrivelse, true)
    const { data, error } = await sb()
        .from("learned_patterns")
        .insert({ titel, regel, semantisk_beskrivelse, embedding, kilde_feedback_id: kilde_feedback_id || null, godkendt_af: godkendt_af || null, aktiv: true })
        .select()
        .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
    const { id, ...updates } = await req.json()
    if (!id) return NextResponse.json({ error: "id mangler" }, { status: 400 })
    const allowed = ["titel", "regel", "semantisk_beskrivelse", "aktiv"]
    const patch: Record<string, unknown> = {}
    for (const k of allowed) if (k in updates) patch[k] = updates[k]
    if (updates.semantisk_beskrivelse) {
        patch.embedding = await getEmbedding(updates.semantisk_beskrivelse, true)
    }
    const { data, error } = await sb().from("learned_patterns").update(patch).eq("id", id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
}
