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

RELEVANT: spillefilm, tv-drama, dokumentarfilm, kortfilm, animationsfilm, dokumentarserie, doku-drama — uanset kanal.
IKKE relevant: nyheder, sport, vejrudsigt, talkshows, quiz, reality, go' morgen-shows, debatprogrammer, underholdning uden filmisk klipning, JOURNALISTISKE PROGRAMMER (nyhedsmagasiner, forbrugerjournalistik som Kontant, faktachek som Detektor, investigativ journalistik).

VIGTIGT: Kanal alene er IKKE nok til at afvise. En dokumentarfilm på DR2 er stadig relevant. Skelnet er: fortæller programmet en kreativ/kunstnerisk historie (relevant) eller undersøger/rapporterer det en sag journalistisk (ikke relevant)?

Varighed: 50-90 min = sandsynlig spillefilm. Over 90 min = næsten altid spillefilm. Under 20 min = kortfilm/kort dokumentar.

MEGET STÆRKE indikatorer for relevans (godkend med høj sikkerhed):
- Filmen har haft premiere på en filmfestival: CPH:DOX, IDFA, Sundance, Tribeca, Hot Docs, Cannes, Berlin, Venice, Tribeca, BIFF, Nordisk Panorama, Odense Film Festival m.fl.
- Filmen er nomineret til eller har vundet en filmpris (Robert, Bodil, Oscar, BAFTA, Palme d'Or m.fl.)
- Filmen er produceret af et kendt produktionsselskab (Zentropa, Nimbus, SF Studios, DR Fiktion m.fl.)

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
    // Kun korrektioner — tilfælde hvor AI tog fejl. Undgå over-generalisering fra enige eksempler.
    const corrections = examples.filter(e =>
        (e.aiRelevant === "ja" && e.userDecision === "rejected") ||
        (e.aiRelevant === "nej" && e.userDecision === "approved")
    )
    if (!corrections.length) return ""
    const lines = corrections.map(e => {
        const ctx = [e.rawTitle, e.channel ? `(${e.channel})` : ""].filter(Boolean).join(" ")
        const userSaid = e.userDecision === "approved" ? "relevant" : "ikke relevant"
        return `- "${ctx}" → ${userSaid}${e.aiVaerkType ? ` (${e.aiVaerkType})` : ""}`
    })
    return `\nKorrektioner for DISSE SPECIFIKKE titler (VIGTIGT: brug dem KUN til eksakt match på titelnavn — træk ALDRIG generelle konklusioner om kanaler, genrer eller kategorier fra dem):\n${lines.join("\n")}\n`
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
Slå denne titel op i din viden om dansk TV og film. Kender du dette specifikke program, så brug den viden. Kender du det ikke, vurder ud fra titel, kanal, varighed og år.

Korrektionerne ovenfor gælder KUN de nævnte specifikke titler. Lad dem ALDRIG påvirke vurderingen af andre titler eller sænke din confidence for en ny titel. En 50+ min dansk dokumentarfilm på DR2 er relevant med høj sikkerhed, medmindre du konkret ved den er journalistisk.

Returner et JSON-objekt:
{
  "kenderProgrammet": true | false,  // true KUN hvis du med sikkerhed kan identificere dette specifikke program fra din viden — ikke hvis du gætter ud fra metadata
  "hvadErDette": "<Hvis kenderProgrammet=true: angiv hvad du ved med sikkerhed — instruktør, handling/tema, programtype, festivalpremiere (CPH:DOX, IDFA, Cannes m.fl.), priser (Robert, Bodil, Oscar m.fl.). Skriv kun det du er sikker på. Hvis kenderProgrammet=false: beskriv hvad det sandsynligvis er ud fra titel, kanal, varighed og år. Max 3 sætninger.>",
  "relevant": "ja" | "nej" | "usikker",
  "vaerkType": "<spillefilm | tv_serie_lang | tv_serie_kort | kortfilm | dokumentarfilm | dokumentarserie | dokuDrama | kort_dokumentar | ikke_relevant | null>",
  "begrundelse": "<Max 1 sætning om programmets TYPE — aldrig om korrektionsmønstre>",
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
