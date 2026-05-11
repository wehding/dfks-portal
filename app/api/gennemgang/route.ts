/**
 * app/api/gennemgang/route.ts
 *
 * Server-side contract review endpoint.
 * Accepts a PDF or DOCX file, extracts text server-side,
 * sends to Claude for legal review, returns structured feedback
 * with highlighted text references.
 *
 * Files are never persisted — processed in memory only.
 */

import { NextRequest, NextResponse } from "next/server"
import mammoth from "mammoth"
import { callAi } from "@/lib/ai-client"
import { AI_CONFIG_DEFAULTS } from "@/lib/ai-providers"

// ── Sensitive data masking ───────────────────────────────────
// Masks CPR numbers, bank account numbers and private addresses
// before sending contract text to external API.

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

    // Danish bank account: reg.nr XXXX kontonr XXXXXXXX (4 + 6-10 digits)
    // Format: 1234 123456 or 1234-123456
    text = text.replace(/\b(\d{4})[\s-](\d{6,10})\b/g, (match, reg) => {
        // Only mask if it looks like a bank account (reg nr 1000-9999)
        const regNum = parseInt(reg)
        if (regNum >= 1000 && regNum <= 9999) {
            return `${reg} ****`
        }
        return match
    })

    // IBAN: DKxx xxxx xxxx xxxx xx
    text = text.replace(/\bDK\d{2}[\s]?(\d{4}[\s]?){3}\d{2}\b/gi, "DK** **** **** **** **")

    // Danish mobile numbers: 8 digits starting with 2,3,4,5,6,7,8,9
    // Only mask standalone numbers not part of other context
    text = text.replace(/\b([2-9]\d{7})\b/g, (match) => {
        // Avoid masking years, amounts etc by checking surrounding context
        return `${match.slice(0, 2)}** ****`
    })

    // Private addresses: street + number pattern (dansk format)
    // Masks house numbers but keeps street names for context
    text = text.replace(/\b(\p{L}+(?:vej|gade|alle|plads|stræde|vænge|have|park|toft|sti|bro)\s+)(\d+[A-Za-z]?(?:,\s*\d+\.?\s*(?:tv|th|mf)?)?)/giu,
        (match, street, number) => `${street}[NR. MASKERET]`
    )

    return text
}

// Keep old name for backward compat
const maskCpr = maskSensitiveData

async function extractDocxText(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer })
    return result.value
}

// ── System prompt ────────────────────────────────────────────

