export const dynamic = "force-dynamic"
/**
 * app/api/validate/extract/route.ts
 *
 * Henter en kontrakt fra Supabase Storage og kører AI-udtræk.
 * Bruges af valideringssiden når kontrakten er gemt i Storage
 * (fx ved portal-upload) og admin ikke har filen lokalt.
 */

import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
// Note: storage download bruger direkte fetch (omgår SDK JWT-validering for storage)
import mammoth from "mammoth"
import { extractPdfText } from "@/lib/pdf-parse"
import { maskPersonalData } from "@/lib/mask-text"
import { getApiKey } from "@/lib/ai-key-store"
import { normaliseSources } from "@/lib/ai-sources"
import { tjekNavn } from "@/lib/rettighedshaver-tjek"
import { buildContractExtractionPrompt, CONTRACT_EXTRACTION_MODEL } from "@/lib/contract-extraction-prompt"

export async function POST(req: NextRequest) {
    try {
        const { contractId, pdfPath } = await req.json()
        if (!contractId && !pdfPath) {
            return NextResponse.json({ error: "contractId eller pdfPath påkrævet" }, { status: 400 })
        }

        const apiKey = getApiKey("anthropic")
        if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY mangler" }, { status: 500 })

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

        // Hent overenskomsttekster fra DB
        let activeSystemPrompt = buildContractExtractionPrompt()
        try {
            const { data: refDocs } = await admin
                .from("reference_docs")
                .select("title, doc_subtype, content_text")
                .eq("archived", false)
                .not("content_text", "is", null)
            activeSystemPrompt = buildContractExtractionPrompt(refDocs ?? undefined)
        } catch (e) {
            console.warn("[validate/extract] Kunne ikke hente reference docs:", e)
        }

        // Kald Anthropic
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: CONTRACT_EXTRACTION_MODEL,
                max_tokens: 4096,
                system: activeSystemPrompt,
                messages: [{ role: "user", content: `---KONTRAKT---\n${masked.slice(0, 40000)}` }],
            }),
        })
        if (!response.ok) throw new Error(`Anthropic fejl: ${response.status}`)
        const aiData = await response.json()
        const raw = aiData.content?.[0]?.text ?? ""

        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) return NextResponse.json({ error: "Ugyldigt AI-svar" }, { status: 500 })

        const extracted = JSON.parse(jsonMatch[0])
        if (extracted._sources) extracted._sources = normaliseSources(extracted._sources)

        // Navnetjek mod DFKS-register (server-side, kun full_name)
        let navneTjek = null
        if (extracted.rightsHolderName) {
            try {
                navneTjek = await tjekNavn(extracted.rightsHolderName)
            } catch (e) {
                console.warn("[validate/extract] Navnetjek fejlede:", e)
            }
        }

        return NextResponse.json({ ok: true, data: extracted, navneTjek, maskedText: masked })
    } catch (err: unknown) {
        console.error("[validate/extract]", err)
        return NextResponse.json({ error: err instanceof Error ? err.message : "Ukendt fejl" }, { status: 500 })
    }
}
