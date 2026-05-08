/**
 * lib/ai.ts
 * Claude-powered contract screening for DFKS Portal.
 * Called from the admin validation page to auto-populate extractedData.
 */

import type { ExtractedContractData } from "./types"

// ── Anonymisation ─────────────────────────────────────────────
// Removes personally identifiable data before sending to AI API.
// Salary amounts, dates and production metadata are preserved
// as these are needed for extraction.

export function anonymizeContractText(text: string): string {
    return text
        // CPR: DDMMYY-XXXX or DDMMYYXXXX
        .replace(/\b\d{6}[-–]\d{4}\b/g, "[CPR]")
        .replace(/\b\d{10}\b(?!\s*(?:kr|%|\.))/g, "[CPR]")
        // IBAN
        .replace(/\bDK\d{2}[\s]*\d{4}[\s]*\d{10}\b/gi, "[IBAN]")
        // Danish bank: reg.nr (4 digits) + account (6–10 digits)
        .replace(/\b\d{4}[\s–-]\d{6,10}\b/g, "[KONTONR]")
        // Email
        .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[EMAIL]")
        // Phone: +45 XX XX XX XX or 8-digit groups
        .replace(/(\+45[\s-]?)?\b\d{2}[\s-]\d{2}[\s-]\d{2}[\s-]\d{2}\b/g, "[TELEFON]")
        // Standalone 8-digit numbers that aren't amounts (no kr/% after)
        .replace(/\b(\d{8})\b(?!\s*(?:kr|%))/g, (_, n) => {
            // Keep if it looks like a year-adjacent number or a production number
            if (/19\d{2}|20\d{2}/.test(n)) return n
            return "[NUMMER]"
        })
        // Names after common Danish contract patterns
        .replace(/(Undertegnede|Ansatte|Klipper(?:en)?|Freelancer|mellem)\s+([A-ZÆØÅ][a-zæøå]+(?: [A-ZÆØÅ][a-zæøå]+)+)/g,
            (_, prefix) => `${prefix} [NAVN]`)
}

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
    // DOCX
    if (file.name.endsWith(".docx") || file.name.endsWith(".doc") ||
        file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        const mammoth = await import("mammoth")
        const arrayBuffer = await file.arrayBuffer()
        const result = await mammoth.extractRawText({ arrayBuffer })
        if (!result.value.trim()) throw new Error("Ingen tekst fundet i Word-dokumentet")
        return result.value
    }

    // Plain text
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

    // Normalize PDF text artifacts: remove spaces within numbers/dates
    // e.g. "1 7,6" → "17,6", "27 /10/2025" → "27/10/2025"
    text = text
        .replace(/(\d) (\d)/g, "$1$2")
        .replace(/(\d) \/ (\d)/g, "$1/$2")
        .replace(/(\d)\/ (\d)/g, "$1/$2")
        .replace(/(\d) \/(\d)/g, "$1/$2")

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

// ── Personal data masking ────────────────────────────────────
// Masks sensitive personal data before sending to AI API.
// The original text is kept locally for display and highlighting.

