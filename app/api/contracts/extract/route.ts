export const dynamic = "force-dynamic"
/**
 * app/api/contracts/extract/route.ts
 *
 * Extracts structured contract data from PDF, DOCX or TXT files.
 * Files are processed in memory — never persisted here.
 * Personal data (CPR, phone, email, address, CVR, IBAN, account numbers)
 * is masked BEFORE the text is sent to the AI.
 *
 * Auth: /api er IKKE dækket af middleware, så ruten beskytter sig selv —
 * enten et gyldigt service-secret (bearer) eller en admin-session.
 */

import { NextRequest, NextResponse } from "next/server"
import mammoth from "mammoth"
import { extractPdfText } from "@/lib/pdf-parse"
import { maskPersonalData } from "@/lib/mask-text"
import { createClient as createSessionClient } from "@/lib/supabase/server"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
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

        const formData = await req.formData()

        // Hvis klienten allerede har maskeret teksten (efter brugerbekræftelse), brug den direkte
        const preMasked = formData.get("maskedText") as string | null
        let masked: string

        if (preMasked) {
            masked = preMasked
        } else {
            const file = formData.get("file") as File | null
            if (!file) return NextResponse.json({ error: "Ingen fil modtaget" }, { status: 400 })

            const filename = file.name.toLowerCase()
            const buffer = Buffer.from(await file.arrayBuffer())

            let text: string
            if (filename.endsWith(".pdf")) {
                text = await extractPdfText(buffer)
            } else if (filename.endsWith(".docx")) {
                const result = await mammoth.extractRawText({ buffer })
                text = result.value
            } else if (filename.endsWith(".txt")) {
                text = buffer.toString("utf-8")
            } else {
                return NextResponse.json({ error: "Filformat ikke understøttet — brug PDF, DOCX eller TXT" }, { status: 400 })
            }

            masked = maskPersonalData(text)
        }

        const result = await runContractExtraction(masked)
        if (!result.ok) return NextResponse.json({ error: result.error ?? "Udtræk fejlede" }, { status: 500 })
        return NextResponse.json({ ok: true, data: result.data, navneTjek: result.navneTjek })
    } catch (err: unknown) {
        console.error("Extract fejl:", err)
        return NextResponse.json({ error: err instanceof Error ? err.message : "Ukendt fejl" }, { status: 500 })
    }
}
