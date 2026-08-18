/**
 * scripts/test-layout-extraction.ts
 *
 * Lag 1+2 proof-of-concept: udtræk PDF/DOCX med positioner og vis klausulgruppering.
 *
 * Kør: npx tsx scripts/test-layout-extraction.ts
 *
 * Henter de 6 senest validerede kontrakter fra Supabase (med pdf_url),
 * inkl. Rose-kontrakten hvis den findes.
 * Output vises i terminalen til godkendelse inden prompt/rendering røres.
 */

import * as dotenv from "dotenv"
import * as path from "path"
import * as fs from "fs"
import { createClient } from "@supabase/supabase-js"

dotenv.config({ path: fs.existsSync(path.resolve(".env.local")) ? ".env.local" : ".env" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Mangler NEXT_PUBLIC_SUPABASE_URL og/eller SUPABASE_SERVICE_ROLE_KEY")
    process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
})

async function downloadContract(pdfUrl: string): Promise<{ buffer: Buffer; ext: string }> {
    // pdf_url er enten en fuld Supabase storage URL eller en sti i "kontrakter"-bucketen
    if (pdfUrl.startsWith("http")) {
        const res = await fetch(pdfUrl)
        if (!res.ok) throw new Error(`HTTP ${res.status} ved download af ${pdfUrl}`)
        const buffer = Buffer.from(await res.arrayBuffer())
        const ext = pdfUrl.split("?")[0].split(".").pop()?.toLowerCase() ?? "pdf"
        return { buffer, ext }
    }

    // Storage path
    const { data, error } = await db.storage.from("kontrakter").download(pdfUrl)
    if (error || !data) throw new Error(`Storage-fejl: ${error?.message ?? "ukendt"}`)
    const buffer = Buffer.from(await data.arrayBuffer())
    const ext = pdfUrl.split(".").pop()?.toLowerCase() ?? "pdf"
    return { buffer, ext }
}

async function main() {
    // Hent de seneste kontrakter med pdf_url — forsøg at få variation i overenskomst/type
    const { data: contracts, error } = await db
        .from("contracts")
        .select("id, pdf_url, overenskomst, type, working_title, rights_holder_id")
        .not("pdf_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(30)

    if (error) { console.error("DB-fejl:", error.message); process.exit(1) }
    if (!contracts?.length) { console.error("Ingen kontrakter med pdf_url fundet."); process.exit(1) }

    // Forsøg at vælge 6 med variation — De4, FAF, dokumentar, leverandør, a-løn osv.
    const seen = new Set<string>()
    const selected: typeof contracts = []
    for (const c of contracts) {
        if (selected.length >= 6) break
        const key = `${c.overenskomst ?? "ukendt"}-${c.type ?? "ukendt"}`
        if (!seen.has(key)) {
            seen.add(key)
            selected.push(c)
        }
    }
    // Fyld op hvis vi ikke fik 6
    for (const c of contracts) {
        if (selected.length >= 6) break
        if (!selected.find(s => s.id === c.id)) selected.push(c)
    }

    console.log(`\nTester layout-udtræk på ${selected.length} kontrakter:\n`)
    for (const c of selected) {
        console.log(`  • ${c.id.slice(0, 8)} | ${c.overenskomst ?? "–"} | ${c.type ?? "–"} | ${c.working_title ?? "–"}`)
    }
    console.log()

    // Dynamisk import for at undgå "server-only" check i CLI-kontekst
    const { extractPdfTextWithLayout } = await import("../lib/pdf-parse")
    const { extractWordTextWithLayout } = await import("../lib/word-text")
    const { buildPdfLayout, buildDocxLayout, formatLayoutSample } = await import("../lib/contract-layout")

    for (const contract of selected) {
        const pdfUrl = contract.pdf_url!
        console.log("═".repeat(80))
        console.log(`Kontrakt: ${contract.id.slice(0, 8)} | ${contract.overenskomst ?? "ukendt"} | ${contract.working_title ?? "–"}`)
        console.log(`Fil: ${pdfUrl.split("/").pop() ?? pdfUrl}`)
        console.log()

        try {
            const { buffer, ext } = await downloadContract(pdfUrl)
            console.log(`Størrelse: ${(buffer.length / 1024).toFixed(0)} KB, format: ${ext}`)

            let layout
            if (ext === "pdf") {
                const fragments = await extractPdfTextWithLayout(buffer)
                console.log(`Fragmenter: ${fragments.length}`)
                layout = buildPdfLayout(fragments)
            } else if (ext === "docx" || ext === "doc") {
                const docxLayout = await extractWordTextWithLayout(buffer, pdfUrl)
                console.log(`Afsnit: ${docxLayout.paragraphs.length}`)
                layout = buildDocxLayout(docxLayout)
            } else {
                console.log(`  ⚠ Ukendt format: ${ext} — springer over.`)
                continue
            }

            console.log()
            console.log(formatLayoutSample(layout, 40))

        } catch (err) {
            console.error(`  ✗ Fejl: ${err instanceof Error ? err.message : String(err)}`)
        }
    }

    console.log("═".repeat(80))
    console.log("Færdig.")
}

main().catch(err => { console.error(err); process.exit(1) })
