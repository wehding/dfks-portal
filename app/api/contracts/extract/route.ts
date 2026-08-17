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
import { extractPdfText } from "@/lib/pdf-parse"
import { extractWordText } from "@/lib/word-text"
import { maskPersonalData } from "@/lib/mask-text"
import { createClient as createSessionClient } from "@/lib/supabase/server"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { runContractExtraction } from "@/lib/contract-extract-core"
import { isInternalWorkerSecret } from "@/lib/api-auth"
import { consumeRateLimit, requestIdentifier } from "@/lib/server/rate-limit"

const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_MASKED_TEXT_CHARS = 250_000

async function authorize(req: NextRequest): Promise<{ orgId: string | null; userId: string | null } | null> {
    const authHeader = req.headers.get("authorization") ?? ""
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null
    if (isInternalWorkerSecret(bearer, "contract-ai")) return { orgId: null, userId: null }
    const sessionClient = await createSessionClient()
    const caller = await assertAdminRole(sessionClient)
    return caller ? { orgId: caller.orgId, userId: caller.userId } : null
}

export async function POST(req: NextRequest) {
    try {
        const caller = await authorize(req)
        if (!caller) {
            return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })
        }
        const contentLength = Number(req.headers.get("content-length") ?? 0)
        if (contentLength > MAX_FILE_BYTES + 2 * 1024 * 1024) {
            return NextResponse.json({ error: "Filen må højst fylde 25 MB." }, { status: 413 })
        }
        const rateLimit = await consumeRateLimit({
            bucket: "contract-extract",
            identifier: requestIdentifier(req.headers),
            limit: 30,
            windowMs: 60 * 60 * 1000,
        })
        if (!rateLimit.allowed) {
            return NextResponse.json({ error: "For mange analyseforsøg. Prøv igen senere." }, {
                status: 429,
                headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
            })
        }

        const formData = await req.formData()

        // Hvis klienten allerede har maskeret teksten (efter brugerbekræftelse), brug den direkte
        const preMasked = formData.get("maskedText") as string | null
        let masked: string
        let pdfBuffer: Buffer | null = null

        if (preMasked) {
            if (preMasked.length > MAX_MASKED_TEXT_CHARS) {
                return NextResponse.json({ error: "Teksten er for lang til én analyse." }, { status: 413 })
            }
            masked = preMasked
        } else {
            const file = formData.get("file") as File | null
            if (!file) return NextResponse.json({ error: "Ingen fil modtaget" }, { status: 400 })
            if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "Filen må højst fylde 25 MB." }, { status: 413 })

            const filename = file.name.toLowerCase()
            if (!filename.endsWith(".pdf") && !filename.endsWith(".docx") && !filename.endsWith(".doc") && !filename.endsWith(".txt")) {
                return NextResponse.json({ error: "Filformat ikke understøttet — brug PDF, DOC, DOCX eller TXT" }, { status: 400 })
            }
            const buffer = Buffer.from(await file.arrayBuffer())

            let text = ""
            if (filename.endsWith(".pdf")) {
                text = await extractPdfText(buffer)
                pdfBuffer = buffer
            } else if (filename.endsWith(".docx") || filename.endsWith(".doc")) {
                text = await extractWordText(buffer, file.name)
            } else if (filename.endsWith(".txt")) {
                text = buffer.toString("utf-8")
            }

            masked = maskPersonalData(text).slice(0, MAX_MASKED_TEXT_CHARS)
        }

        const result = await runContractExtraction(masked, {
            source: "api",
            pdfBuffer,
            orgId: caller.orgId,
            actorUserId: caller.userId,
        })
        if (!result.ok) return NextResponse.json({ error: "Kontrakten kunne ikke analyseres." }, { status: 502 })
        return NextResponse.json({ ok: true, data: result.data, navneTjek: result.navneTjek })
    } catch (err: unknown) {
        console.error("[contract-extract] extraction failed", err instanceof Error ? err.name : "unknown")
        return NextResponse.json({ error: "Kontrakten kunne ikke analyseres." }, { status: 500 })
    }
}
