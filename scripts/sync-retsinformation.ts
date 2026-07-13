/**
 * scripts/sync-retsinformation.ts
 *
 * Henter opdateret lovtekst fra retsinformation.dk via ELI-URL'er
 * og upsert relevante paragraffer til knowledge_chunks i Supabase.
 *
 * Kør manuelt: npx tsx scripts/sync-retsinformation.ts
 * Kaldes også fra /api/admin/sync-retsinformation (cron + manuel)
 *
 * API: https://retsinformation.dk/eli/lta/{year}/{num}/xml
 * Ingen autentificering. Polite rate: ~1 req/sek.
 */

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ORG_ID        = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID ?? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5"
const ELI_BASE      = "https://retsinformation.dk"

// ── Love vi følger ────────────────────────────────────────────

const LOVE: Array<{
    key: string
    navn: string
    year: number
    num: number
    paragraffer: Array<{
        id: string
        num: string           // "1", "2", "11b", osv.
        dfks_emne: string     // hvad handler den om for DFKS
        dfks_fortolkning?: string
    }>
}> = [
    {
        key: "ophavsretsloven",
        navn: "Ophavsretsloven",
        year: 2014,
        num: 1144,
        paragraffer: [
            { id: "1",   num: "1",   dfks_emne: "Filmklipperens ophavsret — definition og automatisk opståen" },
            { id: "2",   num: "2",   dfks_emne: "Eneret til eksemplarfremstilling og tilgængeliggørelse — alle distributionsformer" },
            { id: "3",   num: "3",   dfks_emne: "Ideelle rettigheder — navngivning og beskyttelse mod ændringer" },
            { id: "11b", num: "11b", dfks_emne: "TDM-forbehold — retten til at frabede sig tekst- og datamining (AI-træning)" },
            { id: "53",  num: "53",  dfks_emne: "Filmværker — særlige regler for producentens stilling" },
            { id: "65",  num: "65",  dfks_emne: "Kollektive aftaler og vederlæggelse — Copydan og aftalelicens" },
            { id: "66",  num: "66",  dfks_emne: "Aftalelicens — retsvirkning og vederlag" },
        ],
    },
    {
        key: "aftaleloven",
        navn: "Aftaleloven",
        year: 2016,
        num: 193,
        paragraffer: [
            { id: "36",  num: "36",  dfks_emne: "Urimelige aftalevilkår kan tilsidesættes — generalklausulen" },
            { id: "38a", num: "38a", dfks_emne: "Aftaler der begrænser erhvervsudøvelse — konkurrenceklausuler" },
        ],
    },
    {
        key: "funktionaerloven",
        navn: "Funktionærloven",
        year: 2017,
        num: 1002,
        paragraffer: [
            { id: "2",   num: "2",   dfks_emne: "Opsigelsesvarsel — stigende varsel med anciennitet" },
            { id: "5",   num: "5",   dfks_emne: "Sygdom og § 5,2-klausulen (120-dages reglen)" },
            { id: "9",   num: "9",   dfks_emne: "Godtgørelse ved usaglig afskedigelse" },
        ],
    },
    {
        key: "ferieloven",
        navn: "Ferieloven",
        year: 2018,
        num: 60,
        paragraffer: [
            { id: "9",  num: "9",  dfks_emne: "Feriepenge — beregning og optjening" },
            { id: "24", num: "24", dfks_emne: "Ferie under sygdom — rettigheder ved sygdom i ferieperioden" },
        ],
    },
    {
        key: "barselsloven",
        navn: "Barselsloven",
        year: 2024,
        num: 1069,
        paragraffer: [
            { id: "6",  num: "6",  dfks_emne: "Ret til orlov — barsel for begge forældre" },
            { id: "26", num: "26", dfks_emne: "Dagpenge under barsel — beregningsgrundlag" },
        ],
    },
]

// ── XML-parsing ───────────────────────────────────────────────

function stripXml(xml: string): string {
    return xml
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/\s+/g, " ")
        .trim()
}

