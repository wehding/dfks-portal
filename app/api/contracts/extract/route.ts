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
import { SOURCES_SCHEMA_PROMPT, normaliseSources } from "@/lib/ai-sources"
import {
    CONTRACT_TYPE_RULE,
    COLLECTIVE_AGREEMENT_RULE,
    COLLECTIVE_AGREEMENT_BY_REFERENCE_RULE,
    IS_FREELANCE_CONTRACT_RULE,
    HOLIDAY_PAY_RATE_RULE,
    BETA_RATE_RULE,
} from "@/lib/ai-fields"

// pdf-parse v2 exports PDFParse class (not a function like v1)
// eslint-disable-next-line @typescript-eslint/no-require-imports

const SYSTEM_PROMPT = `Du er ekspert i at udtrække strukturerede data fra danske filmkontrakter.
Din opgave er at læse kontrakten og returnere et JSON-objekt med præcis de felter der er angivet.
Vær præcis — brug null for felter der ikke fremgår af kontrakten. Brug aldrig gæt.
Returner KUN JSON — ingen forklaringstekst.

VIGTIGT — Maskerede tokens: Kontraktteksten er forbehandlet og personoplysninger er erstattet med tokens:
[CPR-NUMMER], [KONTONUMMER], [IBAN], [TELEFON], [EMAIL], [ADRESSE], [POSTNR-BY], [CVR-NUMMER].
Disse tokens er IKKE de faktiske værdier — returner null for felter der kun indeholder et token uden anden kontekst.
Navne (personnavne og firmanavne) maskeres IKKE og fremgår fuldt ud af teksten.`

