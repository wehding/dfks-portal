/**
 * app/api/aftalelicens/grovsorter/route.ts
 *
 * Grovsortering af TV-titler fra Copydan-data.
 * Trin 0: match mod egen, validerede værksdatabase (ingen hardkodede titler —
 *         kendte, registrerede værker godkendes automatisk, medmindre admin
 *         har flaget dem som ikke rettighedsberettiget)
 * Trin 1: regelbaseret præ-filter (hurtig, høj præcision)
 * Trin 2: AI-klassifikation af de resterende tvetydige titler
 */

import { NextRequest, NextResponse } from "next/server"
import { callAi } from "@/lib/ai-client"
import { AI_CONFIG_DEFAULTS } from "@/lib/ai-providers"
import { requireAdminApi } from "@/lib/api-auth"
import { consumeRateLimit } from "@/lib/server/rate-limit"
import { createServiceClient } from "@/lib/supabase/service"
import { normalizeScreeningTitle } from "@/lib/screening-utils"
import { resolveOrgId } from "@/lib/org"

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

Yderligere kontekst, når den er tilgængelig (kategori, genre, medvirkende, beskrivelse) — brug den AKTIVT, især for titler der ikke er umiddelbart genkendelige alene ud fra titlen:
- kategori "Series"/"Movies" er en stærk indikator for "godkend", uafhængigt af om titlen selv er kendt
- En beskrivelse der tydeligt fortæller en fiktiv/dramatisk historie (karakterer, plot) = "godkend"; en beskrivelse der beskriver en undersøgelse/sag/reportage = sandsynligvis journalistik = "afvis"
- Kendte skuespillernavne i "medvirkende" understøtter "godkend", men er ikke i sig selv afgørende alene

Vigtige regler:
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
    category?: string
    genre?: string
    description?: string
    actors?: string
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
    const auth = await requireAdminApi()
    if (!auth.ok) return auth.response
    try {
        const contentLength = Number(req.headers.get("content-length") ?? 0)
        if (contentLength > 1_000_000) return NextResponse.json({ error: "Forespørgslen er for stor." }, { status: 413 })
        const rateLimit = await consumeRateLimit({
            bucket: "aftalelicens-grovsorter",
            identifier: auth.userId,
            limit: 20,
            windowMs: 60 * 60 * 1000,
        })
        if (!rateLimit.allowed) {
            return NextResponse.json({ error: "For mange AI-kørsler. Prøv igen senere." }, {
                status: 429,
                headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
            })
        }
        const { items, examples = [] } = await req.json()

        if (!Array.isArray(items) || items.length === 0 || items.length > 500) {
            if (Array.isArray(items) && items.length > 500) return NextResponse.json({ error: "Vælg højst 500 titler ad gangen." }, { status: 400 })
            return NextResponse.json({ error: "Ingen titler modtaget" }, { status: 400 })
        }
        if (!items.every(item => item && typeof item.id === "string" && item.id.length <= 100 && typeof item.rawTitle === "string" && item.rawTitle.length <= 300)) {
            return NextResponse.json({ error: "Titellisten indeholder ugyldige data." }, { status: 400 })
        }
        if (!Array.isArray(examples) || examples.length > 100) {
            return NextResponse.json({ error: "Der kan højst medsendes 100 eksempler." }, { status: 400 })
        }

        // Modellen vælges server-side. Klienter må ikke kunne sende vilkårlige
        // modelnavne eller skifte til en dyrere udbyder.
        const aiProvider = AI_CONFIG_DEFAULTS.grovsorter.provider
        const aiModel = AI_CONFIG_DEFAULTS.grovsorter.model

        // Trin 0: Match mod egen, validerede værksdatabase — INGEN hardkodede
        // titler. Et kendt, allerede registreret værk godkendes automatisk
        // (medmindre eksplicit flaget ikke rettighedsberettiget), uafhængigt
        // af om AI'en selv ville genkende titlen. Skalerer til enhver ny
        // produktion, DFKS allerede har registreret, uden kodeændringer.
        const worksDb = createServiceClient()
        const orgId = await resolveOrgId(worksDb, auth.userId)
        const { data: worksRows } = orgId ? await worksDb
            .from("works")
            .select("title, aftalelicens_rights_eligible")
            .eq("org_id", orgId) : { data: [] }

        const worksByNormalizedTitle = new Map<string, boolean>()
        for (const w of worksRows ?? []) {
            if (!w.title) continue
            worksByNormalizedTitle.set(normalizeScreeningTitle(w.title), w.aftalelicens_rights_eligible !== false)
        }

        const worksMatchResults = new Map<string, { status: string; reason: string }>()
        const remainingAfterWorksMatch: Item[] = []

        for (const item of items as Item[]) {
            const eligible = worksByNormalizedTitle.get(normalizeScreeningTitle(item.rawTitle))
            if (eligible === undefined) {
                remainingAfterWorksMatch.push(item)
            } else if (eligible) {
                worksMatchResults.set(item.id, { status: "godkend", reason: "Kendt, registreret værk" })
            } else {
                worksMatchResults.set(item.id, { status: "afvis", reason: "Værk flaget ikke rettighedsberettiget" })
            }
        }

        // Trin 1: Præ-filter — sortér åbenlyse tilfælde fra uden AI
        const preResults = new Map<string, { status: string; type?: string; reason: string }>()
        const aiItems: Item[] = []

        for (const item of remainingAfterWorksMatch) {
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
                    item.category ? `kategori:${item.category}` : "",
                    item.genre ? `genre:${item.genre}` : "",
                    item.actors ? `medvirkende:${item.actors}` : "",
                    item.description ? `"${item.description}"` : "",
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

        // Sammensæt resultater: værksdatabase-match + præ-filter + AI
        const results = [
            ...Array.from(worksMatchResults.entries()).map(([id, r]) => ({ id, ...r })),
            ...Array.from(preResults.entries()).map(([id, r]) => ({ id, ...r })),
            ...aiResults,
        ]

        console.log(`[grovsorter] ${items.length} titler → ${worksMatchResults.size} værksmatch, ${preResults.size} præ-filter, ${aiItems.length} AI`)

        return NextResponse.json({ results })
    } catch (err: unknown) {
        console.error("[grovsorter] request failed", err instanceof Error ? err.name : "unknown")
        return NextResponse.json({ error: "Sorteringen kunne ikke gennemføres." }, { status: 500 })
    }
}
