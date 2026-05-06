/**
 * lib/ai.ts
 * Claude-powered contract screening for DFKS Portal.
 * Called from the admin validation page to auto-populate extractedData.
 */

import type { ExtractedContractData } from "./types"

// ── Types ────────────────────────────────────────────────────

export type FlagSeverity = "critical" | "warning" | "info"

export interface ContractFlag {
    category: string
    severity: FlagSeverity
    title: string
    description: string
    quote?: string
}

export interface ScreeningResult {
    extractedData: ExtractedContractData
    flags: ContractFlag[]
    recommendations: string[]
    overallVerdict: "approved" | "review" | "critical"
    profMember: boolean | null   // null = unknown
    detectedProducer: string | null
    contractType: "fiction" | "documentary" | "unknown"
    parties: string[]
    period: string
}

// ── Reference store (module-level singleton) ─────────────────
// Populated via setReferences() from the overenskomster admin page.

export interface ReferenceDoc {
    id: string
    name: string
    type:
        | "Fiktion-overenskomst"
        | "Dokumentar-overenskomst"
        | "Lønskema (fiktion)"
        | "Lønskema (dokumentar)"
        | "Standardkontrakt — fiktion (A-løn)"
        | "Standardkontrakt — fiktion (leverandør)"
        | "Standardkontrakt — dokumentar (A-løn)"
        | "Standardkontrakt — dokumentar (leverandør)"
        | "Reference"
    text: string
    addedAt: string
}

export interface MemberList {
    raw: string
    parsed: string[]
    updatedAt: string | null
}

let _references: ReferenceDoc[] = []
let _memberList: MemberList = { raw: "", parsed: [], updatedAt: null }

export function setReferences(refs: ReferenceDoc[]) {
    _references = refs
}

export function setMemberList(list: MemberList) {
    _memberList = list
}

export function getReferences(): ReferenceDoc[] {
    return _references
}

export function getMemberList(): MemberList {
    return _memberList
}

// ── PDF text extraction ──────────────────────────────────────

export async function extractTextFromFile(file: File): Promise<string> {
    // Plain text files
    if (!file.name.endsWith(".pdf") && file.type !== "application/pdf") {
        return new Promise((res, rej) => {
            const r = new FileReader()
            r.onload = (e) => res(e.target?.result as string)
            r.onerror = rej
            r.readAsText(file, "utf-8")
        })
    }

    // PDF: use the pdfjs that is already bundled with react-pdf
    // Polyfill URL.parse which older pdfjs versions expect
    if (typeof window !== "undefined" && !(URL as any).parse) {
        ;(URL as any).parse = (val: string, base?: string) => {
            try { return new URL(val, base) } catch { return null }
        }
    }

    const { pdfjs } = await import("react-pdf")
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"

    const arrayBuffer = await file.arrayBuffer()
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer })
    const pdf = await loadingTask.promise

    let text = ""
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        text += content.items.map((item: any) => item.str).join(" ") + "\n"
    }

    if (!text.trim()) {
        throw new Error(
            "Ingen søgbar tekst fundet i PDF. Dokumentet er sandsynligvis scannet (billede). Prøv at OCR-behandle det først."
        )
    }

    return text
}

// ── Member list helpers ──────────────────────────────────────

