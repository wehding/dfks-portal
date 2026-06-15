import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"

// POST /api/admin/contracts/[id]/reanalyse
//
// To tilstande:
//   A) Ingen body / JSON body → henter fil fra storage (storage_path skal eksistere)
//   B) multipart/form-data med "file" felt → bruger den uploadede fil direkte
//      (bruges til sager der mangler storage_path)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 })

    const adminSupabase = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Hent review — brug service role så RLS ikke blokerer
    const { data: review } = await adminSupabase
        .from("contract_reviews")
        .select("*")
        .eq("id", id)
        .single()

    if (!review) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 })

    // Afgør om kaldets content-type indeholder en uploadet fil
    const contentType = req.headers.get("content-type") ?? ""
    const hasUpload = contentType.includes("multipart/form-data")

    let fileBlob: Blob
    let fileName: string

    if (hasUpload) {
        // Tilstand B: fil uploadet direkte i requesten
        const uploadForm = await req.formData()
        const uploaded = uploadForm.get("file") as File | null
        if (!uploaded) {
            return NextResponse.json({ error: "Ingen fil i upload" }, { status: 400 })
        }
        fileBlob = uploaded
        fileName = uploaded.name
    } else {
        // Tilstand A: hent fra storage
        if (!review.storage_path) {
            return NextResponse.json({
                error: "Filen er ikke gemt i systemet. Brug knappen 'Upload fil til re-analyse'.",
                missing_file: true,
            }, { status: 400 })
        }
        const { data: fileData, error: downloadError } = await adminSupabase.storage
            .from("contract-reviews")
            .download(review.storage_path)
        if (downloadError || !fileData) {
            return NextResponse.json({ error: "Kunne ikke hente fil fra storage" }, { status: 500 })
        }
        fileBlob = fileData
        fileName = review.file_name ?? "kontrakt.pdf"
    }

    // Byg FormData og kald /api/gennemgang
    const formData = new FormData()
    formData.append("file", new File([fileBlob], fileName))
    if (review.member_name)    formData.append("memberName",    review.member_name)
    if (review.contract_type)  formData.append("contractType",  review.contract_type)
    if (review.production_type) formData.append("productionType", review.production_type)
    if (review.producer_name)  formData.append("producerName",  review.producer_name)
    if (review.focus_areas?.length) formData.append("focusAreas", review.focus_areas.join(","))
    if (review.notes)          formData.append("notes",         review.notes)
    // Bevar org/member-kontekst
    formData.append("orgId",   review.org_id)
    if (review.member_id)      formData.append("memberId",      review.member_id)
    if (review.member_email)   formData.append("memberEmail",   review.member_email)

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

    // Gem nyt resultat (service role — omgår RLS)
    const { data, error } = await adminSupabase
        .from("contract_reviews")
        .update({
            ai_result:       analysisData.result,
            ai_run_at:       new Date().toISOString(),
            ai_language:     analysisData.klassifikation?.kontraktsprog ?? "da",
            risk_level:      analysisData.risk_level ?? null,
            should_escalate: analysisData.should_escalate ?? null,
            // Opdater storage_path hvis gennemgang gemte filen (ved upload-tilstand)
            ...(analysisData.storage_path ? { storage_path: analysisData.storage_path } : {}),
        })
        .eq("id", id)
        .select()
        .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ data, contractText: analysisData.contractText })
}
