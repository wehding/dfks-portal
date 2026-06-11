/**
 * app/api/gennemgang/route.ts
 *
 * To-trins kontraktgennemgang:
 *   Trin 1 — Klassificér kontrakten (kort, isoleret kald)
 *   Trin 2 — Analyser og skriv feedbackmail
 *             (klassifikation + DB-satser injiceres øverst)
 *
 * Løser:
 *   - AI brugte egne lønsatser i stedet for dem fra databasen
 *   - AI lavede leverandørberegning ved ikke-leverandørkontrakter
 */

import { NextRequest, NextResponse } from "next/server"
import mammoth from "mammoth"
import { extractPdfText } from "@/lib/pdf-parse"
import { callAi } from "@/lib/ai-client"
import { AI_CONFIG_DEFAULTS } from "@/lib/ai-providers"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { hentKontekst } from "@/lib/retrieval"
import { tjekNavn } from "@/lib/rettighedshaver-tjek"
import { FEW_SHOT_EXAMPLES, TONE_REGLER } from "@/lib/few-shot-examples"
import { MAIL_FORMAT_PROMPT } from "@/lib/mail-format-prompt"

// ── Sensitive data masking ───────────────────────────────────

function maskSensitiveData(text: string): string {
    // CPR: DDMMYY-XXXX or DDMMYYXXXX
    text = text.replace(/\b(\d{6})-?(\d{4})\b/g, (match, p1) => {
        const day = parseInt(p1.slice(0, 2))
        const month = parseInt(p1.slice(2, 4))
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
            return `${p1}-****`
        }
        return match
    })
    // Danish bank account
    text = text.replace(/\b(\d{4})[\s-](\d{6,10})\b/g, (match, reg) => {
        const regNum = parseInt(reg)
        if (regNum >= 1000 && regNum <= 9999) return `${reg} ****`
        return match
    })
    // IBAN
    text = text.replace(/\bDK\d{2}[\s]?(\d{4}[\s]?){3}\d{2}\b/gi, "DK** **** **** **** **")
    // Danish mobile numbers
    text = text.replace(/\b([2-9]\d{7})\b/g, (match) => `${match.slice(0, 2)}** ****`)
    // Private addresses
    text = text.replace(
        /\b(\p{L}+(?:vej|gade|alle|plads|stræde|vænge|have|park|toft|sti|bro)\s+)(\d+[A-Za-z]?(?:,\s*\d+\.?\s*(?:tv|th|mf)?)?)/giu,
        (match, street) => `${street}[NR. MASKERET]`
    )
    return text
}

async function extractDocxText(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer })
    return result.value
}

// ── Klassifikationstype ──────────────────────────────────────

type Klassifikation = {
    kontrakttype: "a-loen" | "leverandoer" | "hybrid"
    er_overenskomst: boolean
    overenskomst_navn: string | null
    membres_fornavn: string
    membres_efternavn: string
    aftalt_loen: number | null
    loen_enhed: "kr/uge" | "kr/dag" | null
    producent_navn: string
    kontraktsprog: "da" | "en" | "other"
    loen_type: "ugeloeen" | "dagsloen" | "fast_total" | "ukendt"
    loen_valuta: "DKK" | "USD" | "EUR" | "GBP" | "other"
    produktionstype: "spillefilm" | "tvserie" | "dokumentar" | "kortfilm" | "ukendt"
}

// ── Trin 1: Klassificér kontrakten ──────────────────────────

