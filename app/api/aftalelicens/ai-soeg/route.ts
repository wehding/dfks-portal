/**
 * app/api/aftalelicens/ai-soeg/route.ts
 *
 * Slår en enkelt titel op med Claude og returnerer:
 * - Hvad er dette program?
 * - Er det relevant for DFKS (klipperrettigheder)?
 * - Foreslået værktype
 * - Begrundelse
 */

import { NextRequest, NextResponse } from "next/server"
import { callAi } from "@/lib/ai-client"
import { AI_CONFIG_DEFAULTS } from "@/lib/ai-providers"

const SYSTEM = `Du er ekspert i dansk TV-produktion og aftalelicens. Du hjælper Dansk Filmklipperselskab (DFKS) med at vurdere om TV-titler fra Copydan-data er relevante.

DFKS administrerer klipperrettigheder for FILMVÆRKER: spillefilm, tv-drama-serier, dokumentarfilm, kortfilm, dokumentarserier og lignende kreative filmproduktioner med professionel klipning.

IKKE relevant: nyheder, sport, vejrudsigt, talkshows, quiz, reality, go' morgen-shows, debatprogrammer, underholdning uden filmisk klipning.

Returner KUN et JSON-objekt — ingen tekst udenfor JSON.`

interface FeedbackExample {
    rawTitle: string
    channel?: string
    aiRelevant: "ja" | "nej" | "usikker"
    aiVaerkType: string | null
    userDecision: "approved" | "rejected"
}

function buildExamplesBlock(examples: FeedbackExample[]): string {
    if (!examples.length) return ""
    const lines = examples.map(e => {
        const ctx = [e.rawTitle, e.channel ? `(${e.channel})` : ""].filter(Boolean).join(" ")
        const aiSaid = e.aiRelevant === "ja" ? "relevant" : e.aiRelevant === "nej" ? "ikke relevant" : "usikker"
        const userSaid = e.userDecision === "approved" ? "godkendt" : "afvist"
        const match = (e.aiRelevant === "ja") === (e.userDecision === "approved")
        return `- "${ctx}" → AI: ${aiSaid}${e.aiVaerkType ? ` (${e.aiVaerkType})` : ""}, bruger: ${userSaid}${match ? "" : " ← KORREKTION"}`
    })
    return `\nTidligere sorteringer (lær af disse):\n${lines.join("\n")}\n`
}

export async function POST(req: NextRequest) {
    try {
        const { rawTitle, channel, productionYear, broadcastDate, duration, examples = [], provider, model } = await req.json()

        const aiProvider = provider ?? AI_CONFIG_DEFAULTS.soeg.provider
        const aiModel    = model    ?? AI_CONFIG_DEFAULTS.soeg.model

        if (!rawTitle) {
            return NextResponse.json({ error: "Titel mangler" }, { status: 400 })
        }

        const kontekst = [
            `Titel: "${rawTitle}"`,
            channel ? `Kanal: ${channel}` : null,
            productionYear ? `Produktionsår: ${productionYear}` : null,
            broadcastDate ? `Sendt: ${broadcastDate}` : null,
            duration ? `Varighed: ${duration} min` : null,
        ].filter(Boolean).join("\n")

        const userMessage = `${kontekst}
${buildExamplesBlock(examples)}
Vurder denne TV-titel og returner et JSON-objekt:
{
  "hvadErDette": "<Kort beskrivelse af programmet på dansk, 1-2 sætninger>",
  "relevant": "ja" | "nej" | "usikker",
  "vaerkType": "<spillefilm | tv_serie_lang | tv_serie_kort | kortfilm | dokumentarfilm | dokumentarserie | dokuDrama | kort_dokumentar | ikke_relevant | null>",
  "begrundelse": "<Begrundelse for vurdering, max 2 sætninger på dansk>",
  "confidence": "høj" | "mellem" | "lav"
}`

        const text = await callAi({ provider: aiProvider, model: aiModel, system: SYSTEM, userMessage, maxTokens: 512 })

        const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
        const result = JSON.parse(clean)

        return NextResponse.json(result)
    } catch (err) {
        console.error("[ai-soeg] Fejl:", err)
        return NextResponse.json({ error: "Intern fejl" }, { status: 500 })
    }
}
