/**
 * app/api/aftalelicens/grovsorter/route.ts
 *
 * Grovsortering af TV-titler fra Copydan-data.
 * Trin 1: regelbaseret præ-filter (hurtig, høj præcision)
 * Trin 2: AI-klassifikation af de resterende tvetydige titler
 */

import { NextRequest, NextResponse } from "next/server"
import { callAi } from "@/lib/ai-client"
import { AI_CONFIG_DEFAULTS } from "@/lib/ai-providers"

const SYSTEM = `Du er ekspert i dansk TV-produktion og aftalelicens. Du hjælper Dansk Filmklipperselskab (DFKS) med at grovsortera TV-titler fra Copydan-data.

DFKS administrerer klipperrettigheder for FILMVÆRKER: spillefilm, tv-drama-serier, dokumentarfilm, kortfilm, dokumentarserier og lignende kreative filmproduktioner med professionel klipning.

Klassificer hver titel som én af:
- "afvis": Indhold uden klipperrettigheder: nyheder, sport, vejrudsigt, talkshows, quizshows, reality, debatprogrammer, morgenmagasiner, reklamespots, børne-legeplatforme, underholdning uden filmisk klipning — og JOURNALISTISKE PROGRAMMER (se nedenfor).
- "godkend": Filmværker med klipperrettigheder — spillefilm, tv-drama, dokumentarfilm, kortfilm, animationsfilm, dokumentarserie, doku-drama.
- "usikker": Kan ikke klassificeres sikkert ud fra de tilgængelige oplysninger.

For "godkend": angiv mest sandsynlige værktype:
  spillefilm | tv_serie_lang | tv_serie_kort | kortfilm | dokumentarfilm | dokumentarserie | dokuDrama | kort_dokumentar

Varighed som stærk indikator:
- Under 3 min → "afvis" (promo/spot/trailer)
- 3–20 min → sandsynlig kortfilm eller kort_dokumentar
- 20–50 min → sandsynlig tv_serie_kort eller dokumentarfilm
- 50–90 min → sandsynlig spillefilm eller tv_serie_lang
- Over 90 min → næsten altid spillefilm

Produktionsår som indikator:
- År 1900–1989 → næsten aldrig nyheder/debat → sandsynlig spillefilm eller dokumentar
- År 1990–2000 → vurder på titel og kanal

Episodemønstre (titel indeholder " - 1", "afsnit", "episode", "s0", "(1:", "(2:") → serie → tv_serie_lang eller tv_serie_kort

JOURNALISTISKE PROGRAMMER = altid "afvis" hos DFKS:
Journalistiske programmer har IKKE klipperrettigheder, selvom de ligner dokumentar eller har professionel klipning.
Dette gælder: nyhedsmagasiner (f.eks. 21 Søndag, Magasinet, Indblik), forbrugerjournalistik (Kontant, Luksusfælden), faktachek-programmer (Detektor), reportageserier, investigativ journalistik, pressekonferencer, politiske magasiner, interview-programmer med journalistisk vinkel.
SKELNE: En dokumentarfilm fortæller en kreativ/kunstnerisk historie = "godkend". Et journalistisk program undersøger/rapporterer en sag = "afvis".
Tvivl om journalistisk vs. dokumentar → "usikker".

Vigtige regler:
- Borgen, Broen, Matador, Klovn og lignende kendte serier = "godkend" (tv_serie_lang)
- Debatmagasiner og talkshows = "afvis" selvom de har klipning
- Film med festivalhistorik (CPH:DOX, IDFA, Cannes, Berlin, Sundance m.fl.) = altid "godkend" med høj sikkerhed
- Film nomineret til eller vinder af filmpris (Robert, Bodil, Oscar m.fl.) = altid "godkend"
- Returnér KUN et JSON-array — ingen tekst udenfor JSON`

// Regelbaseret præ-filter — titelbaserede afvisningsmønstre
const REJECT_TITLE_RE = [
    /\btv\s*avisen\b/i,
    /\bnyhederne\b/i,
    /\blorry\s*nyheder\b/i,
    /\bdr\s*nyheder\b/i,
    /\bvejret\b/i,
    /\bvejrudsigt\b/i,
    /\bsporten\b/i,
    /\bsportsnyt\b/i,
    /\bgo'?\s*morgen\b/i,
    /\bgod\s*morgen\b/i,
    /\bdeadline\b/i,
    /\bdebatten\b/i,
    /\bpresselogen\b/i,
    /\bjeopardy\b/i,
    /\bhvem\s+vil\s+v[æe]re\s+million[æe]r\b/i,
    /\bparadise\s*hotel\b/i,
    /\bbig\s*brother\b/i,
    /\breklame(blok)?\b/i,
    /\bdirekte\s+fra\b/i,
    /\bvm\s+i\b/i,
    /\bem\s+i\b/i,
    // Journalistiske programmer
    /\bkontant\b/i,
    /\bdetektor\b/i,
    /\bluksusfaelden\b/i,
    /\bluksusf[æe]lden\b/i,
    /\b21\s+s[øo]ndag\b/i,
    /\bpressekonference\b/i,
    /\bpolitiken\s+tv\b/i,
    /\baftenshowet\b/i,
]

