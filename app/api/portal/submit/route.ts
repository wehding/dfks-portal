/**
 * POST /api/portal/submit
 *
 * Hurtig indsendelse fra brugerportalen:
 *   1. Gem filen i Supabase Storage
 *   2. Indsæt contract_reviews-række med ai_status = 'analyserer'
 *   3. Returner { success: true, review_id } øjeblikkeligt
 *   4. Kick AI-analysen asynkront via waitUntil (Vercel) eller fire-and-forget fetch
 *
 * Brugeren venter IKKE på AI — de ser kvittering med det samme.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"

const DFKS_ORG_ID = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5"

function getAdmin() {
    return createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )
}

export async function POST(req: NextRequest) {
    // ── Auth ──────────────────────────────────────────────────
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 })

    const admin = getAdmin()

    // ── Parse form-data ───────────────────────────────────────
    let formData: FormData
    try {
        formData = await req.formData()
    } catch {
        return NextResponse.json({ error: "Ugyldig form-data" }, { status: 400 })
    }

    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "Ingen fil" }, { status: 400 })

    const memberName         = formData.get("memberName")          as string | null
    const memberEmail        = formData.get("memberEmail")         as string | null
    const contractType       = formData.get("contractType")        as string | null
    const productionType     = formData.get("productionType")      as string | null
    const producerName       = formData.get("producerName")        as string | null
    const producerOverenskomst = formData.get("producerOverenskomst") as string | null
    const distributionRaw    = formData.get("distributionChannels") as string | null
    const focusAreasRaw      = formData.get("focusAreas")          as string | null
    const notes              = formData.get("notes")               as string | null

    const distributionChannels: string[] = distributionRaw
        ? (distributionRaw.startsWith("[") ? JSON.parse(distributionRaw) : distributionRaw.split(",").filter(Boolean))
        : []

    const focusAreas = focusAreasRaw
        ? (focusAreasRaw.startsWith("[") ? JSON.parse(focusAreasRaw) : focusAreasRaw.split(",").filter(Boolean))
        : []

    // ── Gem fil i Storage ─────────────────────────────────────
    let storagePath: string | null = null
    try {
        const ts = Date.now()
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
        storagePath = `${DFKS_ORG_ID}/${ts}_${safeName}`
        const fileBuffer = Buffer.from(await file.arrayBuffer())
        const { error: storageErr } = await admin.storage
            .from("contract-reviews")
            .upload(storagePath, fileBuffer, {
                contentType: file.type || "application/octet-stream",
                upsert: false,
            })
        if (storageErr) {
            console.warn("[portal/submit] Storage upload fejlede:", storageErr.message)
            storagePath = null
        }
    } catch (e) {
        console.warn("[portal/submit] Storage exception:", e)
        storagePath = null
    }

    // ── Opret contract_reviews-række øjeblikkeligt ────────────
    const { data: review, error: insertErr } = await admin
        .from("contract_reviews")
        .insert({
            org_id:          DFKS_ORG_ID,
            member_id:       user.id,
            member_name:     memberName ?? user.user_metadata?.full_name ?? null,
            member_email:    memberEmail ?? user.email ?? null,
            status:          "afventer",
            ai_status:       "analyserer",
            file_name:       file.name,
            file_size_bytes: file.size,
            storage_path:    storagePath,
            contract_type:               contractType ?? null,
            production_type:             productionType ?? null,
            distribution_channels:       distributionChannels.length ? distributionChannels : null,
            producer_name:               producerName ?? null,
            producer_overenskomst_bound: producerOverenskomst === "true"  ? true
                                       : producerOverenskomst === "false" ? false
                                       : null,
            focus_areas:                 focusAreas.length ? focusAreas : null,
            notes:                       notes ?? null,
        })
        .select("id")
        .single()

    if (insertErr || !review) {
        console.error("[portal/submit] INSERT fejl:", insertErr)
        return NextResponse.json({ error: "Kunne ikke gemme kontrakten" }, { status: 500 })
    }

    const reviewId = review.id

    // ── Returner straks — AI køres asynkront ─────────────────
    // Brug Vercel waitUntil hvis tilgængeligt, ellers fire-and-forget
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? `https://${req.headers.get("host")}`

    // Capture non-null references for the async closure
    const capturedFile = file!
    const capturedUser = user!

    async function runAnalysis() {
        try {
            // Hent filen fra storage (eller brug original buffer)
            let analysisFile: File
            if (storagePath) {
                const { data: fileData } = await admin.storage
                    .from("contract-reviews")
                    .download(storagePath)
                analysisFile = fileData
                    ? new File([fileData], capturedFile.name, { type: capturedFile.type })
                    : capturedFile
            } else {
                analysisFile = capturedFile
            }

            const fd = new FormData()
            fd.append("file",          analysisFile)
            fd.append("orgId",         DFKS_ORG_ID)
            fd.append("memberId",      capturedUser.id)
            if (memberEmail)   fd.append("memberEmail",   memberEmail)
            if (memberName)    fd.append("memberName",    memberName)
            if (contractType)               fd.append("contractType",         contractType)
            if (productionType)             fd.append("productionType",        productionType)
            if (distributionChannels.length) fd.append("distributionChannels", JSON.stringify(distributionChannels))
            if (producerName)               fd.append("producerName",          producerName)
            if (producerOverenskomst)       fd.append("producerOverenskomst",  producerOverenskomst)
            if (focusAreas.length)          fd.append("focusAreas",            JSON.stringify(focusAreas))
            if (notes)                      fd.append("notes",                 notes)
            // Marker at filen allerede er gemt — gennemgang skal ikke gemme på ny
            fd.append("existingReviewId", reviewId)

            // Inkluder invite-cookie så middleware-gate ikke blokerer det interne kald
            const internalHeaders: HeadersInit = {}
            if (process.env.INVITE_CODE) {
                internalHeaders["Cookie"] = `dfks_invite=${process.env.INVITE_CODE}`
            }

            const resp = await fetch(`${baseUrl}/api/gennemgang`, {
                method: "POST",
                headers: internalHeaders,
                body: fd,
            })

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}))
                throw new Error(err.error ?? `HTTP ${resp.status}`)
            }

            const data = await resp.json()

            // Opdater review med AI-resultat
            await admin
                .from("contract_reviews")
                .update({
                    ai_result:       data.result,
                    ai_run_at:       new Date().toISOString(),
                    ai_language:     data.klassifikation?.kontraktsprog ?? "da",
                    risk_level:      data.risk_level ?? null,
                    should_escalate: data.should_escalate ?? null,
                    ai_status:       "klar",
                })
                .eq("id", reviewId)

            console.log("[portal/submit] Analyse fuldført for review:", reviewId)
        } catch (e) {
            console.error("[portal/submit] Analyse fejlede for review:", reviewId, e)
            // Marker som fejlet i DB så admin kan se det
            await admin
                .from("contract_reviews")
                .update({ ai_status: "fejl" })
                .eq("id", reviewId)
        }
    }

    // Vercel understøtter waitUntil via AsyncLocalStorage på edge/node runtime
    // Next.js 15+: brug `after()` fra "next/server" — fallback: fire-and-forget
    try {
        const { after } = await import("next/server")
        after(runAnalysis())
    } catch {
        // Fallback: fire-and-forget (virker på de fleste Vercel-deployments)
        runAnalysis().catch(e => console.error("[portal/submit] fire-and-forget fejl:", e))
    }

    return NextResponse.json({ success: true, review_id: reviewId })
}
