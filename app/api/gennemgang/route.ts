/**
 * app/api/gennemgang/route.ts
 *
 * To-trins kontraktgennemgang — kernelogik i lib/analyse.ts.
 * Denne route: FormData-parsing, storage-upload og DB-persistering.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { AI_CONFIG_DEFAULTS } from "@/lib/ai-providers"
import { analyserKontrakt } from "@/lib/analyse"

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData()
        const file       = formData.get("file")       as File | null
        const provider   = (formData.get("provider") as string | null) ?? AI_CONFIG_DEFAULTS.kontrakt.provider
        const model      = (formData.get("model")    as string | null) ?? AI_CONFIG_DEFAULTS.kontrakt.model

        // Hent brugerens navn fra Auth — fallback: full_name → email-prefix → "Ukendt"
        const supabaseSession = await createClient()
        const { data: { user: sessionUser } } = await supabaseSession.auth.getUser()
        const memberName: string =
            (formData.get("memberName") as string | null) ||
            sessionUser?.user_metadata?.full_name ||
            sessionUser?.email?.split("@")[0] ||
            "Ukendt"

        const existingReviewId     = formData.get("existingReviewId")    as string | null
        const contractType         = formData.get("contractType")         as string | null
        const productionType       = formData.get("productionType")       as string | null
        const distributionRaw      = formData.get("distributionChannels") as string | null
        const producerName         = formData.get("producerName")         as string | null
        const producerOverenskomst = formData.get("producerOverenskomst") as string | null
        const focusAreasRaw        = formData.get("focusAreas")           as string | null
        const uploadNotes          = formData.get("notes")                as string | null
        const portalOrgId          = formData.get("orgId")                as string | null
        const portalEmail          = formData.get("memberEmail")          as string | null
        const portalUserId         = formData.get("memberId")             as string | null

        let distributionChannels: string[] = []
        try { distributionChannels = distributionRaw ? JSON.parse(distributionRaw) : [] } catch { /* ignorér */ }
        let focusAreas: string[] = []
        try { focusAreas = focusAreasRaw ? JSON.parse(focusAreasRaw) : [] } catch { /* ignorér */ }

        if (!file) {
            return NextResponse.json({ error: "Ingen fil modtaget" }, { status: 400 })
        }

        const fileBuffer = Buffer.from(await file.arrayBuffer())
        const saveOrgId  = portalOrgId ?? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5"

        const { data: { user } } = await supabaseSession.auth.getUser()
        const resolvedOrgId = portalOrgId ?? user?.user_metadata?.org_id ?? saveOrgId

        let analysisResult
        try {
            analysisResult = await analyserKontrakt({
                fileBuffer,
                fileName: file.name,
                memberName,
                contractType,
                productionType,
                distributionChannels,
                producerName,
                producerOverenskomst,
                focusAreas,
                notes: uploadNotes,
                orgId: resolvedOrgId,
                memberId: portalUserId,
                memberEmail: portalEmail,
                existingReviewId,
                provider,
                model,
            })
        } catch (err: any) {
            const msg = err.message ?? "Analyse fejlede"
            const status =
                msg.includes("Ikke-understøttet") ? 400 :
                msg.includes("PDF-analyse kræver") ? 400 :
                msg.includes("Ingen tekst") ? 422 : 500
            return NextResponse.json({ error: msg }, { status })
        }

        const { result: parsed, contractText: returnText, klassifikation, risk_level: riskLevel, should_escalate: shouldEscalate } = analysisResult

        // ── Gem fil i Supabase Storage ────────────────────────
        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        let storagePath: string | null = null
        try {
            const ts = Date.now()
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
            storagePath = `${saveOrgId}/${ts}_${safeName}`
            const { error: storageErr } = await admin.storage
                .from("contract-reviews")
                .upload(storagePath, fileBuffer, {
                    contentType: file.type || "application/octet-stream",
                    upsert: false,
                })
            if (storageErr) {
                console.warn("[gennemgang] Storage upload fejlede (ikke kritisk):", storageErr.message)
                storagePath = null
            }
        } catch (storageEx) {
            console.warn("[gennemgang] Storage upload exception (ikke kritisk):", storageEx)
            storagePath = null
        }

        // ── Gem i contract_reviews ────────────────────────────
        try {
            if (existingReviewId) {
                const { error: updateErr } = await admin
                    .from("contract_reviews")
                    .update({
                        ai_result:       parsed,
                        ai_run_at:       new Date().toISOString(),
                        ai_language:     klassifikation?.kontraktsprog ?? null,
                        risk_level:      riskLevel,
                        should_escalate: shouldEscalate,
                        ai_status:       "klar",
                        ...(storagePath ? { storage_path: storagePath } : {}),
                    })
                    .eq("id", existingReviewId)
                if (updateErr) {
                    console.error("[gennemgang] UPDATE contract_reviews fejl:", updateErr.message)
                } else {
                    console.log("[gennemgang] Opdateret review:", existingReviewId)
                }
            } else {
                const insertPayload: Record<string, unknown> = {
                    org_id:          saveOrgId,
                    member_name:     memberName ?? null,
                    member_email:    portalEmail ?? null,
                    member_id:       portalUserId ?? null,
                    ai_result:       parsed,
                    reviewed_by:     portalUserId ?? null,
                    status:          "afventer",
                    ai_status:       "klar",
                    file_name:       file.name,
                    file_size_bytes: file.size,
                    storage_path:    storagePath,
                    contract_type:   contractType ?? null,
                    production_type: productionType ?? null,
                    distribution_channels: distributionChannels.length ? distributionChannels : null,
                    producer_name:         producerName ?? null,
                    producer_dfks_id:      formData.get("producerDfksId") ?? null,
                    producer_dfi_id:       formData.get("producerDfiId")  ?? null,
                    producer_overenskomst_bound:
                        producerOverenskomst === "true"  ? true :
                        producerOverenskomst === "false" ? false : null,
                    focus_areas:  focusAreas.length ? focusAreas : null,
                    notes:        uploadNotes ?? null,
                    ai_language:  klassifikation?.kontraktsprog ?? null,
                    risk_level:      riskLevel,
                    should_escalate: shouldEscalate,
                }
                const { data: savedReview, error: insertError } = await admin
                    .from("contract_reviews")
                    .insert(insertPayload)
                    .select()
                    .single()
                if (insertError) {
                    console.error("[gennemgang] INSERT contract_reviews fejl:", JSON.stringify(insertError, null, 2))
                } else {
                    console.log("[gennemgang] Gemt i contract_reviews:", savedReview?.id, "storage_path:", storagePath)
                }
            }
        } catch (saveErr) {
            console.error("[gennemgang] Gem fejlede:", saveErr)
        }

        return NextResponse.json({
            result: parsed,
            contractText: returnText,
            klassifikation,
            risk_level: riskLevel,
            should_escalate: shouldEscalate,
        })

    } catch (err: any) {
        console.error("[gennemgang] Caught error:", err)
        return NextResponse.json(
            { error: err.message ?? "Ukendt serverfejl" },
            { status: 500 }
        )
    }
}