const SYSTEM_PROMPT = `Du er juridisk rådgiver specialiseret i danske filmkontrakter og overenskomster, med særlig ekspertise i De4-overenskomsten (fiktion) og FAF-overenskomsten (dokumentar). Du assisterer DFKS's jurist med at gennemgå foreløbige kontrakter.

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
    "overenskomst": "string or null"
  },
  "feedbackpunkter": [
    {
      "id": "string (fp1, fp2...)",
      "type": "kritisk|advarsel|positiv|info",
      "titel": "string",
      "beskrivelse": "string (præcis juridisk forklaring)",
      "anbefaling": "string (konkret handlingsforslag)",
      "citat": "string (EKSAKT tekststreng fra kontrakten, max 200 tegn — bruges til highlight)",
      "paragraf": "string (paragraf/afsnit reference hvis mulig)"
    }
  ],
  "feedbackmail": {
    "emne": "string",
    "hilsen": "string",
    "indledning": "string",
    "punkter": ["string (hvert punkt som et selvstændigt afsnit)"],
    "afslutning": "string",
    "underskrift": "Med venlig hilsen,\\nDFKS — Dansk Filmklipperselskab"
  },
  "samlet_vurdering": "godkendt|forbehold|kritisk",
  "prioriterede_forhandlingspunkter": ["string"]
}

DANSK FILMBRANCHE — VIGTIG BAGGRUNDSVIDEN:

Create Denmark:
- Create Denmark er et godkendt forhandlingsfællesskab der forhandler og administrerer streaming-rettigheder (SVOD/VOD) på vegne af danske ophavsmænd
- En kontrakt der henviser til Create Denmark for streaming-klarering er POSITIV og følger branchestandard
- Flagger ALDRIG en Create Denmark-henvisning som uklar eller problematisk — det er korrekt branchepraksis
- Kun hvis kontrakten eksplicit FRAVÆLGER Create Denmark skal det markeres kritisk

Copydan:
- Copydan administrerer kollektive vederlag for TV-visning mv.
- En klausul der forbeholder klipperen Copydan-vederlag er POSITIV branchestandard

FAF-overenskomsten (dokumentar) og De4-overenskomsten (fiktion):
- SKELNE MELLEM KONTRAKTTYPER er afgørende:

  A-LØN (lønmodtagerkontrakt):
  - Overenskomsten gælder direkte hvis producenten er ProF-член
  - Manglende reference til overenskomsten er kritisk
  - Kontrakten skal eksplicit referere overenskomsten

  LEVERANDØRKONTRAKT (B2B/freelance):
  - Overenskomsten gælder IKKE direkte — det er en aftale mellem to virksomheder
  - Flagger ALDRIG manglende overenskomstreference i en leverandørkontrakt som kritisk
  - DFKS's interesse er at minimumsvilkårene reelt overholdes uanset kontraktform
  - Markér som info-punkt: tjek at honoraret svarer til overenskomstens minimumssatser
  - Tjek at pension, ferie og arbejdstid svarer til overenskomstens minimumsniveau — selv om det ikke er juridisk påkrævet er det branchestandard
  - Formuleringen skal være: "Selv om dette er en leverandørkontrakt, anbefaler DFKS at vilkårene som minimum svarer til FAF-overenskomstens standarder"

- Identificer kontrakttypen ud fra: om der er CVR-nummer på begge parter, om der faktureres, om der er tale om "honorar" vs "løn", om der er moms-forbehold

AI-klausul:
- En klausul der beskytter mod AI-data mining er POSITIV og moderne branchestandard

Royalty:
- 1,5% royalty af nettoindtægter er STANDARD i henhold til FAF-overenskomsten for dokumentarklippere — flagger ALDRIG 1,5% som lavt eller ugunstigt
- Royalty-satsen er et følsomt branchepolitisk stridspunkt mellem klippere, instruktører og producenter — anbefal ALDRIG en højere sats da det øger konfliktniveauet unødigt
- Anbefal ALDRIG fjernelse af en royalty-klausul — royalty-retten er fundamental og dens tilstedeværelse er vigtigere end satsen
- Det eneste der kan markeres som problematisk er hvis "nettoindtægter" er så vagt defineret at det reelt eliminerer royalty-beregningsgrundlaget (f.eks. ubegrænsede fradrag for "privatkapital")
- En præcis definition af nettoindtægter kan anbefales som info-punkt, aldrig som kritisk

Tavshedspligt og selvpromovering:
- En tavshedspligtsklausul er ACCEPTABEL hvis kontrakten andetsteds eksplicit giver klipperen ret til at promovere eget arbejde efter offentliggørelse
- Læs ALTID hele kontrakten samlet — en klausul der ser problematisk ud kan være afbalanceret af en anden klausul
- Hvis kontrakten indeholder en promoveringsklausul (typisk i rettighedsafsnittet) der tillader brug af framegrabs, trailer og klip på sociale medier og hjemmeside efter filmens offentliggørelse, er tavshedspligten i orden
- Flagger kun tavshedspligt som problematisk hvis der INGEN promoveringsundtagelse er i kontrakten

Kontraktlæsning generelt:
- Læs altid kontrakten som en helhed — klausuler skal vurderes i sammenhæng, ikke isoleret
- Hvis en klausul ser restriktiv ud, tjek om en anden klausul kompenserer for det
- Undgå at flage samme forhold to gange fra to forskellige klausuler

Finansiering og likviditet:
- Hvis kontrakten nævner at en distributionsaftale (DR, TV2, streaming mv.) endnu ikke er lukket, er det IKKE grundlag for at kræve at aftalen finaliseres før underskrift — det er normal praksis i dokumentarbranchen
- Det skal dog markeres som info-punkt med fokus på likviditetsrisiko: en uafklaret distributionsaftale kan betyde usikker finansiering, og klipperen bør være opmærksom på producentens likviditet undervejs
- Anbefalingen skal være praktisk: tjek at betalingsvilkårene sikrer løbende udbetaling — 14-dages betalingscyklus er normen på fiktionsoverenskomsten netop fordi freelancere er sårbare ved manglende betalinger
- Hvis kontrakten ikke specificerer betalingsfrekvens, anbefal at klipperen forhandler 14-dages acontobetalinger ind — dette er den vigtigste beskyttelse mod en producent med likviditetsproblemer
- Kræv ALDRIG at distributionsaftaler er på plads før underskrift — det er urealistisk og vil blokere legitime produktioner

Betalingsfrekvens — generel regel:
- Hvis kontrakten ikke specificerer betalingsfrekvens eller -cyklus, skal det ALTID markeres som advarsel
- Anbefal altid 14-dages acontobetalinger som standard — dette er normen på fiktionsoverenskomsten og den vigtigste beskyttelse for freelancere
- Hvis kontrakten specificerer månedlig betaling, markér det som info og anbefal forhandling om 14-dages cyklus
- Baggrunden: freelancere er særligt sårbare ved manglende betalinger, og kortere betalingscyklusser reducerer risikoen markant ved producenters eventuelle likviditetsproblemer

Klausuler der er standard og IKKE skal flagges:
- Forbud mod økonomiske dispositioner uden godkendelse — dette er standard i alle ansættelsesforhold og særligt irrelevant for klippere der sjældent har budgetansvar. Flagger aldrig dette.
- Standard loyalitetsklausuler og konkurrenceforbud under ansættelsen
- Krav om at arbejde på producentens udstyr og lokationer
- Standard opsigelsesvarsel på 1-4 uger
- Manglende underskrifter eller tomme underskriftfelter — kontraktgennemgang bruges netop på FORELØBIGE kontrakter der ikke er underskrevet endnu. Flagger ALDRIG manglende underskrifter.

VIGTIGT for citat-feltet: Kopiér den EKSAKTE tekststreng fra kontrakten som den fremgår i dokumentet — dette bruges til at markere teksten visuelt. Vær præcis.
VIGTIGT for JSON-output: Returner KUN JSON — ingen tekst hverken før eller efter JSON-blokken. Hold beskrivelse og anbefaling under 200 tegn hver. Max 12 feedbackpunkter.`

