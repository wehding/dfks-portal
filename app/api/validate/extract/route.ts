export const dynamic = "force-dynamic"
/**
 * app/api/validate/extract/route.ts
 *
 * Henter en kontrakt fra Supabase Storage og kører AI-udtræk.
 * Bruges af valideringssiden når kontrakten er gemt i Storage
 * (fx ved portal-upload) og admin ikke har filen lokalt.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdmin } from "@supabase/supabase-js"
import mammoth from "mammoth"
import { extractPdfText } from "@/lib/pdf-parse"
import { maskPersonalData } from "@/lib/mask-text"
import { getApiKey } from "@/lib/ai-key-store"
import { SOURCES_SCHEMA_PROMPT, normaliseSources } from "@/lib/ai-sources"
import {
    CONTRACT_TYPE_RULE, COLLECTIVE_AGREEMENT_RULE,
    COLLECTIVE_AGREEMENT_BY_REFERENCE_RULE, IS_FREELANCE_CONTRACT_RULE,
    HOLIDAY_PAY_RATE_RULE, BETA_RATE_RULE,
} from "@/lib/ai-fields"

// eslint-disable-next-line @typescript-eslint/no-require-imports
// pdf-parse loaded lazily in handler to avoid DOMMatrix build error

const SYSTEM_PROMPT = `Du er ekspert i at udtrække strukturerede data fra danske filmkontrakter.
Returner KUN JSON — ingen forklaringstekst.`

const EXTRACTION_PROMPT = `Udtræk følgende data fra kontrakten og returner som JSON:
{
  "employerName": "producentens/arbejdsgiverens FIRMANAVN — det juridiske selskab der er kontraktpart. Find selskabsnavnet øverst i kontrakten i partsafsnittet, typisk efterfulgt af adresse og CVR-nummer. Selskabet kan være defineret som 'Virksomheden', 'Producenten', 'Arbejdsgiveren' eller lignende i kontrakten — brug det faktiske navn, ikke den interne betegnelse. VIGTIGT: Formuleringer som 'refererer til producent [navn]', 'kontaktperson: [navn]', 'projektleder: [navn]' angiver en PERSON hos producenten — brug aldrig dette personnavn som employerName. Tag i stedet det selskabsnavn der optræder som kontraktpart med CVR-nummer. Enkeltmandsvirksomheder uden ApS/A/S er gyldige firmanavne. ALDRIG et rent personnavn. (string|null)",
  "rightsHolderName": "klipperens/medarbejderens/leverandørens fulde PERSONNAVN — den fysiske person der udfører klippearbejdet. Søg efter den part der er markeret som 'Klipper', 'Medarbejder', 'Leverandør' eller lignende. ALDRIG et firmanavn. (string|null)",
  "workTitle": "produktionens titel (string|null)",
  "contractType": "${CONTRACT_TYPE_RULE}",
  "overenskomst": "de4-fiktion|faf|faf-dokumentar|ingen (string|null)",
  "contractDate": "ISO 8601 (string|null)",
  "startDate": "ISO 8601 (string|null)",
  "endDate": "ISO 8601 (string|null)",
  "productionType": "én af: feature, tvSeries, documentary, docSeries, short, tvEntertainment, reality, other. Hvis kontrakten nævner afsnit, episoder, sæson eller episodenumre → tvSeries eller docSeries. (string|null)",
  "salary": "bruttoløn som tal (number|null)",
  "salaryUnit": "monthly|weekly|daily|total (string|null)",
  "pensionPercent": "tal (number|null)",
  "pensionSupplement": "tal i kr (number|null)",
  "personalSupplement": "personligt tillæg som TAL i kr. — KUN hvis der er et konkret kr.-beløb aftalt som personligt tillæg. Eksempel: 'personligt tillæg på 1.500 kr.' → 1500. Hvis tillægget kun beskrives som tekst uden beløb, sæt null og brug otherSupplements i stedet. (number|null)",
  "otherSupplements": "andre tillæg der ikke kan udtrykkes som et enkelt tal — fx procenttillæg, variable tillæg, natkørselsgodtgørelse, kostpenge, eller tillæg der ikke er personlige tillæg. Fritekst. (string|null)",
  "workingWeeks": "tal (number|null)",
  "holidayPayRate": "${HOLIDAY_PAY_RATE_RULE}",
  "betaRate": "${BETA_RATE_RULE}",
  "svod": "boolean",
  "copydan": "boolean",
  "royalty": "boolean. (1) Spillefilm og dokumentar: true automatisk. (2) TV-serie/docSeries: kun true hvis dedikeret royalty-afsnit — IKKE fra Create Denmark/SVOD.",
  "royaltyPercent": "tal (number|null)",
  "aiDataMiningClause": "boolean",
  "distribution": "platforme kommasepareret (string|null)",
  "collectiveAgreement": "${COLLECTIVE_AGREEMENT_RULE}",
  "collectiveAgreementName": "overenskomstens navn (string|null)",
  "collectiveAgreementByReference": "${COLLECTIVE_AGREEMENT_BY_REFERENCE_RULE}",
  "isFreelanceContract": "${IS_FREELANCE_CONTRACT_RULE}",
  "gender": "male|female|null",
  "specialNotes": "bemærkninger (string|null)",
  ${SOURCES_SCHEMA_PROMPT}
}`

export async function POST(req: NextRequest) {
    try {
        const { contractId, pdfPath } = await req.json()
        if (!contractId && !pdfPath) {
            return NextResponse.json({ error: "contractId eller pdfPath påkrævet" }, { status: 400 })
        }

        const apiKey = getApiKey("anthropic")
        if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY mangler" }, { status: 500 })

        // Hent PDF fra Supabase Storage
        const admin = createAdmin(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { autoRefreshToken: false, persistSession: false } }
        )

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
        let activeSystemPrompt = SYSTEM_PROMPT + "\n\n" + EXTRACTION_PROMPT
        try {
            const { data: refDocs } = await admin
                .from("reference_docs")
                .select("title, doc_subtype, content_text")
                .eq("archived", false)
                .not("content_text", "is", null)
            if (refDocs?.length) {
                activeSystemPrompt += "\n\n──────────────────────────────────────\nREFERENCEDOKUMENTER:\n──────────────────────────────────────"
                for (const doc of refDocs) {
                    activeSystemPrompt += `\n\n${doc.doc_subtype ?? doc.title}:\n${doc.content_text}`
                }
            }
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
                model: "claude-haiku-4-5-20251001",
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

        return NextResponse.json({ ok: true, data: extracted, maskedText: masked })
    } catch (err: any) {
        console.error("[validate/extract]", err)
        return NextResponse.json({ error: err.message ?? "Ukendt fejl" }, { status: 500 })
    }
}
