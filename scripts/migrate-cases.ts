/**
 * scripts/migrate-cases.ts
 *
 * Migrerer anonymiserede cases til learned_patterns i Supabase.
 * Kør: npx tsx scripts/migrate-cases.ts
 */

import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import * as path from "path"
import * as fs from "fs"

const envPath = path.resolve(process.cwd(), ".env.local")
dotenv.config({ path: fs.existsSync(envPath) ? envPath : ".env" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY!

if (!SUPABASE_URL || !SUPABASE_KEY || !GOOGLE_API_KEY) {
    console.error("Mangler env-variabler")
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function embed(tekst: string): Promise<number[]> {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GOOGLE_API_KEY}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "models/gemini-embedding-001",
                content: { parts: [{ text: tekst.slice(0, 8000) }] },
                outputDimensionality: 768,
            }),
        }
    )
    if (!res.ok) throw new Error(`Google API ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data.embedding.values
}

const CASES = [
    {
        titel: "Underskrevet standardkontrakt til arkivering",
        regel: "Underskrevne kontrakter der indsendes til arkivering kræver ikke rådgivning. Svar kort og venligt om arkivering og Copydan-compliance.",
        semantiskBeskrivelse: "Underskrevet kontrakt til arkiv ingen rådgivning nødvendig",
        kilde: "case-19c70414b359f81b",
    },
    {
        titel: "God fiktionskontrakt med anbefalede tilføjelser",
        regel: "Kontrakt følger overenskomsten med god løn. Anbefal AI-beskyttelse og prolongationsvarsel som forbedringer men kontrakten kan underskrives.",
        semantiskBeskrivelse: "Fiktionskontrakt overenskomstdækket med mindre mangler AI-klausul og prolongation",
        kilde: "case-19e39f3f4b76c32d",
    },
    {
        titel: "Hybrid A-løn/faktura kontrakt — høj risiko",
        regel: "Kontrakt der blander A-løn og leverandørvilkår er juridisk uholdbar. Anbefal ikke at underskrive. Kræv entydig A-lønsaftale med pension, sygdom, Copydan og AI-klausul. Tjek altid navnematch mod medlemsregister.",
        semantiskBeskrivelse: "Hybrid kontrakt faktura og A-løn mangler pension sygdom ikke-overenskomstdækket producent høj risiko",
        kilde: "case-19ea3f8cb4ac5420",
    },
    {
        titel: "Ansættelseskontrakt uden overenskomst — mangler pension og rettigheder",
        regel: "Producent ikke-overenskomstdækket. Mangler pension, Create Denmark, AI-beskyttelse. Kreditering for usikker. Ferieregler ændret til ugunst. Anbefal ikke at underskrive uden rettelser.",
        semantiskBeskrivelse: "Ansættelseskontrakt ingen overenskomst mangler pension streaming AI-beskyttelse kreditering usikker",
        kilde: "case-19ea6630b2a536a6",
    },
]

async function main() {
    console.log(`\nMigrerer ${CASES.length} cases til learned_patterns...\n`)
    let ok = 0, fejl = 0

    for (const c of CASES) {
        process.stdout.write(`  [${c.kilde}] ${c.titel} ... `)
        try {
            const embedding = await embed(c.semantiskBeskrivelse)

            // Tjek om pattern allerede eksisterer baseret på kilde-ID i metadata
            const { data: existing } = await supabase
                .from("learned_patterns")
                .select("id")
                .eq("titel", c.titel)
                .limit(1)
                .single()

            if (existing) {
                // Opdater eksisterende
                const { error } = await supabase
                    .from("learned_patterns")
                    .update({
                        regel: c.regel,
                        semantisk_beskrivelse: c.semantiskBeskrivelse,
                        embedding,
                        godkendt_af: "DFKS-sekretariat",
                        aktiv: true,
                    })
                    .eq("id", existing.id)
                if (error) throw new Error(error.message)
                console.log("✓ (opdateret)"); ok++
            } else {
                // Indsæt ny
                const { error } = await supabase.from("learned_patterns").insert({
                    titel: c.titel,
                    regel: c.regel,
                    semantisk_beskrivelse: c.semantiskBeskrivelse,
                    embedding,
                    godkendt_af: "DFKS-sekretariat",
                    aktiv: true,
                })
                if (error) throw new Error(error.message)
                console.log("✓ (ny)"); ok++
            }
        } catch (e: any) {
            console.log(`✗ ${e.message}`); fejl++
        }
        await new Promise(r => setTimeout(r, 300))
    }

    console.log(`\nFærdig: ${ok} ok, ${fejl} fejl`)
}

main().catch(e => { console.error(e); process.exit(1) })
