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
import mammoth from "mammoth"
import { extractPdfText } from "@/lib/pdf-parse"
import { maskPersonalData } from "@/lib/mask-text"
import { runContractExtraction } from "@/lib/contract-extract-core"

async function isAuthorized(req: NextRequest): Promise<boolean> {
    const secret = process.env.CONTRACT_AI_JOB_SECRET
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get("authorization") ?? ""
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null
    if (bearer && ((secret && bearer === secret) || (cronSecret && bearer === cronSecret))) return true
    const sessionClient = await createSessionClient()
    return Boolean(await assertAdminRole(sessionClient, ["superadmin", "admin", "org-admin"]))
}

export async function POST(req: NextRequest) {
    try {
        if (!(await isAuthorized(req))) {
            return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })
        }

        const { contractId, pdfPath } = await req.json()
        if (!contractId && !pdfPath) {
            return NextResponse.json({ error: "contractId eller pdfPath påkrævet" }, { status: 400 })
        }

        const admin = createServiceClient()

        let storagePath = pdfPath
        if (!storagePath && contractId) {
            const { data: contract } = await admin.from("contracts").select("pdf_url").eq("id", contractId).single()
            storagePath = contract?.pdf_url
        }
        if (!storagePath) return NextResponse.json({ error: "Ingen PDF-sti fundet" }, { status: 404 })

        const { data: fileData, error: dlErr } = await admin.storage.from("kontrakter").download(storagePath)
        if (dlErr || !fileData) return NextResponse.json({ error: `Kunne ikke hente PDF: ${dlErr?.message}` }, { status: 500 })
        const buffer = Buffer.from(await fileData.arrayBuffer())
        const ext = storagePath.split(".").pop()?.toLowerCase()

        let text: string
        if (ext === "pdf") {
            text = await extractPdfText(buffer)
        } else if (ext === "docx") {
            const result = await mammoth.extractRawText({ buffer })
            text = result.value
        } else {
            text = buffer.toString("utf-8")
        }

        const masked = maskPersonalData(text)

        const result = await runContractExtraction(masked)
        if (!result.ok) return NextResponse.json({ error: result.error ?? "Udtræk fejlede" }, { status: 500 })

        return NextResponse.json({ ok: true, data: result.data, navneTjek: result.navneTjek, maskedText: masked })
    } catch (err: unknown) {
        console.error("[validate/extract]", err)
        return NextResponse.json({ error: err instanceof Error ? err.message : "Ukendt fejl" }, { status: 500 })
    }
}
