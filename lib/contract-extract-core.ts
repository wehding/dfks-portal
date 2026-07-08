/**
 * lib/contract-extract-core.ts
 *
 * Kerne-logik for AI-kontraktudtræk. Kaldes både af API-ruterne
 * (contracts/extract, validate/extract) OG direkte server-side af
 * jobs/process — sidstnævnte uden HTTP-runde, så batch-udtrækket ikke
 * afhænger af en åben, uautentificeret /api-rute.
 *
 * Forudsætter at teksten allerede er maskeret (personoplysninger fjernet).
 */

import { getApiKey } from "@/lib/ai-key-store"
import { createClient } from "@supabase/supabase-js"
import { tjekNavn } from "@/lib/rettighedshaver-tjek"
import { normaliseSources } from "@/lib/ai-sources"
import { buildContractExtractionPrompt, CONTRACT_EXTRACTION_MODEL } from "@/lib/contract-extraction-prompt"

export type ContractExtractionResult = {
    ok: boolean
    data?: Record<string, unknown>
    navneTjek?: unknown
    error?: string
}

// AI'en får kun de første CONTRACT_TEXT_LIMIT tegn. Længere kontrakter
// afkortes (rettighedsklausuler står ofte til sidst — se advarsel nedenfor).
const CONTRACT_TEXT_LIMIT = 40000

async function callAnthropic(maskedText: string, apiKey: string, systemPrompt: string): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: CONTRACT_EXTRACTION_MODEL,
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: "user", content: `---KONTRAKT---\n${maskedText.slice(0, CONTRACT_TEXT_LIMIT)}` }],
        }),
    })
    if (!res.ok) throw new Error(`Anthropic fejl: ${res.status}`)
    const data = await res.json()
    return data.content?.[0]?.text ?? ""
}

export async function runContractExtraction(maskedText: string): Promise<ContractExtractionResult> {
    const apiKey = getApiKey("anthropic")
    if (!apiKey) return { ok: false, error: "Anthropic API-nøgle mangler" }

    // Hent overenskomsttekster som baggrundsviden til prompten
    let systemPrompt = buildContractExtractionPrompt()
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
        systemPrompt = buildContractExtractionPrompt(refDocs ?? undefined)
    } catch (e) {
        console.warn("[contract-extract] Kunne ikke hente reference docs:", e)
    }

    const raw = await callAnthropic(maskedText, apiKey, systemPrompt)

    // Udtræk JSON mellem første { og sidste } (håndterer prose-wrapping)
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { ok: false, error: "Kunne ikke parse AI-svar" }

    const extracted = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    if (extracted._sources && typeof extracted._sources === "object") {
        extracted._sources = normaliseSources(extracted._sources as Record<string, string | null>)
    }

    // Advar hvis kontrakten blev afkortet — rettighedsklausuler (Copydan/SVOD/
    // Create Denmark) står typisk til sidst og kan være klippet væk.
    if (maskedText.length > CONTRACT_TEXT_LIMIT) {
        extracted._truncated = true
        const advarsel = `⚠ ADVARSEL: Kontrakten er meget lang (${maskedText.length.toLocaleString("da-DK")} tegn) og blev afkortet til de første ${CONTRACT_TEXT_LIMIT.toLocaleString("da-DK")} tegn ved AI-læsning. Kontrollér især rettighedsklausuler til sidst i dokumentet.`
        extracted.specialNotes = extracted.specialNotes ? `${advarsel}\n${String(extracted.specialNotes)}` : advarsel
        console.warn(`[contract-extract] Kontrakt afkortet: ${maskedText.length} > ${CONTRACT_TEXT_LIMIT} tegn`)
    }

    // Navnetjek mod DFKS-register (kun full_name)
    let navneTjek: unknown = null
    if (extracted.rightsHolderName) {
        try {
            navneTjek = await tjekNavn(String(extracted.rightsHolderName))
        } catch (e) {
            console.warn("[contract-extract] Navnetjek fejlede:", e)
        }
    }

    return { ok: true, data: extracted, navneTjek }
}
