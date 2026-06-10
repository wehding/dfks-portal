/**
 * scripts/index-knowledge-base.ts
 *
 * Indekserer til Supabase knowledge_chunks via syv.ai embeddings:
 *   1. data/knowledge-base/*.json  — lovtekster og juridiske regler
 *   2. Sagserfaringer fra case_learnings-tabellen
 *   3. Aktive juridiske noter fra legal_notes-tabellen
 *
 * Kør: npx tsx scripts/index-knowledge-base.ts
 */

import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import * as path from "path"
import * as fs from "fs"

// ── Env ───────────────────────────────────────────────────────

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

// ── Embedding (Google text-embedding-004, 768 dim) ────────────

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

// ── Upsert ────────────────────────────────────────────────────

async function upsert(params: {
    kilde_id: string
    kilde_type?: string
    kilde_titel: string
    tekst: string
    org_id?: string | null
    metadata?: Record<string, unknown>
}) {
    const embedding = await embed(params.tekst)
    const { error } = await supabase.from("knowledge_chunks").upsert({
        kilde_id: params.kilde_id,
        kilde_type: params.kilde_type ?? "lovtekst",
        kilde_titel: params.kilde_titel,
        tekst: params.tekst,
        org_id: params.org_id ?? null,
        metadata: params.metadata ?? {},
        embedding,
    }, { onConflict: "kilde_id" })
    if (error) throw new Error(`Supabase: ${error.message}`)
}

// ── 1. JSON-filer: lovtekster ─────────────────────────────────

async function indexJsonFiles() {
    const kbDir = path.join(process.cwd(), "data", "knowledge-base")
    if (!fs.existsSync(kbDir)) {
        console.log("  (ingen data/knowledge-base/ mappe — springer over)")
        return
    }

    const files = fs.readdirSync(kbDir).filter(f => f.endsWith(".json"))
    if (files.length === 0) { console.log("  (ingen JSON-filer — springer over)"); return }

    let ok = 0, fejl = 0
    for (const file of files) {
        const chunks = JSON.parse(fs.readFileSync(path.join(kbDir, file), "utf-8"))
        console.log(`  ${file}: ${chunks.length} chunks`)
        for (const c of chunks) {
            process.stdout.write(`    [${c.id}] ... `)
            try {
                await upsert({
                    kilde_id: c.id,
                    kilde_type: "lovtekst",
                    kilde_titel: c.kilde_titel,
                    tekst: c.semantisk_beskrivelse,
                    metadata: {
                        raa_tekst: c.raa_tekst,
                        dfks_fortolkning: c.dfks_fortolkning,
                        roede_flag: c.roede_flag,
                        standard_formulering: c.standard_formulering,
                    },
                })
                console.log("✓"); ok++
            } catch (e: any) {
                console.log(`✗ ${e.message}`); fejl++
            }
            await new Promise(r => setTimeout(r, 250))
        }
    }
    console.log(`  → ${ok} ok, ${fejl} fejl`)
}

// ── 2. Sagserfaringer fra DB ──────────────────────────────────

async function indexCaseLearnings() {
    const { data, error } = await supabase.from("case_learnings").select("*")
    if (error) { console.log(`  Fejl: ${error.message}`); return }
    if (!data?.length) { console.log("  (ingen sagserfaringer)"); return }

    let ok = 0, fejl = 0
    for (const row of data) {
        if (!row.regel?.trim()) continue
        process.stdout.write(`  [${row.id?.slice(0, 8)}] ${row.titel?.slice(0, 50)} ... `)
        try {
            await upsert({
                kilde_id: row.id,
                kilde_type: "sagserfaring",
                kilde_titel: row.titel,
                tekst: `${row.titel}: ${row.regel}`,
                org_id: row.org_id,
                metadata: { kontrakttype: row.kontrakttype },
            })
            console.log("✓"); ok++
        } catch (e: any) {
            console.log(`✗ ${e.message}`); fejl++
        }
        await new Promise(r => setTimeout(r, 250))
    }
    console.log(`  → ${ok} ok, ${fejl} fejl`)
}

// ── 3. Juridiske noter fra DB ─────────────────────────────────

async function indexLegalNotes() {
    const { data, error } = await supabase.from("legal_notes").select("*").eq("active", true)
    if (error) { console.log(`  Fejl: ${error.message}`); return }
    if (!data?.length) { console.log("  (ingen aktive juridiske noter)"); return }

    let ok = 0, fejl = 0
    for (const row of data) {
        if (!row.body?.trim()) continue
        process.stdout.write(`  [note-${row.id?.slice(0, 8)}] ${row.title?.slice(0, 50)} ... `)
        try {
            await upsert({
                kilde_id: `note-${row.id}`,
                kilde_type: "juridisk-note",
                kilde_titel: row.title,
                tekst: `${row.title}: ${row.body}`,
                org_id: row.org_id,
                metadata: { priority: row.priority },
            })
            console.log("✓"); ok++
        } catch (e: any) {
            console.log(`✗ ${e.message}`); fejl++
        }
        await new Promise(r => setTimeout(r, 250))
    }
    console.log(`  → ${ok} ok, ${fejl} fejl`)
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
    console.log("\nDFKS Knowledge Base Indexer (syv.ai / multilingual-e5-large-instruct)")
    console.log("=======================================================================")

    const { count: før } = await supabase.from("knowledge_chunks").select("*", { count: "exact", head: true })
    console.log(`Chunks i DB før: ${før ?? 0}\n`)

    console.log("1. Lovtekster (JSON-filer)")
    await indexJsonFiles()

    console.log("\n2. Sagserfaringer (DB)")
    await indexCaseLearnings()

    console.log("\n3. Juridiske noter (DB)")
    await indexLegalNotes()

    const { count: efter } = await supabase.from("knowledge_chunks").select("*", { count: "exact", head: true })
    console.log(`\n=======================================================================`)
    console.log(`Chunks i DB efter: ${efter ?? 0}`)
    console.log("Færdig.\n")
}

main().catch(e => { console.error(e); process.exit(1) })