function extractParagraph(xml: string, num: string): string | null {
    // Match <Paragraf ...> blocks by localId or by § X. notation
    const patterns = [
        // localId attribute (most reliable)
        new RegExp(`<Paragraf[^>]*localId="${num}"[^>]*>([\\s\\S]*?)</Paragraf>`, "i"),
        // Explicit § num.
        new RegExp(`<Paragraf[^>]*>\\s*<Explicatus>§\\s*${num.replace("b", "\\s*b?")}\\s*\\.`, "i"),
    ]

    for (const re of patterns) {
        const match = xml.match(re)
        if (match) {
            const block = match[0] ?? match[1]
            return stripXml(block).slice(0, 4000) // max 4000 tegn
        }
    }

    // Fallback: søg på § X. i rå XML
    const idx = xml.indexOf(`§ ${num}.`)
    if (idx === -1) return null
    const slice = xml.slice(Math.max(0, idx - 200), idx + 2000)
    return stripXml(slice)
}

// ── Hent lov fra retsinformation ─────────────────────────────

async function fetchLaw(year: number, num: number): Promise<string> {
    const url = `${ELI_BASE}/eli/lta/${year}/${num}/xml`
    const res = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "DFKS-Portal/1.0 (kontakt@dfks.dk)" },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return res.text()
}

// ── Sleep ─────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── Upsert til knowledge_chunks ───────────────────────────────

async function upsertChunk(supabase: ReturnType<typeof createClient<any>>, chunk: {
    kilde_id: string
    kilde_type: string
    kilde_titel: string
    tekst: string
    org_id: string
    metadata: Record<string, unknown>
}) {
    const { error } = await supabase
        .from("knowledge_chunks")
        .upsert([chunk], { onConflict: "kilde_id" })
    if (error) throw new Error(`Upsert fejlede for ${chunk.kilde_id}: ${error.message}`)
}

// ── Hoved-funktion ────────────────────────────────────────────

export async function syncRetsinformation(): Promise<{
    ok: number
    fejl: number
    log: string[]
}> {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    })

    const log: string[] = []
    let ok = 0, fejl = 0

    for (const lov of LOVE) {
        log.push(`\n📖 ${lov.navn} (${lov.year}/${lov.num})`)

        let xml: string
        try {
            xml = await fetchLaw(lov.year, lov.num)
            log.push(`  ✓ Hentet (${Math.round(xml.length / 1024)} KB)`)
        } catch (e: any) {
            log.push(`  ✗ Hentning fejlede: ${e.message}`)
            fejl += lov.paragraffer.length
            continue
        }

        await sleep(1000) // polite rate limit

        for (const para of lov.paragraffer) {
            const tekst = extractParagraph(xml, para.id)
            if (!tekst) {
                log.push(`  ✗ § ${para.id} ikke fundet`)
                fejl++
                continue
            }

            const kilde_id = `retsinformation-${lov.key}-§${para.id}`
            const kilde_titel = `${lov.navn} § ${para.id} — ${para.dfks_emne}`
            const semantisk = `${lov.navn} § ${para.id}: ${para.dfks_emne}. ${tekst.slice(0, 300)}`

            try {
                await upsertChunk(supabase, {
                    kilde_id,
                    kilde_type: "lovtekst",
                    kilde_titel,
                    tekst: semantisk,
                    org_id: ORG_ID,
                    metadata: {
                        raa_tekst: tekst,
                        dfks_fortolkning: para.dfks_fortolkning ?? null,
                        lov: lov.navn,
                        paragraf: para.id,
                        eli_url: `${ELI_BASE}/eli/lta/${lov.year}/${lov.num}`,
                        sidst_opdateret: new Date().toISOString(),
                    },
                })
                log.push(`  ✓ § ${para.id} upserted`)
                ok++
            } catch (e: any) {
                log.push(`  ✗ § ${para.id} upsert fejlede: ${e.message}`)
                fejl++
            }
        }
    }

    log.push(`\n✅ Færdig: ${ok} ok, ${fejl} fejl`)
    return { ok, fejl, log }
}

// ── CLI-kørsel ────────────────────────────────────────────────

if (require.main === module) {
    syncRetsinformation().then(({ log }) => {
        console.log(log.join("\n"))
    }).catch(console.error)
}