export function maskPersonalData(text: string): string {
    return text
        // CPR-nummer: 6 cifre, bindestreg, 4 cifre (ddmmyy-xxxx)
        .replace(/\b\d{6}[-–]\d{4}\b/g, "[CPR-NUMMER]")
        // Bankkontonummer: reg.nr + kontonr (4 cifre + 6-10 cifre)
        .replace(/\b\d{4}[\s-]\d{6,10}\b/g, "[KONTONUMMER]")
        // IBAN
        .replace(/\b[A-Z]{2}\d{2}[\s]?(?:\d{4}[\s]?){3,6}\d{1,4}\b/g, "[IBAN]")
        // Telefonnumre: danske formater (+45 xx xx xx xx, xx xx xx xx, 8 cifre i træk)
        .replace(/(?:\+45[\s-]?)?\b(?:\d{2}[\s-]){3}\d{2}\b/g, "[TELEFON]")
        .replace(/\b\d{8}\b(?!\s*(?:kr|dkk|,-|%|uger|timer|moms))/gi, "[TELEFON]")
        // Email-adresser
        .replace(/\b[A-ZÆØÅa-zæøå0-9._%+\-]+@[A-ZÆØÅa-zæøå0-9.\-]+\.[A-Za-z]{2,}\b/g, "[EMAIL]")
        // Adresser: gadenavn + husnummer (simpelt mønster)
        .replace(/\b[A-ZÆØÅ][a-zæøå]+(?:vej|gade|alle|allé|stræde|plads|vænge|torv|have|park|skov|mark)\s+\d+[A-Za-z]?(?:,?\s*\d{1,2}\.?\s*(?:th|tv|mf|sal)?)?\b/gi, "[ADRESSE]")
        // Postnummer + by (4 cifre efterfulgt af bynavn)
        .replace(/\b\d{4}\s+[A-ZÆØÅ][a-zæøå]+(?:\s+[A-ZÆØÅ][a-zæøå]+)?\b/g, "[POSTNR-BY]")
        // CVR-nummer: 8 cifre (kun hvis ledsaget af "cvr" i nærheden)
        .replace(/\b(?:cvr\.?(?:[-–\s]?nr\.?)?\s*:?\s*)\d{8}\b/gi, "CVR: [CVR-NUMMER]")
}



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
      "salary": "EKSAKT tekststreng fra kontrakten der indeholder honoraret — kopiér sætningen der nævner beløbet, f.eks. 'grundløn på __14.637__ DKK pr. uge' eller 'honorar på 45.000 kr. pr. måned' — max 120 tegn eller null",
      "pension": "EKSAKT og UNIK tekststreng der kun findes i pensionsafsnittet — brug f.eks. procentsatsen med ord der omgiver den: '9,5 % af grundlønnen' eller 'pensionsbidrag (9,5 %' — vælg den korteste streng der KUN forekommer i pensionsafsnittet og ingen andre steder (max 60 tegn) eller null",
      "supplements": "EKSAKT tekststreng der indeholder afsnittet om personlige tillæg inkl. selve beløbet — kopiér fra 'personlige tillæg' og frem til beløbet, f.eks. 'personlige tillæg:___1.586' eller 'følgende personlige tillæg:' — max 60 tegn eller null",
      "dates": "EKSAKT tekststreng der viser ansættelsesperioden — kopiér sætningen med start- og slutdato, f.eks. 'fra den 26. august til 24. november 2024' eller 'ansættelsesperioden er 01.01.2024 - 31.03.2024' — max 80 tegn eller null",
      "workingWeeks": "EKSAKT og KORT tekststreng der viser det SAMLEDE antal uger — KUN selve ugetallet med umiddelbar kontekst, f.eks. 'engageret i 9 uger', '17,6 weeks', 'i alt 11,6 uger' — STOP før datoer og andre oplysninger. Max 30 tegn. Null hvis intet samlet ugetal findes.",
      "collectiveAgreement": "EKSAKT tekststreng der nævner overenskomst — kopiér den FULDE sætning inkl. eventuelle Copydan-forbehold og SVOD-aftale hvis de er nævnt i samme sætning, f.eks. 'I øvrigt henvises til gældende Fiktionsoverenskomst mellem De4 og Producentforeningen af 7.februar 2022 med det moderniserede Copydan-forbehold og SVOD-aftale' — max 200 tegn eller null",
      "copydan": "Kopiér den KOMPLETTE tekstpassage der omhandler Copydan-forbehold — START altid fra afsnittets allerførste ord eller overskrift (f.eks. 'Third party (Copy-dan) reservation' eller 'Copydan-forbehold'). Kopier hele afsnittet inkl. overskrift. Max 400 tegn. Null hvis Copydan ikke nævnes.",
      "svod": "Kopiér den KOMPLETTE tekstpassage der omhandler SVOD/streaming eller Create Denmark — START altid fra afsnittets allerførste ord. Inkluder hele afsnittet. Max 400 tegn. Null hvis ikke nævnes.",
      "royalty": "Kopiér den KOMPLETTE tekstpassage der omhandler et specifikt royalty-forbehold med en konkret aftale om royaltybetaling — KUN hvis der er et dedikeret royalty-afsnit adskilt fra SVOD/streaming. Royalties der blot nævnes i SVOD-afsnittet tæller IKKE. Max 400 tegn. Null hvis ikke relevant."
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
    "svod": "true hvis SVOD/streaming-rettigheder er i behold. VIGTIGT: Når Create Denmark er nævnt som den organisation der forhandler rettigheder eller administrerer rettighedsbetaling på vegne af rettighedshaverne, er det et SVOD-forbehold — sæt svod til true. Create Denmark er netop det organ der forhandler SVOD-rettigheder i Danmark. Sæt også true hvis SVOD er eksplicit nævnt, eller hvis overenskomsten er inkorporeret og dækker streaming-rettigheder.",
    "copydan": "true hvis Copydan-vederlag eller Copydan-forbehold er i behold — enten eksplicit nævnt eller inkorporeret via overenskomst.",
    "royalty": "true hvis der er et royalty-forbehold i kontrakten, ELLER hvis produktionstype er feature (spillefilm) og distribution inkluderer biograf/theatrical — overenskomsten giver royalty-ret ved biografdistribution. false for tv-serier, streaming-only og dokumentar uden biografdistribution. Det er forbeholdet der markeres, ikke om betaling er garanteret.",
    "royaltyPercent": null,
    "aiDataMiningClause": false,
    "distribution": [],
    "collectiveAgreement": "true KUN hvis kontrakten er indgået direkte under overenskomsten som en A-lønskontrakt. Sæt false hvis det er en leverandørkontrakt (CVR-nummer, moms, selvstændig) — selv hvis overenskomstens vilkår er inkorporeret ved reference. Inkorporering ved reference er IKKE det samme som at kontrakten er en overenskomstkontrakt.",
    "collectiveAgreementName": null,
    "isFreelanceContract": "true hvis kontrakten er en leverandørkontrakt (CVR-nummer, moms, selvstændig erhvervsdrivende) — false hvis det er en lønmodtagerkontrakt",
    "collectiveAgreementByReference": "true hvis overenskomstens vilkår er inkorporeret ved reference selv om kontrakten ikke er en overenskomstkontrakt — f.eks. 'the terms set forth therein shall supplement' — ellers false",
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
- VIGTIGT — Inkorporering ved reference: Hvis en kontrakt (også leverandørkontrakter og engelsksprogede kontrakter) eksplicit inkorporerer overenskomsten ved reference — selv med formuleringer som "does not apply directly, but the terms shall supplement" eller "selv om overenskomsten ikke gælder direkte, finder dens vilkår anvendelse som supplement" — så behandles overenskomstens rettigheder som gældende. Det betyder at svod, copydan og øvrige overenskomstrettigheder sættes til true, og collectiveAgreement sættes til true. Sæt et info-flag der forklarer at overenskomsten er inkorporeret ved reference. VIGTIGT: En leverandørkontrakt med CVR-nummer er stadig en leverandørkontrakt selv om overenskomstens vilkår finder anvendelse som supplement — sæt i så fald specialNotes til at angive at det er en leverandørkontrakt hvor overenskomstens vilkår er inkorporeret ved reference. Forveksl ikke "overenskomstens vilkår gælder som supplement" med "kontrakten er en overenskomstkontrakt".
- VIGTIGT — Alt-inklusivt honorar: Hvis kontrakten angiver at honoraret inkluderer pension, feriepenge eller sociale omkostninger ("the fee includes any and all social costs", "honoraret er inklusiv pension og feriepenge" eller lignende), skal dette flages som warning — ikke critical. Rettighedsmæssigt er kontrakten stadig OK hvis overenskomsten er inkorporeret. Men det skal bemærkes at producenten ikke indbetaler pension og feriepenge separat oveni honoraret, hvilket afviger fra overenskomstens normale struktur. Angiv i flaget at klipperen selv skal håndtere pension og feriepenge af honoraret, og at den effektive løn dermed er lavere end honoraret umiddelbart antyder. Sæt pensionPercent og holidayPayRate til null da de er inkluderet i honoraret. Denne situation alene bør ikke føre til overallVerdict = critical.
- Privatkopiering og Copydan: Hvis kontrakten eksplicit nævner at medarbejderen/klipperen bevarer retten til vederlag for privatkopiering (f.eks. "retains the right to compensation for private copying", "bevarer ret til privatkopiering", reference til ophavsretslovens §39-46a eller tilsvarende) — noter dette i specialNotes og sæt copydan til true. Det er en lovhjemlet ret der bekræfter at Copydan-vederlag er i behold, og det bør fremhæves som en positiv bemærkning til klipperen.
- salary skal være et rent tal (ingen valutasymboler)
- Datoer på formatet YYYY-MM-DD
- aiDataMiningClause = true hvis kontrakten indeholder AI/data mining-forbehold
- productionType skal ALTID udfyldes — gæt ud fra kontekst hvis det ikke er eksplicit nævnt. En kontrakt med en stor dansk produktionsselskab og ingen seriestruktur er sandsynligvis feature. Nævnes afsnit/episoder er det tvSeries eller docSeries.`

export function buildSystemPrompt(): string {
    let prompt = BASE_SYSTEM

    if (_references.length > 0) {
        prompt +=
            "\n\n---\nFØLGENDE OVERENSKOMSTER OG REFERENCEDOKUMENTER ER GÆLDENDE BAGGRUNDSVIDEN.\n" +
            "Skeln mellem fiktion og dokumentar og brug kun relevante dokumenter.\n\n" +
            "NÅR EN KONTRAKT HENVISER TIL OVERENSKOMSTEN — enten direkte eller ved inkorporering ved reference — skal du aktivt gennemgå den relevante overenskomst herunder og tjekke:\n" +
            "1. Hvilke rettigheder er dækket af overenskomsten? (SVOD, Copydan, royalty, pension, feriepenge, kreditering osv.)\n" +
            "2. Er disse rettigheder eksplicit nævnt eller udeladt i selve kontrakten?\n" +
            "3. Afviger kontraktens vilkår fra overenskomstens på nogen punkt — løn, pension, rettigheder, opsigelse?\n" +
            "Flag kun afvigelser, ikke forhold der allerede er dækket af overenskomsten.\n\n" +
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

// ── Portal contract screening ────────────────────────────────
// Lighter prompt for the klipper portal: extracts only the fields
// needed to pre-fill the upload form (title, category, role, etc.)

function buildPortalSystem(roles: string[]): string {
    const roleList = roles.length > 0
        ? roles.map(r => `"${r}"`).join(", ")
        : '"Klipper"'
    return `Du er assistent der hjælper klippere med at udfylde en uploadformular baseret på deres kontrakt.

