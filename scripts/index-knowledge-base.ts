/**
 * scripts/index-knowledge-base.ts
 *
 * Indekserer alle eksisterende sagserfaringer og juridiske noter
 * i knowledge_chunks-tabellen med Google gemini-embedding-001 embeddings.
 *
 * Kør med: npx ts-node --esm scripts/index-knowledge-base.ts
 * eller:   npx tsx scripts/index-knowledge-base.ts
 */

import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import * as path from "path"
import * as fs from "fs"

// Load .env.local
const envPath = path.resolve(process.cwd(), ".env.local")
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath })
} else {
    dotenv.config()
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY!

if (!SUPABASE_URL || !SUPABASE_KEY || !GOOGLE_API_KEY) {
    console.error("Mangler env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_API_KEY")
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function embedText(text: string): Promise<number[]> {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GOOGLE_API_KEY}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "models/gemini-embedding-001",
                content: { parts: [{ text: text.slice(0, 8000) }] },
                outputDimensionality: 768,
            }),
        }
    )
    if (!res.ok) throw new Error(`Google Embedding API fejl ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data.embedding.values
}

async function upsert(params: {
    kilde_id: string
    kilde_type: string
    kilde_titel: string
    tekst: string
    org_id: string | null
    metadata?: Record<string, unknown>
}) {
    const embedding = await embedText(params.tekst)
    const { error } = await supabase.from("knowledge_chunks").upsert({
        kilde_id: params.kilde_id,
        kilde_type: params.kilde_type,
        kilde_titel: params.kilde_titel,
        tekst: params.tekst,
        org_id: params.org_id,
        metadata: params.metadata ?? {},
        embedding,
    }, { onConflict: "kilde_id" })
    if (error) throw new Error(`Supabase fejl: ${error.message}`)
}

async function indexCaseLearnings() {
    console.log("\n── Sagserfaringer ─────────────────────────────────")
    const { data, error } = await supabase.from("case_learnings").select("*")
    if (error) { console.error("Fejl ved hentning:", error.message); return }
    if (!data?.length) { console.log("Ingen sagserfaringer fundet."); return }

    console.log(`Fundet ${data.length} sagserfaringer`)
    for (const row of data) {
        if (!row.regel?.trim()) {
            console.log(`  ⏭  Springer over (tom regel): ${row.titel}`)
            continue
        }
        process.stdout.write(`  ↳  ${row.titel}... `)
        await upsert({
            kilde_id: row.id,
            kilde_type: "sagserfaring",
            kilde_titel: row.titel,
            tekst: `${row.titel}: ${row.regel}`,
            org_id: row.org_id,
            metadata: { kontrakttype: row.kontrakttype },
        })
        console.log("✓")
        await new Promise(r => setTimeout(r, 200)) // rate limit
    }
}

async function indexLegalNotes() {
    console.log("\n── Juridiske noteringer ───────────────────────────")
    const { data, error } = await supabase
        .from("legal_notes")
        .select("*")
        .eq("active", true)
    if (error) { console.error("Fejl ved hentning:", error.message); return }
    if (!data?.length) { console.log("Ingen juridiske noter fundet."); return }

    console.log(`Fundet ${data.length} juridiske noter`)
    for (const row of data) {
        if (!row.body?.trim()) {
            console.log(`  ⏭  Springer over (tom body): ${row.title}`)
            continue
        }
        process.stdout.write(`  ↳  ${row.title}... `)
        await upsert({
            kilde_id: `note-${row.id}`,
            kilde_type: "juridisk-note",
            kilde_titel: row.title,
            tekst: `${row.title}: ${row.body}`,
            org_id: row.org_id,
            metadata: { priority: row.priority },
        })
        console.log("✓")
        await new Promise(r => setTimeout(r, 200))
    }
}

async function main() {
    console.log("DFKS Knowledge Base Indexer")
    console.log("===========================")
    console.log(`Supabase: ${SUPABASE_URL}`)
    console.log(`Model: gemini-embedding-001 (768 dim)`)

    // Vis nuværende antal chunks
    const { count } = await supabase
        .from("knowledge_chunks")
        .select("*", { count: "exact", head: true })
    console.log(`Eksisterende chunks i DB: ${count ?? 0}`)

    await indexCaseLearnings()
    await indexLegalNotes()

    const { count: newCount } = await supabase
        .from("knowledge_chunks")
        .select("*", { count: "exact", head: true })

    console.log("\n===========================")
    console.log(`Færdig. Chunks i DB: ${newCount ?? 0}`)
}

main().catch(e => { console.error(e); process.exit(1) })