function normalize(s: string): string {
    return s
        .toLowerCase()
        .replace(/\b(aps|a\/s|as|film|production|productions|denmark|dk)\b/g, "")
        .replace(/[^a-zæøå0-9]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

export function checkMembership(
    producerName: string | null,
    members: string[]
): boolean | null {
    if (!producerName || members.length === 0) return null
    const pNorm = normalize(producerName)
    return members.some((m) => {
        const mNorm = normalize(m)
        return (
            pNorm.includes(mNorm) ||
            mNorm.includes(pNorm) ||
            (pNorm.length > 4 && mNorm.length > 4 && mNorm.startsWith(pNorm.slice(0, 6)))
        )
    })
}

// ── System prompt ────────────────────────────────────────────

const BASE_SYSTEM = `Du er ekspert i danske filmkontrakter og overenskomster, særligt De4-overenskomsten (fiktion) og FAF-overenskomsten (dokumentar). Du analyserer kontrakter for DFKS — Dansk Filmklipperselskab.

Returner KUN gyldig JSON uden markdown-backticks eller forklaringer udenfor JSON. Brug præcis denne struktur:

{
  "contractType": "fiction|documentary|unknown",
  "parties": ["string"],
  "period": "string",
  "detectedProducer": "string or null",
  "profMember": null,

  "extractedData": {
    "producerName": "string or null",
    "_sources": {
      "salary": "EKSAKT tekststreng fra kontrakten der viser honoraret (max 120 tegn) eller null",
      "pension": "EKSAKT og UNIK tekststreng der kun findes i pensionsafsnittet — brug f.eks. procentsatsen med ord der omgiver den: '9,5 % af grundlønnen' eller 'pensionsbidrag (9,5 %' — vælg den korteste streng der KUN forekommer i pensionsafsnittet og ingen andre steder (max 60 tegn) eller null",
      "supplements": "EKSAKT tekststreng der indeholder afsnittet om personlige tillæg inkl. selve beløbet — kopiér fra 'personlige tillæg' og frem til beløbet, f.eks. 'personlige tillæg:___1.586' eller 'følgende personlige tillæg:' — max 60 tegn eller null",
      "dates": "EKSAKT tekststreng der viser periode/datoer eller null",
      "rights": "EKSAKT tekststreng der viser rettighedsforbehold (SVOD/Copydan/royalty) eller null",
      "workingHours": "EKSAKT tekststreng der viser arbejdstid eller null",
      "collectiveAgreement": "EKSAKT tekststreng der nævner overenskomst eller null"
    },
    "productionType": "Returner EN af disse værdier baseret på kontraktens indhold og kontekst: feature (spillefilm/biograffilm), tvSeries (tv-serie/dramaserie/sæson), documentary (dokumentarfilm/enkelt dokumentar), docSeries (dokumentarserie), short (kortfilm), tvEntertainment (tv-underholdning/show/program), reality (reality-tv), other (alt andet). Hvis kontrakten nævner ord som spillefilm, feature film, biograffilm → brug feature. Tv-serie, dramaserie, sæson → tvSeries. Dokumentar → documentary. Er du i tvivl, gæt ud fra genre, producent og distributionsplatform.",
    "salary": null,
    "salaryUnit": "monthly|weekly|daily|total",
    "startDate": "YYYY-MM-DD or null",
    "endDate": "YYYY-MM-DD or null",
    "pensionPercent": null,
    "pensionSupplement": null,
    "personalSupplement": null,
    "otherSupplements": "string or null",
    "workingWeeks": null,
    "svod": false,
    "copydan": false,
    "royalty": false,
    "royaltyPercent": null,
    "aiDataMiningClause": false,
    "distribution": [],
    "collectiveAgreement": false,
    "collectiveAgreementName": null,
    "gender": null,
    "holidayPayRate": null,
    "betaRate": null,
    "specialNotes": null
  },

  "flags": [
    {
      "category": "Rettighedsbetaling|Ophavret|Løn|Pension|Feriepenge|Kreditering|Opsigelse|AI-klausul|Overenskomst",
      "severity": "critical|warning|info",
      "title": "string",
      "description": "string",
      "quote": "string (max 160 tegn fra kontrakten, eller null)"
    }
  ],

  "recommendations": ["string"],
  "overallVerdict": "approved|review|critical"
}

Vigtige regler:
- Marker KUN som critical/warning hvis kontrakten AFVIGER fra overenskomsten — ikke hvis overenskomsten allerede dækker forholdet
- Hvis kontrakten henviser til "overenskomsten" uden at specificere, antag at den gældende overenskomst dækker
- salary skal være et rent tal (ingen valutasymboler)
- Datoer på formatet YYYY-MM-DD
- aiDataMiningClause = true hvis kontrakten indeholder AI/data mining-forbehold
- productionType skal ALTID udfyldes — gæt ud fra kontekst hvis det ikke er eksplicit nævnt. En kontrakt med en stor dansk produktionsselskab og ingen seriestruktur er sandsynligvis feature. Nævnes afsnit/episoder er det tvSeries eller docSeries.`

export function buildSystemPrompt(): string {
    let prompt = BASE_SYSTEM

    if (_references.length > 0) {
        prompt +=
            "\n\n---\nFØLGENDE OVERENSKOMSTER OG REFERENCEDOKUMENTER ER GÆLDENDE BAGGRUNDSVIDEN.\n" +
            "Skeln mellem fiktion og dokumentar og brug kun relevante dokumenter.\n" +
            "For lønskemaer: sammenlign honoraret med de gældende satser og flag afvigelser.\n" +
            "For standardkontrakter: tjek om kontrakten svarer til A-løn- eller leverandørversionen.\n\n" +
            _references
                .map((r) => `=== ${r.name} (${r.type}) ===\n${r.text.slice(0, 8000)}`)
                .join("\n\n")
    }

    if (_memberList.parsed.length > 0) {
        prompt +=
            "\n\n---\nPRODUCENTFORENINGENS (ProF) MEDLEMMER — kun disse er juridisk bundet af overenskomsten:\n" +
            _memberList.parsed.join("\n") +
            "\n\nIdentificer producenten i kontrakten. Sæt profMember til true/false/null baseret på listen. " +
            "Hvis producenten IKKE er på listen: noter det i flags som info, og tilføj '(Producenten er ikke ProF-medlem og er ikke juridisk bundet af overenskomsten)' til relevante critical-flags."
    }

    return prompt
}

// ── Main screening function ──────────────────────────────────

export async function screenContract(
    contractText: string
): Promise<ScreeningResult> {
    const systemPrompt = buildSystemPrompt()

    // Call our server-side proxy to avoid CORS restrictions
    const response = await fetch("/api/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system: systemPrompt,
            userMessage:
                "Analyser denne kontrakt og returner JSON:\n\n" +
                contractText.slice(0, 40000),
        }),
    })

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(err.error ?? `Serverfejl ${response.status}`)
    }

    const data = await response.json()
    if (data.error) throw new Error(data.error)

    // Server already parsed the JSON — use directly
    const parsed: ScreeningResult = data.result

    // Client-side membership cross-check
    if (_memberList.parsed.length > 0 && parsed.detectedProducer) {
        const clientCheck = checkMembership(
            parsed.detectedProducer,
            _memberList.parsed
        )
        if (parsed.profMember === null) {
            parsed.profMember = clientCheck
        }
    }

    return parsed
}