Returner KUN gyldig JSON uden markdown-backticks — præcis denne struktur:

{
  "title": "produktionens titel (string eller null)",
  "category": "feature|short|tvSeries|documentary|docSeries|tvEntertainment|reality|sport eller null",
  "creditedRole": "VÆLG præcis én af disse roller baseret på kontraktens funktionsbetegnelse: ${roleList} — eller null hvis rollen ikke fremgår",
  "duration": "samlet varighed i hele minutter som tal — 0 for serier eller hvis ukendt",
  "premiereDate": "YYYY-MM-DD eller null",
  "episodes": [{"number": 1, "title": "Afsnit 1", "duration": 45}]
}

Regler:
- creditedRole: returner ALTID præcis ét af de listede rollnavne — kopiér stavningen nøjagtigt. Vigtigt: "Editor", "Film Editor", "Supervising Editor", "Monteur", "Montage", "Cutter", "Picture Editor" er alle synonymer for "Klipper" — vælg altid "Klipper" for disse funktioner uanset om kontrakten er på dansk, engelsk eller fransk
- category baseres på produktionstype: spillefilm/feature film → feature, tv-serie/dramaserie → tvSeries, dokumentarfilm → documentary, dokumentarserie → docSeries, kortfilm → short, tv-show/underholdning → tvEntertainment, reality → reality, sport → sport
- episodes skal KUN udfyldes hvis det er en serie (tvSeries eller docSeries) og kontrakten nævner specifikke afsnit med titler og/eller varighed. Ellers returner tom liste []
- duration for serier sættes til summen af episodes hvis de er kendte, ellers 0
- Returner null for felter du ikke kan finde i kontrakten`
}

export interface PortalScreeningResult {
    title: string | null
    category: string | null
    creditedRole: string | null
    duration: number
    premiereDate: string | null
    episodes: { number: number; title: string; duration: number }[]
}

export async function screenPortalContract(contractText: string, availableRoles: string[] = []): Promise<PortalScreeningResult> {
    const safeText = anonymizeContractText(contractText)
    const resp = await fetch("/api/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system: buildPortalSystem(availableRoles),
            userMessage: "Analyser denne kontrakt og returner JSON til formularen:\n\n" + safeText.slice(0, 30000),
        }),
    })
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.error ?? `Fejl ${resp.status}`)
    }
    const data = await resp.json()
    if (data.error) throw new Error(data.error)
    return data.result as PortalScreeningResult
}

// ── Main screening function ──────────────────────────────────

export async function screenContract(
    contractText: string
): Promise<ScreeningResult> {
    const systemPrompt = buildSystemPrompt()
    const safeText = anonymizeContractText(contractText)

    // Call our server-side proxy to avoid CORS restrictions
    const response = await fetch("/api/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system: systemPrompt,
            userMessage:
                "Analyser denne kontrakt og returner JSON:\n\n" +
                safeText.slice(0, 40000),
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