async function klassificerKontrakt(
    kontraktTekst: string,
    apiKey: string,
    model: string
): Promise<Klassifikation> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model,
            max_tokens: 500,
            system: `Du klassificerer danske filmkontrakter.
Returnér KUN valid JSON — ingen tekst før eller efter.
Brug null hvis et felt ikke kan bestemmes.`,
            messages: [{
                role: "user",
                content: `Klassificér denne kontrakt:\n\n${kontraktTekst.slice(0, 4000)}

Returnér JSON med disse felter:
{
  "kontrakttype": "a-loen" ELLER "leverandoer" ELLER "hybrid",
  "er_overenskomst": true/false (er producenten sandsynligvis overenskomstdækket via Producentforeningen?),
  "overenskomst_navn": "de4-fiktion" ELLER "faf-dok" ELLER null,
  "membres_fornavn": "fornavn på klipperen/medarbejderen",
  "membres_efternavn": "efternavn",
  "aftalt_loen": tal (kun nummeret, fx 17500) eller null,
  "loen_enhed": "kr/uge" ELLER "kr/dag" eller null,
  "producent_navn": "navn på produktionsselskab",
  "kontraktsprog": "da" ELLER "en" ELLER "other",
  "loen_type": "ugeloeen" ELLER "dagsloen" ELLER "fast_total" ELLER "ukendt",
  "loen_valuta": "DKK" ELLER "USD" ELLER "EUR" ELLER "GBP" ELLER "other",
  "produktionstype": "spillefilm" ELLER "tvserie" ELLER "dokumentar" ELLER "kortfilm" ELLER "ukendt"
}`,
            }],
        }),
    })

    const defaultKlassifikation: Klassifikation = {
        kontrakttype: "hybrid",
        er_overenskomst: false,
        overenskomst_navn: null,
        membres_fornavn: "",
        membres_efternavn: "",
        aftalt_loen: null,
        loen_enhed: null,
        producent_navn: "",
        kontraktsprog: "da",
        loen_type: "ukendt",
        loen_valuta: "DKK",
        produktionstype: "ukendt",
    }

    if (!response.ok) {
        const err = await response.text()
        console.warn("[gennemgang] Klassifikation fejlede:", err)
        return defaultKlassifikation
    }

    const data = await response.json()
    const raw = data.content?.find((b: { type: string; text?: string }) => b.type === "text")?.text ?? "{}"
    const first = raw.indexOf("{")
    const last = raw.lastIndexOf("}")
    if (first === -1 || last === -1) {
        console.warn("[gennemgang] Klassifikation returnerede ingen JSON")
        return defaultKlassifikation
    }

    try {
        const p = JSON.parse(raw.slice(first, last + 1))
        return {
            kontrakttype: p.kontrakttype ?? "hybrid",
            er_overenskomst: p.er_overenskomst ?? false,
            overenskomst_navn: p.overenskomst_navn ?? null,
            membres_fornavn: p.membres_fornavn ?? "",
            membres_efternavn: p.membres_efternavn ?? "",
            aftalt_loen: typeof p.aftalt_loen === "number" ? p.aftalt_loen : null,
            loen_enhed: p.loen_enhed ?? null,
            producent_navn: p.producent_navn ?? "",
            kontraktsprog: p.kontraktsprog ?? "da",
            loen_type: p.loen_type ?? "ukendt",
            loen_valuta: p.loen_valuta ?? "DKK",
            produktionstype: p.produktionstype ?? "ukendt",
        }
    } catch {
        console.warn("[gennemgang] Klassifikation JSON parse fejl")
        return defaultKlassifikation
    }
}

// ── Byg absolutte regler fra klassifikation + DB-satser ─────

