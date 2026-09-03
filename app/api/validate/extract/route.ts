export const dynamic = "force-dynamic"
// Et fuldt kontrakt-udtræk (klassificér → udtræk → efterbehandling via AI)
// tager typisk 60–120 s. Uden dette dræber Vercel funktionen undervejs.
export const maxDuration = 300
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
import { buildPdfLayout, buildDocxLayout, buildAnnotatedContractText } from "@/lib/contract-layout"
import type { ContractLayout } from "@/lib/contract-layout"
import { enrichSourcesWithClauseIds } from "@/lib/contract-layout-store"
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit"

async function authorization(req: NextRequest): Promise<{ internal: true; orgId: null; userId: null; role: "integration" } | { internal: false; orgId: string; userId: string; role: string } | null> {
    const authHeader = req.headers.get("authorization") ?? ""
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null
    if (isInternalWorkerSecret(bearer, "contract-ai")) return { internal: true, orgId: null, userId: null, role: "integration" }
    const sessionClient = await createSessionClient()
    const caller = await assertAdminRole(sessionClient)
    return caller ? { internal: false, orgId: caller.orgId, userId: caller.userId, role: caller.role } : null
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
        let targetMemberUuid: string | null = null
        if (contractId) {
            let contractQuery = admin.from("contracts").select("pdf_url,processed_pdf_url,org_id,rights_holder_id").eq("id", contractId)
            if (!auth.internal) contractQuery = contractQuery.eq("org_id", auth.orgId)
            const { data: contract } = await contractQuery.maybeSingle()
            if (!contract) return NextResponse.json({ error: "Kontrakten blev ikke fundet i den aktive organisation" }, { status: 404 })
            storagePath = contract?.processed_pdf_url ?? contract?.pdf_url
            orgId = contract?.org_id ?? null
            targetMemberUuid = contract?.rights_holder_id ?? null
        }
        if (!storagePath) return NextResponse.json({ error: "Ingen PDF-sti fundet" }, { status: 404 })

        const { data: fileData, error: dlErr } = await admin.storage.from("kontrakter").download(storagePath)
        if (dlErr || !fileData) return NextResponse.json({ error: "Kontraktdokumentet kunne ikke hentes" }, { status: 500 })
        const buffer = Buffer.from(await fileData.arrayBuffer())
        const ext = storagePath.split(".").pop()?.toLowerCase()

        // Byg layout (lag 1+2) — er den primære tekstkilde til AI-input.
        // Annoteret tekst med inline [sX_cY]-tags erstatter extractPdfText() som AI-input
        // så AI'en altid læser fra samme kilde som koordinaterne er bygget af.
        let layout: ContractLayout | null = null
        let aiText: string

        if (ext === "pdf") {
            try {
                const fragments = await extractPdfTextWithLayout(buffer)
                layout = buildPdfLayout(fragments)
            } catch { /* layout best-effort — fallback til plain text */ }
            aiText = layout
                ? maskPersonalData(buildAnnotatedContractText(layout))
                : maskPersonalData(await extractPdfText(buffer))
        } else if (ext === "docx" || ext === "doc") {
            try {
                const docxLayout = await extractWordTextWithLayout(buffer, storagePath)
                layout = buildDocxLayout(docxLayout)
            } catch { /* layout best-effort — fallback til plain text */ }
            aiText = layout
                ? maskPersonalData(buildAnnotatedContractText(layout))
                : maskPersonalData(await extractWordText(buffer, storagePath))
        } else {
            aiText = maskPersonalData(buffer.toString("utf-8"))
        }

        // Gem layout til contracts-tabellen (best-effort, blokerer ikke udtræk)
        if (layout && contractId) {
            admin.from("contracts").update({ layout_data: layout }).eq("id", contractId)
                .then(({ error }) => { if (error) console.error("[validate/extract] layout_data gem fejl:", error.message) })
        }

        const result = await runContractExtraction(aiText, { orgId, entityId: contractId, source: "admin", pdfBuffer: ext === "pdf" ? buffer : null, layout })
        if (!result.ok) return NextResponse.json({ error: result.error ?? "Udtræk fejlede" }, { status: 500 })

        // Fallback: server-side klausul-ID korrelation for felter AI'en ikke returnerede et ID for.
        // Primærvejen er nu at AI'en aflæser [sX_cY]-tagget direkte fra den annoterede tekst.
        if (result.data?._sources && layout) {
            result.data._sources = enrichSourcesWithClauseIds(result.data._sources as Record<string, string | null>, layout) as typeof result.data._sources
        }

        await recordSensitiveFlow({
            actor: { userId: auth.userId, orgId, role: auth.role, source: auth.internal ? "api" : "admin" },
            action: "ai_analysis",
            component: "validate.contract-extract",
            entityType: "contracts",
            entityId: contractId ?? null,
            targetMemberUuid,
            orgIds: orgId ? [orgId] : [],
            purposeCode: "contract_validation",
            legalBasis: "GDPR Art. 6(1)(b)/(f) og 9(2)(d)",
            dataCategories: ["contract_data", "salary_data", "ai_analysis"],
        })

        return NextResponse.json({ ok: true, data: result.data, navneTjek: result.navneTjek, maskedText: aiText, layout })
    } catch (err: unknown) {
        console.error("[validate/extract]", err)
        return NextResponse.json({ error: "Kontrakten kunne ikke analyseres" }, { status: 500 })
    }
}