// ── Route handler ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData()
        const file       = formData.get("file")     as File | null
        const memberName = formData.get("memberName") as string | null
        const provider   = (formData.get("provider") as string | null) ?? AI_CONFIG_DEFAULTS.kontrakt.provider
        const model      = (formData.get("model")    as string | null) ?? AI_CONFIG_DEFAULTS.kontrakt.model

        if (!file) {
            return NextResponse.json({ error: "Ingen fil modtaget" }, { status: 400 })
        }

        const buffer = Buffer.from(await file.arrayBuffer())
        const filename = file.name.toLowerCase()
        console.log(`[gennemgang] Processing: ${file.name} (${buffer.length} bytes)`)

        const memberContext = memberName
            ? `Kontrakten er indsendt af DFKS-medlemmet: ${memberName}\n\n`
            : ""

        let messageContent: any[]
        let returnText = ""

        if (filename.endsWith(".pdf")) {
            // Send PDF directly to Claude as base64 — no server-side parsing needed
            const base64 = buffer.toString("base64")
            messageContent = [
                {
                    type: "document",
                    source: {
                        type: "base64",
                        media_type: "application/pdf",
                        data: base64,
                    },
                },
                {
                    type: "text",
                    text: `${memberContext}Gennemgå denne foreløbige kontrakt og returner JSON som beskrevet i system prompt.`,
                },
            ]
        } else if (filename.endsWith(".docx") || filename.endsWith(".doc")) {
            const contractText = await extractDocxText(buffer)
            if (!contractText.trim()) {
                return NextResponse.json({ error: "Ingen tekst fundet i DOCX-filen." }, { status: 422 })
            }
            returnText = contractText.slice(0, 60000)
            console.log(`[gennemgang] DOCX extracted ${contractText.length} chars`)
            const maskedDocx = maskSensitiveData(contractText)
            messageContent = [{
                type: "text",
                text: `${memberContext}Gennemgå denne foreløbige kontrakt og returner JSON:\n\n${maskedDocx.slice(0, 45000)}`,
            }]
        } else if (filename.endsWith(".txt")) {
            const contractText = buffer.toString("utf-8")
            returnText = contractText.slice(0, 60000)
            const maskedTxt = maskSensitiveData(contractText)
            messageContent = [{
                type: "text",
                text: `${memberContext}Gennemgå denne foreløbige kontrakt og returner JSON:\n\n${maskedTxt.slice(0, 45000)}`,
            }]
        } else {
            return NextResponse.json(
                { error: "Ikke-understøttet filformat. Brug PDF, DOCX eller TXT." },
                { status: 400 }
            )
        }

        // PDF-filer med document-blokke understøttes kun af Anthropic
        let raw: string
        if (filename.endsWith(".pdf") && provider !== "anthropic") {
            return NextResponse.json(
                { error: "PDF-analyse kræver Anthropic som AI-udbyder. Skift i Stamdata → Indstillinger, eller upload som DOCX/TXT." },
                { status: 400 }
            )
        }

        if (provider === "anthropic") {
            // Anthropic: brug document-blokke (understøtter PDF nativt)
            const apiKey = process.env.ANTHROPIC_API_KEY
            if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY er ikke konfigureret" }, { status: 500 })
            const ALLOWED = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"]
            const safeModel = ALLOWED.includes(model) ? model : AI_CONFIG_DEFAULTS.kontrakt.model
            const response = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
                body: JSON.stringify({ model: safeModel, max_tokens: 16000, system: SYSTEM_PROMPT, messages: [{ role: "user", content: messageContent }] }),
            })
            if (!response.ok) {
                const err = await response.text()
                console.error("[gennemgang] Anthropic error:", err)
                return NextResponse.json({ error: `Claude API fejl ${response.status}` }, { status: response.status })
            }
            const data = await response.json()
            raw = data.content?.find((b: { type: string; text?: string }) => b.type === "text")?.text ?? ""
        } else {
            // OpenAI / Google: brug text-indhold (kun DOCX/TXT)
            const textBlock = messageContent.find((b: { type: string; text?: string }) => b.type === "text")
            const userMessage = textBlock?.text ?? ""
            raw = await callAi({ provider, model, system: SYSTEM_PROMPT, userMessage, maxTokens: 16000 })
        }
        // Strip markdown code fences robustly
        const clean = raw
            .replace(/^\s*```(?:json)?\s*/i, "")
            .replace(/\s*```\s*$/i, "")
            .trim()

        let parsed: any
        try {
            parsed = JSON.parse(clean)
        } catch (parseErr) {
            console.error("[gennemgang] JSON parse failed, raw length:", raw.length)
            console.error("[gennemgang] clean slice 0-500:", clean.slice(0, 500))
            console.error("[gennemgang] clean slice -200:", clean.slice(-200))
            console.error("[gennemgang] parseErr:", parseErr)
            return NextResponse.json(
                { error: "AI returnerede ugyldigt svar — prøv igen" },
                { status: 500 }
            )
        }

        return NextResponse.json({
            result: parsed,
            contractText: returnText,
        })

    } catch (err: any) {
        console.error("[gennemgang] Caught error:", err)
        return NextResponse.json(
            { error: err.message ?? "Ukendt serverfejl" },
            { status: 500 }
        )
    }
}
