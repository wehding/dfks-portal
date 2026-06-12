import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"

// POST /api/admin/contracts/[id]/reanalyse
// Henter fil fra storage og kører ny analyse via /api/gennemgang
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 })

    const { data: review } = await supabase
        .from("contract_reviews")
        .select("*")
        .eq("id", id)
        .single()

    if (!review) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 })
    if (!review.storage_path) {
        return NextResponse.json({ error: "Filen er ikke tilgængelig (sagen er afsluttet eller filen er slettet). Upload filen manuelt for at køre ny analyse." }, { status: 400 })
    }

    // Hent fil fra Supabase Storage
    const adminSupabase = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: fileData, error: downloadError } = await adminSupabase.storage
        .from("contract-reviews")
        .download(review.storage_path)

    if (downloadError || !fileData) {
        return NextResponse.json({ error: "Kunne ikke hente fil fra storage" }, { status: 500 })
    }

    // Byg FormData og kald /api/gennemgang
    const formData = new FormData()
    const fileName = review.file_name ?? "kontrakt.pdf"
    formData.append("file", new File([fileData], fileName))
    if (review.member_name) formData.append("memberName", review.member_name)
    if (review.contract_type) formData.append("contractType", review.contract_type)
    if (review.production_type) formData.append("productionType", review.production_type)
    if (review.producer_name) formData.append("producerName", review.producer_name)
    if (review.focus_areas?.length) formData.append("focusAreas", review.focus_areas.join(","))
    if (review.notes) formData.append("notes", review.notes)

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? `https://${req.headers.get("host")}`
    const analysisResp = await fetch(`${baseUrl}/api/gennemgang`, {
        method: "POST",
        body: formData,
    })

    if (!analysisResp.ok) {
        const err = await analysisResp.json().catch(() => ({}))
        return NextResponse.json({ error: err.error ?? "Analyse fejlede" }, { status: 500 })
    }

    const analysisData = await analysisResp.json()

    // Gem nyt resultat
    const { data, error } = await supabase
        .from("contract_reviews")
        .update({
            ai_result: analysisData.result,
            ai_run_at: new Date().toISOString(),
            ai_language: analysisData.klassifikation?.kontraktsprog ?? "da",
        })
        .eq("id", id)
        .select()
        .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ data, contractText: analysisData.contractText })
}
