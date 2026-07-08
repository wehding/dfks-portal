export const dynamic = "force-dynamic"
/**
 * app/api/contracts/extract/route.ts
 *
 * Extracts structured contract data from PDF, DOCX or TXT files.
 * Returns all fields needed for contract_validations + basic contract metadata.
 * Files are processed in memory — never persisted here.
 *
 * Personal data (CPR, phone, email, address, CVR, IBAN, account numbers)
 * is masked BEFORE the text is sent to the AI.
 */

import { NextRequest, NextResponse } from "next/server"
import mammoth from "mammoth"
import { getApiKey } from "@/lib/ai-key-store"
import { extractPdfText } from "@/lib/pdf-parse"
import { maskPersonalData } from "@/lib/mask-text"
import { createClient } from "@supabase/supabase-js"
import { tjekNavn } from "@/lib/rettighedshaver-tjek"
import { normaliseSources } from "@/lib/ai-sources"
import { buildContractExtractionPrompt, CONTRACT_EXTRACTION_MODEL } from "@/lib/contract-extraction-prompt"

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData()
        const apiKey = getApiKey("anthropic")
        if (!apiKey) return NextResponse.json({ error: "Anthropic API-nøgle mangler" }, { status: 500 })

        // If client already masked text (after user confirmation), use it directly
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

            // Mask personal data before sending to AI
            masked = maskPersonalData(text)
        }

        // Hent overenskomsttekster fra DB — samme prompt-builder som validate/extract
        let activeSystemPrompt = buildContractExtractionPrompt()
        try {
            const supabase = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
                { auth: { autoRefreshToken: false, persistSession: false } }
            )
            const { data: refDocs } = await supabase
                .from("reference_docs")
                .select("title, doc_subtype, content_text")
                .eq("archived", false)
                .not("content_text", "is", null)

            activeSystemPrompt = buildContractExtractionPrompt(refDocs ?? undefined)
        } catch (e) {
            console.warn("[contracts/extract] Kunne ikke hente reference docs:", e)
        }

        const raw = await extractFromText(masked, apiKey, activeSystemPrompt)

        // Parse JSON from AI response
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) return NextResponse.json({ error: "Kunne ikke parse AI-svar" }, { status: 500 })

        const extracted = JSON.parse(jsonMatch[0])
        if (extracted._sources && typeof extracted._sources === "object") {
            extracted._sources = normaliseSources(extracted._sources)
        }

        // Navnetjek mod DFKS-register (server-side, kun full_name)
        let navneTjek = null
        if (extracted.rightsHolderName) {
            try {
                navneTjek = await tjekNavn(extracted.rightsHolderName)
            } catch (e) {
                console.warn("[contracts/extract] Navnetjek fejlede:", e)
            }
        }

        return NextResponse.json({ ok: true, data: extracted, navneTjek })

    } catch (err: unknown) {
        console.error("Extract fejl:", err)
        return NextResponse.json({ error: err instanceof Error ? err.message : "Ukendt fejl" }, { status: 500 })
    }
}

async function extractFromText(text: string, apiKey: string, systemPrompt?: string): Promise<string> {
    const body = {
        model: CONTRACT_EXTRACTION_MODEL,
        max_tokens: 4096,
        system: systemPrompt ?? buildContractExtractionPrompt(),
        messages: [{
            role: "user",
            content: `---KONTRAKT---\n${text.slice(0, 40000)}`,
        }],
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Anthropic fejl: ${res.status}`)
    const data = await res.json()
    return data.content?.[0]?.text ?? ""
}
