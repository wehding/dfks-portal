/**
 * scripts/index-rules.ts
 *
 * Indekserer DFKS-faglige regler og standardklausuler som knowledge_chunks.
 * Satser (kr/%) indgår IKKE — de lagres i overenskomst_satser.
 *
 * Kør: npx tsx scripts/index-rules.ts
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

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Mangler NEXT_PUBLIC_SUPABASE_URL og/eller SUPABASE_SERVICE_ROLE_KEY")
    process.exit(1)
}
if (!GOOGLE_API_KEY) {
    console.error("Mangler GOOGLE_API_KEY")
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

// ── DFKS-regel-chunks (ingen satser) ─────────────────────────

const RULES_CHUNKS = [
    {
        kilde_id: "dfks-producentforeningens-tjek",
        kilde_titel: "Producentforeningens medlemskabstjek",
        tekst: `Overenskomstdækning afhænger af om producenten er medlem af Producentforeningen (Pro-F). Hvis producenten er IKKE-MEDLEM er der ingen gældende overenskomst og alle vilkår skal skrives direkte ind i kontrakten: mindsteløn, pension, sygdom, aflysning, Create Denmark, Copydan og AI-beskyttelse.`,
        kategori: "producentforening",
        dfks_fortolkning: `Altid tjek Producentforeningen-medlemskab som første skridt. Ikke-overenskomstdækkede producenter kræver at alle vilkår skrives eksplicit ind.`,
    },
    {
        kilde_id: "dfks-fiktion-pension-princip",
        kilde_titel: "Pension ved fiktionsoverenskomsten — princip",
        tekst: `Pension indbetales af producenten I TILLÆG til grundlønnen. Pensionen beregnes af grundlønnen alene, ikke af tillæg eller personlige tillæg. Hvis en producent beregner pension af samlet løn inkl. tillæg er det acceptabelt men ikke et krav.`,
        kategori: "pension",
        dfks_fortolkning: null,
    },
    {
        kilde_id: "dfks-4-dages-uge",
        kilde_titel: "4-dages arbejdsuge — lønprincip",
        tekst: `Ved en 4-dages uge må producenten ikke blot reducere ugelønnen med 20%. Hvis producenten reelt køber enkeltdage bør klipperen aflønnes med dagsgager: ugeløn divideret med 5 plus et tillæg for korte ansættelser. Fire dages arbejde svarer dermed til 88% af en fuld ugeløn, ikke 80%.`,
        kategori: "løn",
        dfks_fortolkning: null,
    },
    {
        kilde_id: "dfks-aloen-vs-faktura",
        kilde_titel: "A-løn vs. fakturering — anbefaling",
        tekst: `DFKS anbefaler som udgangspunkt A-løn. Ved fakturering som leverandør skal prisen tillægges minimum 23,5% for at dække sociale ydelser. Leverandører har IKKE ret til løn under sygdom og skal selv tegne sygeforsikring. A-lønnede er dækket af Lønmodtagernes Garantifond ved konkurs. Leverandører mister alt udestående som usikrede kreditorer.`,
        kategori: "ansættelsesform",
        dfks_fortolkning: null,
    },
    {
        kilde_id: "dfks-dokumentar-konflikt",
        kilde_titel: "Dokumentarfilm — konfliktsituation og minimumsvilkår",
        tekst: `Kort- og dokumentarfilm er reguleret af 2000-overenskomsten som er forældet. DFKS kæmper i hver enkelt kontrakt for minimumsvilkår: ingen buy-out på rettigheder, særskilt streamingvederlag via Create Denmark, royalty ved videreudnyttelse, AI-beskyttelse og Copydan-forbehold. Sygdom: kun ret til løn efter 160 timers beskæftigelse hos producenten inden for 1 måned.`,
        kategori: "dokumentar",
        dfks_fortolkning: null,
    },
    {
        kilde_id: "dfks-klausul-create-denmark",
        kilde_titel: "Standardklausul — Create Denmark / streaming-forbehold",
        tekst: `Filmklipperen har desuagtet aftalens øvrige vilkår ret til særskilt betaling for udnyttelse til streaming og salg til tredjemand. Vilkår herfor aftales samlet via Create Denmark. Producenten er indforstået med at fordeling af rettighedsbetaling herunder royalty mellem rettighedshaverne besluttes af de relevante forbund i forening og producenten kan ikke holdes ansvarlig for denne fordeling.`,
        kategori: "streaming-forbehold",
        dfks_fortolkning: null,
    },
    {
        kilde_id: "dfks-klausul-copydan",
        kilde_titel: "Standardklausul — Copydan-forbehold",
        tekst: `Filmklipperen og producenten bevarer desuagtet øvrige aftalevilkår hver deres rettigheder samt en vederlagsret for brug af produktionen omfattet af Ophavsretslovens paragraf 13, 13a, 17, 30a, 35 og 50 stk. 2 herunder bestemmelser der i fremtiden måtte afløse eller på sammenlignelig vis supplere disse bestemmelser. Filmklipperen og producenten bevarer ret til kompensation for eksemplarfremstilling til privat brug.`,
        kategori: "copydan-forbehold",
        dfks_fortolkning: null,
    },
    {
        kilde_id: "dfks-klausul-ai-beskyttelse",
        kilde_titel: "Standardklausul — AI-beskyttelse (tekst- og datamining)",
        tekst: `Retten til at udnytte indholdet med henblik på tekst- og datamining jf. ophavsretslovens paragraf 11b og DSM-direktivets artikel 4 kræver såvel Producentens som Filmklipperens samtykke. Forklaring til medlem: Det handler om tekst- og datamining, altså at materialet ikke må bruges til AI-træning, automatiseret analyse eller lignende maskinlæsning uden samtykke.`,
        kategori: "ai-beskyttelse",
        dfks_fortolkning: null,
    },
    {
        kilde_id: "dfks-klausul-konkurs",
        kilde_titel: "Standardklausul — Konkurs og betalingsstandsning",
        tekst: `I tilfælde af Producentens konkurs eller betalingsstandsning falder de rettigheder Filmklipperen har overdraget til Producenten tilbage til Filmklipperen 30 dage efter konkursbegæringens indgivelse respektive betalingsstandsningens anmeldelse medmindre der forinden er stillet fuld og betryggende sikkerhed for at alle skyldige ydelser vil blive betalt til forfaldstid.`,
        kategori: "konkurs",
        dfks_fortolkning: null,
    },
    {
        kilde_id: "dfks-klausul-prolongation",
        kilde_titel: "Standardklausul — Prolongation (forlængelse)",
        tekst: `Filmklipperen er engageret med mulighed for prolongation. Hvis prolongation ønskes skal filmklipperen have skriftlig besked senest 3 uger før den aftalte periodes udløb. Blankt prolongations-felt er en advarsel — bør altid præciseres med varsel.`,
        kategori: "prolongation",
        dfks_fortolkning: null,
    },
    {
        kilde_id: "dfks-klausul-sygdom-fiktion",
        kilde_titel: "Standardklausul — Løn under sygdom (fiktionsoverenskomst)",
        tekst: `Bliver Filmklipperen på grund af sygdom ude af stand til at udføre sine forpligtelser betragtes det heraf følgende fravær som lovligt forfald der giver ret til løn under sygdom. Er sygdommen af en sådan art at den skønnes at kunne påføre Producenten væsentlige praktiske og økonomiske belastninger er Producenten berettiget til at opsige kontrakten så længe de aftalte opsigelsesvarsler overholdes.`,
        kategori: "sygdom",
        dfks_fortolkning: null,
    },
    {
        kilde_id: "dfks-kreditering-regler",
        kilde_titel: "Kreditering — regler og standarder",
        tekst: `Kreditering skal altid skrives præcist ind i kontrakten som: Klipper: [Navn]. Brug ALDRIG A-klipper som kreditering. Hvis flere klippere og medlemmet har hovedfunktionen kan Konceptuerende klipper bruges. Tjek altid at navn i kontrakt matcher DFKS-medlemsregisteret.`,
        kategori: "kreditering",
        dfks_fortolkning: null,
    },
    {
        kilde_id: "dfks-navn-mismatch",
        kilde_titel: "Navnekontrol mod medlemsregister",
        tekst: `Hvis navn i kontrakt ikke stemmer overens med DFKS-medlemsregisteret skal svarmailen gøre opmærksom på forskellen neutralt og opmærksomhedsskabende. Formuleringen må ikke konkludere at medlemmet skal bruge registret-navnet. Eksempel: I DFKS' medlemsregister er du registreret som [registernavn]. I kontrakten står du som [kontraktnavn]. Jeg vil bare sikre mig at du er opmærksom på forskellen.`,
        kategori: "navnekontrol",
        dfks_fortolkning: null,
    },
]

async function main() {
    console.log(`\nIndekserer ${RULES_CHUNKS.length} DFKS-regel-chunks...\n`)
    let ok = 0, fejl = 0

    for (const chunk of RULES_CHUNKS) {
        process.stdout.write(`  [${chunk.kilde_id}] ... `)
        try {
            const embedTekst = chunk.dfks_fortolkning
                ? `${chunk.tekst}\n\nDFKS-fortolkning: ${chunk.dfks_fortolkning}`
                : chunk.tekst

            const embedding = await embed(embedTekst)

            const { error } = await supabase.from("knowledge_chunks").upsert({
                kilde_id: chunk.kilde_id,
                kilde_type: "DFKS-regler",
                kilde_titel: chunk.kilde_titel,
                tekst: chunk.tekst,
                org_id: null,
                kategori: chunk.kategori,
                metadata: {
                    dfks_fortolkning: chunk.dfks_fortolkning ?? null,
                },
                embedding,
            }, { onConflict: "kilde_id" })

            if (error) throw new Error(error.message)
            console.log("✓"); ok++
        } catch (e: any) {
            console.log(`✗ ${e.message}`); fejl++
        }
        await new Promise(r => setTimeout(r, 300))
    }

    console.log(`\nFærdig: ${ok} ok, ${fejl} fejl`)
}

main().catch(e => { console.error(e); process.exit(1) })
