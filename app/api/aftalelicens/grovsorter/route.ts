/**
 * app/api/aftalelicens/grovsorter/route.ts
 *
 * Bruger Claude til at grovsortera TV-titler fra Copydan-data.
 * Modtager en batch af titler og returnerer forslag: afvis / godkend / usikker + værktype.
 */

import { NextRequest, NextResponse } from "next/server"
import { callAi } from "@/lib/ai-client"
import { AI_CONFIG_DEFAULTS } from "@/lib/ai-providers"

const SYSTEM = `Du er ekspert i dansk TV-produktion og aftalelicens. Du hjælper Dansk Filmklipperselskab (DFKS) med at grovsortera TV-titler fra Copydan-data.

DFKS administrerer klipperrettigheder for FILMVÆRKER: spillefilm, tv-drama-serier, dokumentarfilm, kortfilm, dokumentarserier og lignende kreative filmproduktioner med professionel klipning.

Klassificer hver titel som én af:
- "afvis": Indhold der IKKE har klipperrettigheder. Typisk: nyheder (TV Avisen, Nyhederne, Lorry Nyheder), sport (Sportsnyt, Sporten, fodbold, håndbold), vejrudsigt, talkshows, quizprogrammer (Jeopardy, Hvem vil være millionær), reality (Big Brother, Paradise Hotel), debatprogrammer (Deadline, Debatten), underholdningsprogrammer uden filmisk klipning, Go' morgen-shows, reklamespots, børne-legeplatforme.
- "godkend": Filmværker med klipperrettigheder — spillefilm, tv-drama, dokumentarfilm, kortfilm, animationsfilm, dokumentarserie, doku-drama.
- "usikker": Titler der ikke kan klassificeres præcist ud fra titlen alene (f.eks. tvetydige titler).

For "godkend": angiv den mest sandsynlige værktype:
  spillefilm | tv_serie_lang | tv_serie_kort | kortfilm | dokumentarfilm | dokumentarserie | dokuDrama | kort_dokumentar

Vigtige regler:
- Genudsendelser af nyheder/sport = "afvis"
- Serier som Borgen, Broen, Matador, Klovn = "godkend" (tv_serie_lang)
- Korte dokumentarer under 20 min = "godkend" (kort_dokumentar)
- Debatmagasiner og talkshows = "afvis" selvom de har klipning
- Returnér KUN et JSON-array — ingen tekst udenfor JSON`

interface FeedbackExample {
    rawTitle: string
    channel?: string
    aiRelevant: "ja" | "nej" | "usikker"
    aiVaerkType: string | null
    userDecision: "approved" | "rejected"
}

function buildExamplesBlock(examples: FeedbackExample[]): string {
    if (!examples.length) return ""
    const corrections = examples.filter(e =>
        (e.aiRelevant === "ja" && e.userDecision === "rejected") ||
        (e.aiRelevant === "nej" && e.userDecision === "approved")
    )
    if (!corrections.length) return ""
    const lines = corrections.map(e => {
        const ctx = [e.rawTitle, e.channel ? `(${e.channel})` : ""].filter(Boolean).join(" ")
        const userSaid = e.userDecision === "approved" ? "godkend" : "afvis"
        return `- "${ctx}" → skal klassificeres som: ${userSaid}${e.aiVaerkType ? ` (${e.aiVaerkType})` : ""}`
    })
    return `\nBruger-korrektioner fra tidligere sorteringer (højeste prioritet):\n${lines.join("\n")}\n`
}

export async function POST(req: NextRequest) {
    try {
        const { items, examples = [], provider, model } = await req.json()

        if (!Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: "Ingen titler modtaget" }, { status: 400 })
        }

        const aiProvider = provider ?? AI_CONFIG_DEFAULTS.grovsorter.provider
        const aiModel    = model    ?? AI_CONFIG_DEFAULTS.grovsorter.model

        // Byg titelliste — ét element per linje med al tilgængelig kontekst
        const list = items.map((item: { id: string; rawTitle: string; channel?: string; duration?: number; vaerkType?: string | null }) =>
            [
                item.id,
                item.rawTitle,
                item.channel ? `(${item.channel})` : "",
                item.duration ? `[${item.duration} min]` : "",
                item.vaerkType ? `[allerede klassificeret: ${item.vaerkType}]` : "",
            ].filter(Boolean).join(" ")
        ).join("\n")

        const userMessage = `Klassificer følgende ${items.length} TV-titler fra Copydan Verdens TV.

Bemærk: Titler markeret med [allerede klassificeret: X] har en brugervalgt værktype — anvend dette som stærk kontekst. En dokumentarserie er f.eks. altid et filmværk der skal godkendes, uanset om titlen lyder som en debat.
${buildExamplesBlock(examples)}
${list}

Returner et JSON-array med ét objekt per titel:
[
  {
    "id": "<id fra listen>",
    "status": "afvis" | "godkend" | "usikker",
    "type": "<værktype eller null>",
    "reason": "<begrundelse på dansk, max 8 ord>"
  }
]`

        const text = await callAi({ provider: aiProvider, model: aiModel, system: SYSTEM, userMessage, maxTokens: 8192 })

        const clean = text
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim()

        let results: unknown[]
        try {
            results = JSON.parse(clean)
        } catch {
            console.error("[grovsorter] JSON parse error. Raw:", text.slice(0, 500))
            return NextResponse.json(
                { error: "AI returnerede ugyldigt JSON — prøv igen" },
                { status: 500 }
            )
        }

        return NextResponse.json({ results })
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Ukendt serverfejl"
        console.error("[grovsorter] Caught error:", message)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
