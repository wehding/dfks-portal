import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { analyserKontrakt } from "@/lib/analyse"

// POST /api/admin/contracts/[id]/reanalyse
//
// To tilstande:
//   A) Ingen body / JSON body → henter fil fra storage (storage_path skal eksistere)
//   B) multipart/form-data med "file" felt → bruger den uploadede fil direkte
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 })

    // Brug service role så RLS ikke blokerer
    const adminSupabase = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: review } = await adminSupabase
        .from("contract_reviews")
        .select("*")
        .eq("id", id)
        .single()

    if (!review) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 })

    const contentType = req.headers.get("content-type") ?? ""
    const hasUpload = contentType.includes("multipart/form-data")

    let fileBuffer: Buffer
    let fileName: string

    if (hasUpload) {
        const uploadForm = await req.formData()
        const uploaded = uploadForm.get("file") as File | null
        if (!uploaded) return NextResponse.json({ error: "Ingen fil i upload" }, { status: 400 })
        fileBuffer = Buffer.from(await uploaded.arrayBuffer())
        fileName = uploaded.name
    } else {
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
        fileBuffer = Buffer.from(await fileData.arrayBuffer())
        fileName = review.file_name ?? "kontrakt.pdf"
    }

    // Kald analyserKontrakt direkte — ingen intern fetch
    let analysisResult
    try {
        analysisResult = await analyserKontrakt({
            fileBuffer,
            fileName,
            memberName:           review.member_name            ?? undefined,
            contractType:         review.contract_type          ?? undefined,
            productionType:       review.production_type        ?? undefined,
            distributionChannels: review.distribution_channels  ?? undefined,
            producerName:         review.producer_name          ?? undefined,
            producerOverenskomst: review.producer_overenskomst_bound === true  ? "true"
                                : review.producer_overenskomst_bound === false ? "false"
                                : undefined,
            focusAreas:           review.focus_areas            ?? undefined,
            notes:                review.notes                  ?? undefined,
            orgId:                review.org_id,
            memberId:             review.member_id              ?? undefined,
            memberEmail:          review.member_email           ?? undefined,
        })
    } catch (err: any) {
        return NextResponse.json({ error: err.message ?? "Analyse fejlede" }, { status: 500 })
    }

    const {
        result: parsed,
        contractText,
        klassifikation,
        compliance_extract,
        risk_level: riskLevel,
        should_escalate: shouldEscalate,
    } = analysisResult

    // Gem ny fil i storage ved upload-tilstand
    let newStoragePath: string | null = null
    if (hasUpload) {
        try {
            const ts = Date.now()
            const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_")
            newStoragePath = `${review.org_id}/${ts}_${safeName}`
            const { error: storageErr } = await adminSupabase.storage
                .from("contract-reviews")
                .upload(newStoragePath, fileBuffer, { contentType: "application/octet-stream", upsert: false })
            if (storageErr) {
                console.warn("[reanalyse] Storage upload fejlede:", storageErr.message)
                newStoragePath = null
            }
        } catch (e) {
            console.warn("[reanalyse] Storage upload exception:", e)
        }
    }

    const { data, error } = await adminSupabase
        .from("contract_reviews")
        .update({
            ai_result:          parsed,
            ai_run_at:          new Date().toISOString(),
            ai_language:        klassifikation?.kontraktsprog ?? null,
            risk_level:         riskLevel,
            should_escalate:    shouldEscalate,
            compliance_extract: compliance_extract ?? null,
            ...(newStoragePath ? { storage_path: newStoragePath } : {}),
        })
        .eq("id", id)
        .select()
        .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ data, contractText })
}