const EXTRACTION_PROMPT = `Udtræk følgende data fra denne kontrakt og returner som JSON.
Returner KUN JSON — ingen forklaringstekst.

{
  "employerName": "producentens/arbejdsgiverens FIRMANAVN — det juridiske selskab der er kontraktpart. Find selskabsnavnet øverst i kontrakten i partsafsnittet, typisk efterfulgt af adresse og CVR-nummer. Selskabet kan være defineret som 'Virksomheden', 'Producenten', 'Arbejdsgiveren' eller lignende i kontrakten — brug det faktiske navn, ikke den interne betegnelse. VIGTIGT: Formuleringer som 'refererer til producent [navn]', 'kontaktperson: [navn]', 'projektleder: [navn]' angiver en PERSON hos producenten — brug aldrig dette personnavn som employerName. Tag i stedet det selskabsnavn der optræder som kontraktpart med CVR-nummer. Enkeltmandsvirksomheder uden ApS/A/S er gyldige firmanaVNE. ALDRIG et rent personnavn. (string | null)",
  "parentCompanyName": "moderselskabets firmanavn som fremgår af header, footer, brevhoved eller kontraktens første side — typisk et holding- eller produktionsselskab der er overordnet arbejdsgiveren. Kun firmanavne — aldrig personnavne. Sæt null hvis ikke identificerbart adskilt fra employerName. (string | null)",
  "rightsHolderName": "klipperens/medarbejderens/leverandørens fulde PERSONNAVN — den fysiske person der udfører klippearbejdet. Søg efter den part der er markeret som 'Klipper', 'Medarbejder', 'Leverandør' eller lignende. ALDRIG et firmanavn. (string | null)",
  "workTitle": "produktionens/filmens titel (string | null)",
  "contractType": "${CONTRACT_TYPE_RULE}",
  "overenskomst": "én af: de4-fiktion, faf, faf-dokumentar, ingen (string | null)",
  "contractDate": "kontraktens dato ISO 8601 (string | null)",
  "startDate": "ansættelsens startdato ISO 8601 (string | null)",
  "endDate": "ansættelsens slutdato ISO 8601 (string | null)",

  "productionType": "én af: feature, tvSeries, documentary, docSeries, short, tvEntertainment, reality, other. VIGTIGE REGLER: Hvis kontrakten nævner 'afsnit', 'episode', 'sæson', episodenumre (fx 'afsnit 5+6', 'episode 3-7', 'sæson 2') eller et antal afsnit → brug tvSeries (fiktion) eller docSeries (dokumentar). Spillefilm/feature er altid ét samlet værk uden episoder. Dokumentarfilm med afsnit → docSeries. Returner præcis én af de nævnte værdier eller null.",
  "salary": "bruttoløn som tal uden valuta (number | null)",
  "salaryUnit": "monthly, weekly eller daily (string | null)",
  "pensionPercent": "pensionsprocent som tal (number | null)",
  "pensionSupplement": "pensionssupplement i kr. som tal (number | null)",
  "personalSupplement": "personligt tillæg som TAL i kr. — KUN hvis der er et konkret kr.-beløb aftalt som personligt tillæg. Eksempel: 'personligt tillæg på 1.500 kr.' → 1500. Hvis tillægget kun beskrives som tekst uden beløb, sæt null og brug otherSupplements i stedet. (number | null)",
  "otherSupplements": "andre tillæg der ikke kan udtrykkes som et enkelt tal — fx procenttillæg, variable tillæg, natkørselsgodtgørelse, kostpenge, eller tillæg der ikke er personlige tillæg. Fritekst. (string | null)",
  "workingWeeks": "antal arbejdsuger som tal (number | null)",
  "holidayPayRate": "${HOLIDAY_PAY_RATE_RULE}",
  "betaRate": "${BETA_RATE_RULE}",

  "svod": "har kontrakten SVOD/streaming-rettigheder? (boolean)",
  "copydan": "har kontrakten Copydan-forbehold? Sæt true hvis kontrakten eksplicit nævner Copydan, aftalelicens, eksemplarfremstilling til privat brug, ophavsretslovens §§ 39-46a, eller kollektivt forvaltningsselskab i forbindelse med rettigheder der tilkommer klipper/leverandør. Sæt IKKE false blot fordi SVOD er overdraget — Copydan og SVOD er uafhængige rettigheder. (boolean)",
  "royalty": "har kontrakten royalty? (boolean). REGLER: (1) Spillefilm (feature) og dokumentarfilm: true automatisk — royalty er standard. (2) TV-serier (tvSeries, docSeries): ALDRIG true automatisk — kun hvis dedikeret royalty-afsnit adskilt fra SVOD/streaming. (3) Royalty nævnt i Create Denmark/SVOD-klausulen tæller IKKE som royalty-klausul — sæt false.",
  "royaltyPercent": "royaltyprocent som tal (number | null)",
  "aiDataMiningClause": "har kontrakten AI/data mining-forbehold? (boolean)",
  "distribution": "distributionsplatforme kommasepareret (string | null)",

  "collectiveAgreement": "${COLLECTIVE_AGREEMENT_RULE}",
  "collectiveAgreementName": "overenskomstens navn (string | null)",
  "collectiveAgreementByReference": "${COLLECTIVE_AGREEMENT_BY_REFERENCE_RULE}",
  "isFreelanceContract": "${IS_FREELANCE_CONTRACT_RULE}",
  "gender": "male, female eller null (string | null)",

  "hasCreditClause": "er der en krediteringsklausul? (boolean)",
  "hasTerminationClause": "er der en opsigelsesklausul? (boolean)",
  "terminationDaysEditor": "klipperens opsigelsesvarsel i dage (number | null)",
  "terminationDaysProducer": "producentens opsigelsesvarsel i dage (number | null)",
  "hasIndemnification": "er der en skadesløsholdelsesklausul? (boolean)",
  "hasOverenskomstIncorporation": "er overenskomst inkorporeret i leverandørkontrakt? (boolean)",

  "specialNotes": "særlige bemærkninger der bør noteres (string | null)",

${SOURCES_SCHEMA_PROMPT}
}`

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

        // Hent overenskomsttekster fra DB — samme som gennemgang-ruten
        let activeSystemPrompt = SYSTEM_PROMPT + "\n\n" + EXTRACTION_PROMPT
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

            if (refDocs?.length) {
                activeSystemPrompt += "\n\n──────────────────────────────────────\nREFERENCEDOKUMENTER — BRUG SOM BAGGRUNDSVIDEN:\n──────────────────────────────────────"
                for (const doc of refDocs) {
                    activeSystemPrompt += `\n\n${doc.doc_subtype ?? doc.title}:\n${doc.content_text}`
                }
            }
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
        return NextResponse.json({ ok: true, data: extracted })

    } catch (err: any) {
        console.error("Extract fejl:", err)
        return NextResponse.json({ error: err.message ?? "Ukendt fejl" }, { status: 500 })
    }
}

async function extractFromText(text: string, apiKey: string, systemPrompt?: string): Promise<string> {
    const body = {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        system: systemPrompt ?? (SYSTEM_PROMPT + "\n\n" + EXTRACTION_PROMPT),
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
