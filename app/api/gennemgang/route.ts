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
import { errorMessage, logInfo, logWarn } from "@/lib/server-log"
import { requireInternalSecretApi } from "@/lib/api-auth"

const MAX_CONTRACT_UPLOAD_BYTES = 25 * 1024 * 1024

export async function POST(req: NextRequest) {
    try {
        logInfo("gennemgang", "Modtager request")
        const isInternal = requireInternalSecretApi(req)
        const formData = await req.formData()
        const file       = formData.get("file")       as File | null
        const provider   = (formData.get("provider") as string | null) ?? AI_CONFIG_DEFAULTS.kontrakt.provider
        const model      = (formData.get("model")    as string | null) ?? AI_CONFIG_DEFAULTS.kontrakt.model

        logInfo("gennemgang", "FormData parset", { hasFile: Boolean(file), provider })

        // Hent brugerens navn fra Auth — fallback til formData-navn → "Ukendt"
        // Brug try/catch: kaldet kan mangle cookie-kontekst ved interne server-kald
        let sessionUser: { id?: string; user_metadata?: Record<string, string>; email?: string } | null = null
        try {
            const supabaseSession = await createClient()
            const { data: { user } } = await supabaseSession.auth.getUser()
            sessionUser = user
        } catch (authErr) {
            logWarn("gennemgang", "Auth-opslag fejlede", { error: errorMessage(authErr) })
        }
        if (!sessionUser && !isInternal) {
            return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 })
        }

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
        if (file.size > MAX_CONTRACT_UPLOAD_BYTES) {
            return NextResponse.json({ error: "Filen er for stor. Maksimum er 25 MB." }, { status: 413 })
        }

        logInfo("gennemgang", "Læser filbuffer", { fileType: file.type || "ukendt" })
        const fileBuffer = Buffer.from(await file.arrayBuffer())
        let resolvedOrgId = isInternal ? portalOrgId : null
        if (!resolvedOrgId && sessionUser?.id) {
            const admin = createAdminClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!,
                { auth: { autoRefreshToken: false, persistSession: false } }
            )
            const { data: orgRole } = await admin
                .from("user_org_roles")
                .select("org_id")
                .eq("user_id", sessionUser.id)
                .limit(1)
                .maybeSingle()
            resolvedOrgId = orgRole?.org_id ?? null
        }
        if (!resolvedOrgId) {
            return NextResponse.json({ error: "Organisationen kunne ikke bestemmes" }, { status: 400 })
        }

        logInfo("gennemgang", "Starter kontraktanalyse", { provider, model })
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
                provider,
                model,
            })
        } catch (err: unknown) {
            const msg = errorMessage(err, "Analyse fejlede")
            const status =
                msg.includes("Ikke-understøttet") ? 400 :
                msg.includes("PDF-analyse kræver") ? 400 :
                msg.includes("Ingen tekst") ? 422 : 500
            return NextResponse.json({ error: msg }, { status })
        }

        logInfo("gennemgang", "Analyse fuldført, gemmer resultat")
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
            storagePath = `${resolvedOrgId}/${ts}_${safeName}`
            const { error: storageErr } = await admin.storage
                .from("contract-reviews")
                .upload(storagePath, fileBuffer, {
                    contentType: file.type || "application/octet-stream",
                    upsert: false,
                })
            if (storageErr) {
                logWarn("gennemgang", "Storage upload fejlede", { error: storageErr.message })
                storagePath = null
            }
        } catch (storageEx) {
            logWarn("gennemgang", "Storage upload exception", { error: errorMessage(storageEx) })
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
                    logWarn("gennemgang", "Update af contract_reviews fejlede", { error: updateErr.message })
                } else {
                    logInfo("gennemgang", "Opdateret review", { reviewId: existingReviewId })
                }
            } else {
                const insertPayload: Record<string, unknown> = {
                    org_id:          resolvedOrgId,
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
                    logWarn("gennemgang", "Insert i contract_reviews fejlede", { error: insertError.message })
                } else {
                    logInfo("gennemgang", "Gemt i contract_reviews", { reviewId: savedReview?.id ?? null, hasStorage: Boolean(storagePath) })
                }
            }
        } catch (saveErr) {
            logWarn("gennemgang", "Gem fejlede", { error: errorMessage(saveErr) })
        }

        return NextResponse.json({
            result: parsed,
            contractText: returnText,
            klassifikation,
            risk_level: riskLevel,
            should_escalate: shouldEscalate,
        })

    } catch (err: unknown) {
        logWarn("gennemgang", "Request fejlede", { error: errorMessage(err) })
        return NextResponse.json(
            { error: errorMessage(err, "Ukendt serverfejl") },
            { status: 500 }
        )
    }
}
