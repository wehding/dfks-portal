export const dynamic = "force-dynamic"
/**
 * app/api/validate/extract/route.ts
 *
 * Henter en kontrakt fra Supabase Storage og kører AI-udtræk.
 * Bruges af valideringssiden når kontrakten er gemt i Storage
 * (fx ved portal-upload) og admin ikke har filen lokalt.
 *
 * Auth: /api er IKKE dækket af middleware — ruten henter vilkårlige
 * storage-filer med service-rettigheder og kræver derfor en admin-session
 * (eller et service-secret ved server-til-server-kald).
 */

import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { createClient as createSessionClient } from "@/lib/supabase/server"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { extractPdfText, extractPdfTextWithLayout } from "@/lib/pdf-parse"
import { extractWordText, extractWordTextWithLayout } from "@/lib/word-text"
import { maskPersonalData } from "@/lib/mask-text"
import { runContractExtraction } from "@/lib/contract-extract-core"
import { isInternalWorkerSecret } from "@/lib/api-auth"
import { buildPdfLayout, buildDocxLayout } from "@/lib/contract-layout"
import type { ContractLayout } from "@/lib/contract-layout"

async function authorization(req: NextRequest): Promise<{ internal: true; orgId: null } | { internal: false; orgId: string } | null> {
    const authHeader = req.headers.get("authorization") ?? ""
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null
    if (isInternalWorkerSecret(bearer, "contract-ai")) return { internal: true, orgId: null }
    const sessionClient = await createSessionClient()
    const caller = await assertAdminRole(sessionClient)
    return caller ? { internal: false, orgId: caller.orgId } : null
}

export async function POST(req: NextRequest) {
    try {
        const auth = await authorization(req)
        if (!auth) {
            return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })
        }

        const { contractId, pdfPath } = await req.json()
        if (!contractId && !pdfPath) {
            return NextResponse.json({ error: "contractId eller pdfPath påkrævet" }, { status: 400 })
        }

        const admin = createServiceClient()

        // En browserbruger må ikke vælge en vilkårlig service-role storage-sti.
        // Stien afledes altid af en kontrakt i den aktive organisation.
        if (!auth.internal && !contractId) {
            return NextResponse.json({ error: "contractId er påkrævet" }, { status: 400 })
        }

        let storagePath = auth.internal ? pdfPath : null
        let orgId: string | null = null
        if (contractId) {
            let contractQuery = admin.from("contracts").select("pdf_url,processed_pdf_url,org_id").eq("id", contractId)
            if (!auth.internal) contractQuery = contractQuery.eq("org_id", auth.orgId)
            const { data: contract } = await contractQuery.maybeSingle()
            if (!contract) return NextResponse.json({ error: "Kontrakten blev ikke fundet i den aktive organisation" }, { status: 404 })
            storagePath = contract?.processed_pdf_url ?? contract?.pdf_url
            orgId = contract?.org_id ?? null
        }
        if (!storagePath) return NextResponse.json({ error: "Ingen PDF-sti fundet" }, { status: 404 })

        const { data: fileData, error: dlErr } = await admin.storage.from("kontrakter").download(storagePath)
        if (dlErr || !fileData) return NextResponse.json({ error: "Kontraktdokumentet kunne ikke hentes" }, { status: 500 })
        const buffer = Buffer.from(await fileData.arrayBuffer())
        const ext = storagePath.split(".").pop()?.toLowerCase()

        let text: string
        let layout: ContractLayout | null = null
        if (ext === "pdf") {
            text = await extractPdfText(buffer)
            // Lag 4: byg layout parallelt med tekstudtrækket
            try {
                const fragments = await extractPdfTextWithLayout(buffer)
                layout = buildPdfLayout(fragments)
            } catch { /* layout er best-effort */ }
        } else if (ext === "docx" || ext === "doc") {
            text = await extractWordText(buffer, storagePath)
            try {
                const docxLayout = await extractWordTextWithLayout(buffer, storagePath)
                layout = buildDocxLayout(docxLayout)
            } catch { /* layout er best-effort */ }
        } else {
            text = buffer.toString("utf-8")
        }

        const masked = maskPersonalData(text)

        // Gem layout til contracts-tabellen (best-effort, blokerer ikke udtræk)
        if (layout && contractId) {
            admin.from("contracts").update({ layout_data: layout }).eq("id", contractId)
                .then(({ error }) => { if (error) console.error("[validate/extract] layout_data gem fejl:", error.message) })
        }

        const result = await runContractExtraction(masked, { orgId, entityId: contractId, source: "admin", pdfBuffer: ext === "pdf" ? buffer : null })
        if (!result.ok) return NextResponse.json({ error: result.error ?? "Udtræk fejlede" }, { status: 500 })

        return NextResponse.json({ ok: true, data: result.data, navneTjek: result.navneTjek, maskedText: masked, layout })
    } catch (err: unknown) {
        console.error("[validate/extract]", err)
        return NextResponse.json({ error: "Kontrakten kunne ikke analyseres" }, { status: 500 })
    }
}
