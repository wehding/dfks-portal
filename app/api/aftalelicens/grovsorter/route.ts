/**
 * app/api/aftalelicens/grovsorter/route.ts
 *
 * Bruger Claude til at grovsortera TV-titler fra Copydan-data.
 * Modtager en batch af titler og returnerer forslag: afvis / godkend / usikker + værktype.
 */

import { NextRequest, NextResponse } from "next/server"

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

export async function POST(req: NextRequest) {
    try {
        const { items } = await req.json()

        if (!Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: "Ingen titler modtaget" }, { status: 400 })
        }

        const apiKey = process.env.ANTHROPIC_API_KEY
        if (!apiKey) {
            return NextResponse.json(
                { error: "ANTHROPIC_API_KEY er ikke konfigureret på serveren" },
                { status: 500 }
            )
        }

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

        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 8192,
                system: SYSTEM,
                messages: [{ role: "user", content: userMessage }],
            }),
        })

        if (!response.ok) {
            const err = await response.text()
            console.error("[grovsorter] Anthropic error:", err)
            return NextResponse.json(
                { error: `Claude API fejl: ${response.status}` },
                { status: response.status }
            )
        }

        const data = await response.json()
        const text = data.content?.find((b: { type: string; text?: string }) => b.type === "text")?.text ?? ""

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