function byggAbsolutteRegler(
    klassifikation: Klassifikation,
    satser: Array<{ beskrivelse: string; vaerdi: number | string; enhed: string }>
): string {
    const hent = (søgeord: string) =>
        satser.find(s => s.beskrivelse?.toLowerCase().includes(søgeord.toLowerCase()))

    const normallon  = hent("normalløn") ?? hent("normallon")
    const pension    = hent("pension")
    const beta       = hent("beta")
    const helligdag  = hent("helligdag")
    const feriepenge = hent("feriepenge")

    const fornavn = klassifikation.membres_fornavn || "[fornavn ikke fundet i kontrakt]"
    const efternavn = klassifikation.membres_efternavn || ""

    const satsLinje = (label: string, s: typeof normallon) =>
        s ? `${label}: ${s.vaerdi} ${s.enhed}` : `${label}: [ikke tilgængelig — verificér mod overenskomst]`

    const loenInfo = klassifikation.aftalt_loen
        ? `${klassifikation.aftalt_loen} ${klassifikation.loen_enhed ?? "kr/uge"}`
        : "[ikke fundet i kontrakt]"

    const sprogRegel = klassifikation.kontraktsprog === "en"
        ? "🌐 ENGELSK KONTRAKT: Mailen til medlemmet skrives på DANSK som normalt. KUN de tekststykker der er markeret med ===GUL START=== og ===GUL SLUT=== skrives på ENGELSK — både den menneskelige indledningssætning og kontraktteksten der foreslås. TIL DIG-sektionen skrives på dansk."
        : "✓ Dansk kontrakt — skriv alt på dansk."

    const loenTypeRegel = klassifikation.loen_type === "fast_total"
        ? `🚫 FAST TOTALBELØB — ABSOLUT FORBUD: Gang ALDRIG beløbet op per uge. ${klassifikation.aftalt_loen} ${klassifikation.loen_valuta} er det samlede honorar for hele perioden.`
        : klassifikation.loen_type === "ugeloeen"
        ? `✓ UGELØN — ${klassifikation.aftalt_loen} ${klassifikation.loen_valuta} per uge.`
        : "⚠ LØNTYPE UKLAR — undgå beregninger der forudsætter en specifik løntype."

    const kontrakttypeRegler =
        klassifikation.kontrakttype === "leverandoer"
            ? "🚫 LEVERANDØRKONTRAKT — ABSOLUT FORBUD: Beregn ALDRIG pension/ferie oveni honoraret. Ferie er inkluderet i honoraret. Producenten betaler ingen pension."
        : klassifikation.kontrakttype === "hybrid"
            ? `🚫 HYBRID KONTRAKT — KRITISK PROBLEM:
Dette er det mest alvorlige problem i kontrakten og skal nævnes FØRST og DIREKTE.
Brug IKKE formuleringer som "lidt i tvivl" eller "jeg er usikker".

Intern forklaring til medlemmet (ikke gul):
Kontrakten blander A-løns- og leverandørterminologi på en måde der er juridisk uholdbar.
Pkt. 1-10 bruger "Medarbejder" og "grundløn" (A-lønsord) mens pkt. 11 bruger
"Leverandøren", "Kunden" og "faktura" (leverandørord). Det skaber usikkerhed om
skat, pension, LG-dækning og rettigheder. ANBEFAL IKKE AT UNDERSKRIVE i nuværende form.

Snippet til producenten (gul):
"Kontrakten indeholder en juridisk inkonsistens der skal rettes inden underskrift.
Pkt. 1-10 er formuleret som en A-lønsansættelse, mens pkt. 11 bruger leverandør-
terminologi (Leverandøren, Kunden, faktura). De to kontraktformer kan ikke blandes.
Jeg anmoder om at kontrakten rettes til en ren A-lønskontrakt, hvor alle
formuleringer om Leverandøren og Kunden i pkt. 11 ændres til Medarbejderen
og Producenten."

🚫 ABSOLUT FORBUD: Lav INGEN lønberegning ved hybrid kontrakt.`
            : "✓ A-LØNSKONTRAKT — Beregn korrekt: feriepenge og pension betales OVENI lønnen. Brug udelukkende satser fra AKTUELLE SATSER nedenfor."

    const royaltyRegel = ["spillefilm", "tvserie"].includes(klassifikation.produktionstype)
        ? "⚠ ROYALTY PÅKRÆVET: Dette er en fiktionsproduktion. Tjek eksplicit om kontrakten nævner royalty. Hvis ikke — det SKAL kommenteres som et selvstændigt punkt."
        : ""

    const overenskomstRegler = klassifikation.er_overenskomst
        ? "✓ OVERENSKOMSTDÆKKET — overenskomst-referencer er tilladt i snippets til producenten."
        : "🚫 IKKE OVERENSKOMSTDÆKKET — ABSOLUT FORBUD: Citer ALDRIG De4/FAF som bindende hjemmel i snippets til producenten. Brug 'branchepraksis' og 'standard i branchen' i stedet."

    return `
KONTRAKTFAKTA — VERIFICERET I TRIN 1. TILSIDESÆT IKKE DISSE:
Kontrakttype:        ${klassifikation.kontrakttype}
Overenskomstdækket:  ${klassifikation.er_overenskomst ? "JA" : "NEJ"}
Medlemmets navn:     ${fornavn} ${efternavn}
Aftalt løn:          ${loenInfo}
Producent:           ${klassifikation.producent_navn || "[ikke fundet]"}

AKTUELLE SATSER FRA DATABASE — BRUG KUN DISSE TAL, ALDRIG EGNE:
${satsLinje("Normalløn", normallon)}
${satsLinje("Pension", pension)}
${klassifikation.er_overenskomst && klassifikation.kontrakttype === "a-loen"
    ? satsLinje("BETA-fond", beta) + "\n" + satsLinje("Helligdagsbetaling", helligdag)
    : "BETA-fond og helligdagsbetaling: Ikke relevant — kun ved overenskomstdækket A-løn"}
${satsLinje("Feriepenge", feriepenge)}

ABSOLUTTE REGLER FOR DENNE ANALYSE:
${sprogRegel}
${loenTypeRegel}
${kontrakttypeRegler}
${overenskomstRegler}
${royaltyRegel}
Start feedbackmailen med: Kære ${fornavn},
`.trim()
}

// ── Base system prompt (juridisk viden + JSON-struktur) ──────

