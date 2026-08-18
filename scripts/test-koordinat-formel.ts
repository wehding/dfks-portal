/**
 * Bevis for koordinatformlen i lag 5:
 * 1. Hent Rose-kontrakten og byg layout (lag 1+2)
 * 2. Find s1_c14 (A. Ugeløn) og dens bounding box
 * 3. Hent PDF-sidedimensioner via pdf-parse
 * 4. Beregn CSS-koordinater og vis dem
 */
import * as dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import { createClient } from "@supabase/supabase-js"

const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function main() {
    const pdfUrl = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5/imports/52a2ec10-2f13-4057-b1b0-2c4f7fe01d9e/815ee556-f240-4adc-9bcc-afe7c2286f73/A-l_n_kontrakt_Anne_sterud_Rose-1.pdf"
    const { data, error } = await db.storage.from("kontrakter").download(pdfUrl)
    if (error || !data) { console.error("Download fejl:", error?.message); process.exit(1) }
    const buffer = Buffer.from(await data.arrayBuffer())

    // Lag 1+2
    const { extractPdfTextWithLayout } = await import("../lib/pdf-parse")
    const { buildPdfLayout } = await import("../lib/contract-layout")
    const fragments = await extractPdfTextWithLayout(buffer)
    const layout = buildPdfLayout(fragments)

    // Find s1_c14
    const clause = layout.clauses.find(c => c.id === "s1_c14")
    if (!clause?.pdfBbox) { console.error("s1_c14 ikke fundet"); process.exit(1) }
    const bbox = clause.pdfBbox

    console.log("\n=== BEVIS 1: AI returnerer s1_c14 ===")
    console.log("Klausul-ID:  s1_c14")
    console.log("Tekst:      ", clause.text.slice(0, 80))
    console.log("pdfBbox:     x=" + bbox.x.toFixed(1) + " y=" + bbox.y.toFixed(1) + " w=" + bbox.width.toFixed(1) + " h=" + bbox.height.toFixed(1))

    // Hent PDF-sidedimensioner direkte via pdfjs-dist
    // (pdf-parse wrapper eksponerer ikke getViewport korrekt i pagerender callback)
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as any)
    const loadTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) })
    const pdfDoc2 = await loadTask.promise
    const pdfPage = await pdfDoc2.getPage(1)
    const vp = pdfPage.getViewport({ scale: 1 })
    const pageW = vp.width
    const pageH = vp.height

    console.log("\n=== BEVIS 2: Koordinatformel ===")
    console.log("PDF side 1:    " + pageW.toFixed(1) + " x " + pageH.toFixed(1) + " pt (PDF-enheder)")

    // scale=1.0: rendered px = PDF pt 1:1
    const renderedW = pageW
    const renderedH = pageH

    // Formlen fra bboxToScreenStyle():
    // left  = bbox.x
    // top   = renderedH - (bbox.y + bbox.height)   ← flipper Y-akse (PDF: y=0 bund, CSS: y=0 top)
    const left   = bbox.x * (renderedW / pageW)
    const top    = renderedH - (bbox.y + bbox.height) * (renderedH / pageH)
    const width  = bbox.width * (renderedW / pageW)
    const height = bbox.height * (renderedH / pageH)

    console.log("Overlay CSS:   left=" + left.toFixed(1) + "px  top=" + top.toFixed(1) + "px  width=" + width.toFixed(1) + "px  height=" + height.toFixed(1) + "px")
    console.log("Position:      " + (top/renderedH*100).toFixed(1) + "% fra toppen af siden")
    console.log()
    console.log("Forventet:     ~55% — 'A. Ugeløn'-linjen er ca. midt på side 1 i Rose")
    console.log("Faktisk PDF:   y=" + bbox.y.toFixed(1) + " af " + pageH.toFixed(1) + " = " + (bbox.y/pageH*100).toFixed(1) + "% fra bunden = " + (100 - bbox.y/pageH*100).toFixed(1) + "% fra toppen")
}

main().catch(err => { console.error(err); process.exit(1) })