// Kanalbaserede afvisningsmønstre
const REJECT_CHANNEL_RE = [
    /^tv\s*2?\s*news$/i,
    /^dr\s*nyheder$/i,
    /^eurosport/i,
]

// Kanalbaserede godkendelsesmønstre
const APPROVE_CHANNEL_RE = [
    /^tv\s*2?\s*film$/i,
    /^film\s*4$/i,
    /^canal\s*\+?\s*film/i,
    /^filmstriben$/i,
    /^dr\s*ramasjang$/i,
]

interface Item {
    id: string
    rawTitle: string
    channel?: string
    duration?: number
    productionYear?: number
}

type PreResult = { status: "afvis" | "godkend"; type?: string; reason: string }

function preFilter(item: Item): PreResult | null {
    // Varighed under 3 min → promo/spot
    if (item.duration !== undefined && item.duration > 0 && item.duration < 3) {
        return { status: "afvis", reason: "Varighed under 3 min" }
    }

    // Kanalbaseret godkendelse
    if (item.channel) {
        for (const re of APPROVE_CHANNEL_RE) {
            if (re.test(item.channel)) {
                return { status: "godkend", reason: `Filmkanal: ${item.channel}` }
            }
        }
        // Kanalbaseret afvisning
        for (const re of REJECT_CHANNEL_RE) {
            if (re.test(item.channel)) {
                return { status: "afvis", reason: `Nyhedskanal: ${item.channel}` }
            }
        }
    }

    // Titelbaseret afvisning
    for (const re of REJECT_TITLE_RE) {
        if (re.test(item.rawTitle)) {
            return { status: "afvis", reason: "Titelgenkendelse" }
        }
    }

    return null
}

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
        return `- "${ctx}" → ${userSaid}${e.aiVaerkType ? ` (${e.aiVaerkType})` : ""}`
    })
    return `\nBruger-korrektioner (højeste prioritet — følg disse altid):\n${lines.join("\n")}\n`
}

export async function POST(req: NextRequest) {
    try {
        const { items, examples = [], provider, model } = await req.json()

        if (!Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: "Ingen titler modtaget" }, { status: 400 })
        }

        const aiProvider = provider ?? AI_CONFIG_DEFAULTS.grovsorter.provider
        const aiModel    = model    ?? AI_CONFIG_DEFAULTS.grovsorter.model

        // Trin 1: Præ-filter — sortér åbenlyse tilfælde fra uden AI
        const preResults = new Map<string, { status: string; type?: string; reason: string }>()
        const aiItems: Item[] = []

        for (const item of items as Item[]) {
            const pre = preFilter(item)
            if (pre) {
                preResults.set(item.id, pre)
            } else {
                aiItems.push(item)
            }
        }

        // Trin 2: AI kun for tvetydige titler
        let aiResults: { id: string; status: string; type?: string; reason: string }[] = []

        if (aiItems.length > 0) {
            const list = aiItems.map(item =>
                [
                    item.id,
                    item.rawTitle,
                    item.channel ? `(${item.channel})` : "",
                    item.duration ? `[${item.duration} min]` : "",
                    item.productionYear ? `[${item.productionYear}]` : "",
                ].filter(Boolean).join(" ")
            ).join("\n")

            const userMessage = `Klassificer følgende ${aiItems.length} TV-titler fra Copydan Verdens TV.
Format per linje: <id> <titel> (<kanal>) [varighed min] [produktionsår]
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

            try {
                aiResults = JSON.parse(clean)
            } catch {
                console.error("[grovsorter] JSON parse error. Raw:", text.slice(0, 500))
                return NextResponse.json(
                    { error: "AI returnerede ugyldigt JSON — prøv igen" },
                    { status: 500 }
                )
            }
        }

        // Sammensæt resultater: præ-filter + AI
        const results = [
            ...Array.from(preResults.entries()).map(([id, r]) => ({ id, ...r })),
            ...aiResults,
        ]

        console.log(`[grovsorter] ${items.length} titler → ${preResults.size} præ-filter, ${aiItems.length} AI`)

        return NextResponse.json({ results })
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Ukendt serverfejl"
        console.error("[grovsorter] Caught error:", message)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