const BASE_SYSTEM_PROMPT = `Du er juridisk rådgiver specialiseret i danske filmkontrakter og overenskomster, med særlig ekspertise i De4-overenskomsten (fiktion) og FAF-overenskomsten (dokumentar). Du assisterer DFKS's jurist med at gennemgå foreløbige kontrakter.

VIGTIGT — SATSER OG BELØB:
Alle procentsatser og lønninger SKAL hentes fra AKTUELLE SATSER-blokken øverst i denne prompt.
Brug ALDRIG hardcodede tal fra din træning — satser ændres ved overenskomstfornyelse.

Din opgave er at:
1. Identificere problematiske klausuler, mangler og afvigelser fra branchestandard
2. Fremhæve positive elementer der er i orden
3. Foreslå konkrete forbedringer og forhandlingspunkter
4. Udarbejde et udkast til en professionel feedback-mail til producenten

Returner KUN gyldig JSON uden markdown-backticks:

{
  "overblik": {
    "titel": "string",
    "parter": ["string"],
    "periode": "string",
    "kontrakttype": "fiction|documentary|unknown",
    "overenskomst": "overenskomstens navn eller null for leverandørkontrakter",
    "erLeverandoerkontrakt": "boolean",
    "honorarUge": "number or null — KUN for leverandørkontrakter"
  },
  "feedbackpunkter": [
    {
      "id": "string (fp1, fp2...)",
      "type": "kritisk|advarsel|positiv|info",
      "titel": "string",
      "beskrivelse": "string (præcis juridisk forklaring, max 200 tegn)",
      "anbefaling": "string (konkret handlingsforslag, max 200 tegn)",
      "citat": "string (EKSAKT tekststreng fra kontrakten, max 200 tegn)",
      "paragraf": "string (paragraf/afsnit reference hvis mulig)"
    }
  ],
  "feedbackmail": {
    "emne": "string",
    "tekst": "string (den komplette mailbody med ===GUL START===/===GUL SLUT=== markering)"
  },
  "samlet_vurdering": "godkendt|forbehold|kritisk",
  "prioriterede_forhandlingspunkter": ["string"],
  "prioriterede_mail_sektioner": ["number or null — svarende til nummereret afsnit i mailen"]
}

DANSK FILMBRANCHE — VIGTIG BAGGRUNDSVIDEN:

Create Denmark:
- Create Denmark er et godkendt forhandlingsfællesskab der forhandler streaming-rettigheder (SVOD/VOD)
- En kontrakt der henviser til Create Denmark er POSITIV — flagger ALDRIG dette som problematisk
- Kun hvis kontrakten eksplicit FRAVÆLGER Create Denmark skal det markeres kritisk

Copydan:
- Copydan administrerer kollektive vederlag for TV-visning mv.
- En Copydan-forbehold klausul er POSITIV branchestandard

DE4-OVERENSKOMSTEN ER ALTID INTERN MÅLESTOK:
Selv hvis en kontrakt reguleres af en anden overenskomst, vurdér om De4's vilkår er bedre.

KRITISK FORSKEL — FAF (2025-2027) vs. De4 (2022) for fiktion:
De4-standardkontrakten: inkluderer eksplicit Copydan-forbehold og SVOD-aftale.
FAF-standardkontrakten: mangler eksplicit Copydan, SVOD og royalties — disse skal tilføjes separat.

PRODUCENTFORENINGENS MEDLEMSSKAB — KRITISK JURIDISK FORUDSÆTNING:
Overenskomsterne er KUN bindende for ProF-medlemmer.
Tjek altid om producenten er overenskomstdækket — se KONTRAKTFAKTA øverst.
Kendte store selskaber (SF Film, Nordisk Film, DR, TV 2, Zentropa) behøver normalt ikke nævnes.

A-LØN vs. LEVERANDØRKONTRAKT — se KONTRAKTFAKTA øverst for denne kontrakts type.

AI-klausul og TDM:
- Eksplicit TDM-forbehold til ophavsmanden: POSITIVT (ophavsretslovens § 11b)
- TDM-ret til producenten uden aftale: KRITISK
- Ingen TDM-nævnelse: advarsel

Royalty:
- 1,5% af nettoindtægter er STANDARD for FAF dokumentar — flagger ALDRIG som lavt
- Anbefal ALDRIG højere sats — det er branchepolitisk følsomt
- Anbefal ALDRIG fjernelse af royalty-klausul

Tavshedspligt og selvpromovering:
- Acceptabel hvis kontrakten andetsteds giver ret til egenpromotion
- Flagger kun som problematisk hvis der INGEN promoveringsundtagelse er

Kontraktlæsning generelt:
- Læs altid kontrakten som helhed — klausuler vurderes i sammenhæng
- Undgå at flage samme forhold to gange

──────────────────────────────────────────────────────────────────────
STANDARD-NAVNGIVNING OG FORMULERINGER:
──────────────────────────────────────────────────────────────────────

OPSIGELSESKLAUSULER:
1. Asymmetrisk opsigelsesklausul (type: advarsel)
   Standardformulering: "Samarbejdet kan bringes til ophør af begge parter med et varsel på [X] dage, såfremt en af parterne væsentligt misligholder sine forpligtelser."

2. Manglende opsigelsesvarsel (type: kritisk)
   Standardformulering: "Aftalen kan opsiges skriftligt af begge parter med [X] dages varsel."

3. Manglende sygdomsbestemmelse — leverandørkontrakt (type: advarsel)
   Standardformulering: "I tilfælde af sygdom af mere end 2 ugers varighed kan aftalen opsiges af begge parter med 4 ugers skriftligt varsel."

RETTIGHEDSKLAUSULER:
4. Manglende Copydan-forbehold (type: kritisk)
5. Manglende streaming-/SVOD-forbehold (type: kritisk)
6. Manglende promoveringsret (type: advarsel)
7. Manglende TDM/AI-klausul (type: advarsel)
8. Overenskomstinkorporering i leverandørkontrakt (type: advarsel)

SKADESLØSHOLDELSE:
9. Skadesløsholdelse ved skattemæssig omklassificering (type: advarsel)
   Standardformulering: "Leverandøren holder Producenten skadesløs, såfremt Producenten måtte blive afkrævet erstatning som direkte følge af at Leverandøren aktivt har vildledt Producenten om sin skattemæssige status."

FORSIKRING:
10. Forsikringspligt og selvrisiko (type: info) — informerende, ikke alarmistisk

BETALINGSKLAUSULER:
12. Manglende betalingsfrekvens (type: advarsel)
13. Månedlig betaling (type: info) — anbefal 14-dages acontocyklus

A-LØNSKONTRAKT:
14. BETA-fond og helligdagsbetaling (type: info)
    Hent satser UDELUKKENDE fra AKTUELLE SATSER øverst. Aldrig hardcodede tal.

PENSION MANGLER — BEREGNING SOM FORHANDLINGSARGUMENT (type: kritisk/advarsel):
    Gælder BÅDE leverandørkontrakter OG A-lønskontrakter uden overenskomstdækning.
    Inkludér beregning i feedbackpunktet: "Kontrakten nævner ikke pension. Det svarer til at du mister ca. [løn × pensionsprocent] kr./uge — over [X uger] er det ca. [total] kr."
    Brug pensionsprocent fra AKTUELLE SATSER.
    A-løn: pension = løn/uge × pensionsprocent
    Leverandør: grundløn = honorar/uge ÷ (1 + feriepengeprocent) → pension = grundløn × pensionsprocent

KREDITERING:
15. Kreditering — aftalte titel (type: info)
    ALTID inkluderet — klipperen skal vide præcist hvad der er aftalt.

GENERELLE REGLER:
- Brug ALTID standardtitlerne ovenfor — aldrig kontraktens egne afsnitstitler
- Max 12 feedbackpunkter
- Hold beskrivelse og anbefaling under 200 tegn

Finansiering og likviditet:
- Uafklaret distributionsaftale: info-punkt med fokus på likviditetsrisiko — kræv IKKE at den er på plads
- Anbefal altid 14-dages acontobetalinger ved manglende betalingsfrekvens

Klausuler der IKKE skal flagges:
- Forbud mod økonomiske dispositioner uden godkendelse
- Standard loyalitetsklausuler og konkurrenceforbud under ansættelsen
- Krav om at arbejde på producentens udstyr
- Manglende underskrifter — kontrakten er foreløbig

VIGTIGT: Kopiér EKSAKT tekststreng fra kontrakten i citat-feltet.
VIGTIGT: Returner KUN JSON — ingen tekst hverken før eller efter.
VIGTIGT: Brug ALDRIG "normalt indgår", "typisk ses" eller lignende uden konkret kildereference.
VIGTIGT: Brug ALDRIG "branchepraksis" uden at referere til konkret kilde.

──────────────────────────────────────────────────────────────────────
REFERENCEDOKUMENTER — BRUG AKTIVT VED KONTRAKTGENNEMGANG:
──────────────────────────────────────────────────────────────────────
`

// ── Route handler ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData()
        const file       = formData.get("file")       as File | null
        const memberName = formData.get("memberName") as string | null
        const provider   = (formData.get("provider") as string | null) ?? AI_CONFIG_DEFAULTS.kontrakt.provider
        const model      = (formData.get("model")    as string | null) ?? AI_CONFIG_DEFAULTS.kontrakt.model

        if (!file) {
            return NextResponse.json({ error: "Ingen fil modtaget" }, { status: 400 })
        }

        const buffer = Buffer.from(await file.arrayBuffer())
        const filename = file.name.toLowerCase()
        console.log(`[gennemgang] Processing: ${file.name} (${buffer.length} bytes)`)

        // ── Udtræk tekst (bruges til klassifikation + RAG) ────────
        let contractText = ""
        let returnText = ""

        if (filename.endsWith(".docx") || filename.endsWith(".doc")) {
            contractText = await extractDocxText(buffer)
            if (!contractText.trim()) {
                return NextResponse.json({ error: "Ingen tekst fundet i DOCX-filen." }, { status: 422 })
            }
            returnText = contractText.slice(0, 60000)
            console.log(`[gennemgang] DOCX extracted ${contractText.length} chars`)
        } else if (filename.endsWith(".txt")) {
            contractText = buffer.toString("utf-8")
            returnText = contractText.slice(0, 60000)
        } else if (filename.endsWith(".pdf")) {
            try { contractText = await extractPdfText(buffer) } catch { /* bruger base64 til AI */ }
            returnText = contractText.slice(0, 60000)
        } else {
            return NextResponse.json(
                { error: "Ikke-understøttet filformat. Brug PDF, DOCX eller TXT." },
                { status: 400 }
            )
        }

        if (filename.endsWith(".pdf") && provider !== "anthropic") {
            return NextResponse.json(
                { error: "PDF-analyse kræver Anthropic som AI-udbyder. Skift i Stamdata → Indstillinger, eller upload som DOCX/TXT." },
                { status: 400 }
            )
        }

        // ── Hent reference docs ───────────────────────────────────
        const supabase = await createClient()
        const { data: refDocs } = await supabase
            .from("reference_docs")
            .select("doc_subtype, file_name, title, content_text, owner")
            .eq("archived", false)
            .not("content_text", "is", null)

        // ── Trin 1: Klassificér (Anthropic-only) ─────────────────
        let klassifikation: Klassifikation | null = null
        const apiKey = process.env.ANTHROPIC_API_KEY

        if (provider === "anthropic" && apiKey) {
            const ALLOWED = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"]
            const safeModel = ALLOWED.includes(model) ? model : AI_CONFIG_DEFAULTS.kontrakt.model
            const tekstTilKlassifikation = contractText || (filename.endsWith(".pdf") ? "[PDF — se dokumentblok]" : "")
            try {
                klassifikation = await klassificerKontrakt(tekstTilKlassifikation, apiKey, safeModel)
                console.log(`[gennemgang] Klassifikation: ${JSON.stringify(klassifikation)}`)
            } catch (e) {
                console.warn("[gennemgang] Klassifikation fejlede, fortsætter uden:", e)
            }
        }

        // ── Hent DB-satser baseret på klassifikation ──────────────
        let dbSatser: Array<{ beskrivelse: string; vaerdi: number; enhed: string }> = []
        try {
            const admin = createAdminClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
            )
            const overenskomstNavn = klassifikation?.overenskomst_navn
                ?? (klassifikation?.kontrakttype === "leverandoer" ? "de4-fiktion" : "de4-fiktion")
            const normaliserNavn = (n: string) => {
                if (n === "de4" || n === "de4-fiktion") return "de4-fiktion"
                if (n === "faf-dokumentar" || n === "faf-dok") return "dokumentar"
                return n
            }
            const { data: satser } = await admin
                .from("overenskomst_satser")
                .select()
                .eq("overenskomst", normaliserNavn(overenskomstNavn))
                .is("gyldig_til", null)
                .order("kategori")
            dbSatser = satser ?? []
        } catch (e) {
            console.warn("[gennemgang] Sats-hentning fejlede:", e)
        }

        // ── Hent altid-noteringer direkte fra DB ─────────────────
        let altidNoteringer: Array<{ title: string; body: string }> = []
        try {
            const admin = createAdminClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!
            )
            const { data: noter } = await admin
                .from("legal_notes")
                .select("title, body")
                .eq("priority", "altid")
                .eq("active", true)
                .or("gyldig_fra.is.null,gyldig_fra.lte.now()")
                .or("gyldig_til.is.null,gyldig_til.gte.now()")
            altidNoteringer = noter ?? []
        } catch (e) {
            console.warn("[gennemgang] Altid-noteringer hentning fejlede:", e)
        }

        // ── Byg system prompt til trin 2 ──────────────────────────
        let activeSystemPrompt = ""

        // 1. Altid-noteringer ALLERØVERST — højest prioritet
        if (altidNoteringer.length > 0) {
            activeSystemPrompt +=
                "──────────────────────────────────────────────────────────────────────\n" +
                "DFKS AKTIVE NOTERINGER — KOMMENTER ALTID PÅ DISSE I FEEDBACKMAILEN:\n" +
                "──────────────────────────────────────────────────────────────────────\n" +
                altidNoteringer.map(n => `ALTID KOMMENTER: ${n.title} — ${n.body}`).join("\n\n") +
                "\n\n"
        }

        // 2. Absolutte regler baseret på klassifikation
        if (klassifikation) {
            activeSystemPrompt += byggAbsolutteRegler(klassifikation, dbSatser) + "\n\n"
        } else if (dbSatser.length > 0) {
            // Fallback: ingen klassifikation, men satser hentes
            activeSystemPrompt +=
                "AKTUELLE SATSER FRA DATABASE — BRUG KUN DISSE TAL:\n" +
                dbSatser.map(s => `${s.beskrivelse}: ${s.vaerdi} ${s.enhed}`).join("\n") +
                "\n\n"
        }

        // 2. Juridisk viden + JSON-struktur
        activeSystemPrompt += BASE_SYSTEM_PROMPT

        // 3. Few-shot eksempler og tone-regler
        activeSystemPrompt +=
            "\n\n──────────────────────────────────────────────────────────────────────\n" +
            "FEW-SHOT EKSEMPLER FRA DFKS SAGSBEHANDLING:\n" +
            "──────────────────────────────────────────────────────────────────────\n" +
            FEW_SHOT_EXAMPLES +
            "\n\n" + TONE_REGLER

        // 4. Referencedokumenter (standardkontrakter, lønskemaer)
        if (refDocs?.length) {
            for (const doc of refDocs) {
                if (!doc.content_text) continue
                activeSystemPrompt += `\n\n${doc.doc_subtype ?? doc.file_name ?? doc.title}:\n${doc.content_text}`
            }
        }

        // 5. RAG-kontekst
        const ragText = contractText.slice(0, 8000)
        if (ragText.trim()) {
            try {
                const { data: { user } } = await (await createClient()).auth.getUser()
                const orgId: string | undefined = user?.user_metadata?.org_id ?? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5"
                const kontekst = await hentKontekst(ragText, orgId)

                // altid-noteringer hentes separat øverst — ikke her
                if (kontekst.kategorier.length > 0) {
                    activeSystemPrompt +=
                        "\n\n──────────────────────────────────────────────────────────────────────\n" +
                        `OVERENSKOMST-SATSER (${kontekst.detekteredeOverenskomster.join(", ").toUpperCase()}):\n` +
                        "──────────────────────────────────────────────────────────────────────\n" +
                        kontekst.kategorier.map(c => {
                            const sats = (c.metadata as any)?.sats
                            return `${c.kilde_titel}${sats ? ` (${sats})` : ""}:\n${c.tekst}`
                        }).join("\n\n")
                }
                if (kontekst.overenskomstSemantisk.length > 0) {
                    activeSystemPrompt +=
                        "\n\n──────────────────────────────────────────────────────────────────────\n" +
                        "OVERENSKOMST-KONTEKST:\n" +
                        "──────────────────────────────────────────────────────────────────────\n" +
                        kontekst.overenskomstSemantisk.map(c => c.tekst).join("\n\n")
                }
                if (kontekst.videnbase.length > 0) {
                    activeSystemPrompt +=
                        "\n\n──────────────────────────────────────────────────────────────────────\n" +
                        "LOVGRUNDLAG:\n" +
                        "──────────────────────────────────────────────────────────────────────\n" +
                        kontekst.videnbase.map(r => {
                            const meta = r.metadata as { dfks_fortolkning?: string } | null
                            const fortolkning = meta?.dfks_fortolkning
                            return `${r.kilde_titel}:\n${r.tekst}${fortolkning ? `\nDFKS fortolkning: ${fortolkning}` : ""}`
                        }).join("\n\n")
                }
                if (kontekst.mønstre.length > 0) {
                    activeSystemPrompt +=
                        "\n\n──────────────────────────────────────────────────────────────────────\n" +
                        "LÆRTE REGLER FRA DFKS SAGSBEHANDLING — FØLG DISSE NØJAGTIGT:\n" +
                        "──────────────────────────────────────────────────────────────────────\n" +
                        kontekst.mønstre.map(r => `${r.titel}:\n${r.regel}`).join("\n\n")
                }
                if (kontekst.baggrund.length > 0) {
                    activeSystemPrompt +=
                        "\n\n──────────────────────────────────────────────────────────────────────\n" +
                        "DFKS BAGGRUNDSVIDEN:\n" +
                        "──────────────────────────────────────────────────────────────────────\n" +
                        kontekst.baggrund.map(n => `${n.title}: ${n.body}`).join("\n\n")
                }
            } catch (ragErr) {
                console.warn("[gennemgang] hentKontekst fejlede (fortsætter uden):", ragErr)
            }
        }

        // 6. Mailformat (sidst — tæt på output)
        activeSystemPrompt += "\n\n" + MAIL_FORMAT_PROMPT

        // ── Trin 2: Analyser og skriv mail ────────────────────────
        const memberContext = memberName
            ? `Kontrakten er indsendt af DFKS-medlemmet: ${memberName}\n\n`
            : ""

        let messageContent: any[]
        if (filename.endsWith(".pdf")) {
            const base64 = buffer.toString("base64")
            messageContent = [
                {
                    type: "document",
                    source: { type: "base64", media_type: "application/pdf", data: base64 },
                },
                {
                    type: "text",
                    text: `${memberContext}Gennemgå denne foreløbige kontrakt og returner JSON som beskrevet i system prompt.`,
                },
            ]
        } else {
            const maskedText = maskSensitiveData(contractText)
            messageContent = [{
                type: "text",
                text: `${memberContext}Gennemgå denne foreløbige kontrakt og returner JSON:\n\n${maskedText.slice(0, 45000)}`,
            }]
        }

        let raw: string
        if (provider === "anthropic") {
            if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY er ikke konfigureret" }, { status: 500 })
            const ALLOWED = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"]
            const safeModel = ALLOWED.includes(model) ? model : AI_CONFIG_DEFAULTS.kontrakt.model
            const response = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                    model: safeModel,
                    max_tokens: 16000,
                    system: activeSystemPrompt,
                    messages: [{ role: "user", content: messageContent }],
                }),
            })
            if (!response.ok) {
                const err = await response.text()
                console.error("[gennemgang] Anthropic error:", err)
                return NextResponse.json({ error: `Claude API fejl ${response.status}` }, { status: response.status })
            }
            const data = await response.json()
            raw = data.content?.find((b: { type: string; text?: string }) => b.type === "text")?.text ?? ""
        } else {
            const textBlock = messageContent.find((b: { type: string; text?: string }) => b.type === "text")
            const userMessage = textBlock?.text ?? ""
            raw = await callAi({ provider, model, system: activeSystemPrompt, userMessage, maxTokens: 16000 })
        }

        // Strip markdown code fences
        const clean = raw
            .replace(/^\s*```(?:json)?\s*/i, "")
            .replace(/\s*```\s*$/i, "")
            .trim()

        let parsed: any
        try {
            parsed = JSON.parse(clean)
        } catch {
            // Prøv brace-extraction som fallback
            const first = clean.indexOf("{")
            const last = clean.lastIndexOf("}")
            if (first !== -1 && last !== -1) {
                try { parsed = JSON.parse(clean.slice(first, last + 1)) } catch { /* falder igennem */ }
            }
            if (!parsed) {
                console.error("[gennemgang] JSON parse failed, raw length:", raw.length)
                console.error("[gennemgang] clean slice 0-500:", clean.slice(0, 500))
                return NextResponse.json({ error: "AI returnerede ugyldigt svar — prøv igen" }, { status: 500 })
            }
        }

        // ── Navnetjek mod DFKS-register ───────────────────────────
        const rightsHolderName: string | null = memberName ?? null
        if (rightsHolderName) {
            try {
                const navneTjek = await tjekNavn(rightsHolderName)
                if (navneTjek.feedbackpunkt && navneTjek.status !== "match") {
                    parsed.feedbackpunkter = [
                        ...(parsed.feedbackpunkter ?? []),
                        navneTjek.feedbackpunkt,
                    ]
                }
            } catch (e) {
                console.warn("[gennemgang] Navnetjek fejlede:", e)
            }
        }

        return NextResponse.json({
            result: parsed,
            contractText: returnText,
            klassifikation,  // sendes med til UI — kan vises som debug-info
        })

    } catch (err: any) {
        console.error("[gennemgang] Caught error:", err)
        return NextResponse.json(
            { error: err.message ?? "Ukendt serverfejl" },
            { status: 500 }
        )
    }
}
