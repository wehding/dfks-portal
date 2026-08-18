/**
 * lib/contract-layout.ts
 *
 * Lag 2: Gruppering af PDF-fragmenter og DOCX-afsnit til klausuler med stabile ID'er.
 *
 * PDF:  fragmenter → linjer (samme Y ± threshold) → klausuler (tom linje / nummering / §)
 * DOCX: afsnit → klausuler (tom afsnit / nummering / §)
 *
 * Stabile ID-format:
 *   PDF:  "s{side}_c{klausulnr}"  — side er 1-baseret, klausulnr er 1-baseret pr. side
 *   DOCX: "p{afsnitnr}"           — 0-baseret afsnitsnummer fra mammoth
 *
 * Koordinater:
 *   PDF:  native PDF-enheder (y=0 ved siden-bund).
 *         Rendering-laget skal kende sidehøjde for at flippe til skærmkoordinater.
 *   DOCX: charStart/charEnd i flatText-strengen.
 */

import type { PdfFragment } from "./pdf-parse"
import type { DocxParagraph, DocxLayout } from "./word-text"

// ── Typer ───────────────────────────────────────────────────────────────────

export type LayoutClause = {
    id: string         // "s1_c3" eller "p7"
    page: number       // 1-baseret (DOCX: altid 1)
    text: string       // hele klausulens tekst
    bold: boolean      // starter klausulen med fed?
    numbered: boolean  // starter med §, 1., A., punkt-nummer osv.
    // PDF-specifikke positioner (undefined for DOCX)
    pdfBbox?: {
        x: number; y: number       // bund-venstre hjørne i PDF-koordinater
        width: number; height: number  // samlet bounding box for klausulen
    }
    // DOCX-specifikke positioner (undefined for PDF)
    docxRange?: { charStart: number; charEnd: number }
}

export type ContractLayout = {
    type: "pdf" | "docx"
    clauses: LayoutClause[]
    // Til debugging og fejlsøgning
    pageCount: number
    fragmentCount: number
}

// ── PDF-gruppering ───────────────────────────────────────────────────────────

/** Matcher klausul-startmønstre: §, 1., A., B., punkt X, afsnit X, litra X */
const NUMBERED_RE = /^(\d+\.|§\s*\d+|[A-ZÆØÅ]\.|litra\s+[a-z]|punkt\s+\d+|afsnit\s+\d+)/i

/** Mellemrum der indikerer ny klausul (i Y-enheder). */
const CLAUSE_GAP_FACTOR = 1.5   // klausulgap = lineHeight * CLAUSE_GAP_FACTOR
const LINE_Y_TOLERANCE  = 3     // fragmenter med |ΔY| < 3 betragtes som på samme linje

type PdfLine = {
    page: number
    y: number      // repræsentativ Y (øverste fragment i linjen)
    x: number      // venstre kant
    width: number  // samlet bredde
    height: number // representativ linjehøjde
    text: string
    bold: boolean
}

function groupFragmentsToLines(fragments: PdfFragment[]): PdfLine[] {
    if (!fragments.length) return []

    // Sortér: side stigende, Y faldende (høj Y = øverst på siden i PDF-koordinater)
    const sorted = [...fragments].sort((a, b) =>
        a.page !== b.page ? a.page - b.page : b.y - a.y
    )

    const lines: PdfLine[] = []
    let current: PdfLine | null = null

    for (const frag of sorted) {
        if (
            current &&
            current.page === frag.page &&
            Math.abs(current.y - frag.y) <= LINE_Y_TOLERANCE
        ) {
            // Samme linje — udvid
            current.text += frag.text
            const right = Math.max(current.x + current.width, frag.x + frag.width)
            current.x = Math.min(current.x, frag.x)
            current.width = right - current.x
            if (frag.bold) current.bold = true
        } else {
            // Ny linje
            current = {
                page: frag.page,
                y: frag.y,
                x: frag.x,
                width: frag.width,
                height: frag.height,
                text: frag.text,
                bold: frag.bold,
            }
            lines.push(current)
        }
    }

    return lines
}

function groupLinesToClauses(lines: PdfLine[]): LayoutClause[] {
    if (!lines.length) return []

    const clauses: LayoutClause[] = []
    // Estimér typisk linjehøjde (median af de 20 første linjer)
    const sampleHeights = lines.slice(0, 20).map(l => l.height).filter(h => h > 0).sort((a, b) => a - b)
    const medianHeight = sampleHeights[Math.floor(sampleHeights.length / 2)] ?? 12

    let clauseLines: PdfLine[] = [lines[0]]
    let clauseCountPerPage: Record<number, number> = {}

    const flushClause = () => {
        if (!clauseLines.length) return
        const text = clauseLines.map(l => l.text.trim()).filter(Boolean).join("\n")
        if (!text.trim()) { clauseLines = []; return }

        const page = clauseLines[0].page
        clauseCountPerPage[page] = (clauseCountPerPage[page] ?? 0) + 1
        const id = `s${page}_c${clauseCountPerPage[page]}`

        // Bounding box: samlet Y-spand + X-spand
        const ys = clauseLines.map(l => l.y)
        const xs = clauseLines.map(l => l.x)
        const rights = clauseLines.map(l => l.x + l.width)
        const maxY = Math.max(...ys)
        const minY = Math.min(...ys) - clauseLines[clauseLines.length - 1].height
        const minX = Math.min(...xs)
        const maxX = Math.max(...rights)

        clauses.push({
            id,
            page,
            text,
            bold: clauseLines[0].bold,
            numbered: NUMBERED_RE.test(text.trimStart()),
            pdfBbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        })
        clauseLines = []
    }

    for (let i = 1; i < lines.length; i++) {
        const prev = lines[i - 1]
        const curr = lines[i]
        const gapY = Math.abs(prev.y - curr.y)
        const lineH = medianHeight

        const newPage  = curr.page !== prev.page
        const bigGap   = gapY > lineH * CLAUSE_GAP_FACTOR
        const numbered = NUMBERED_RE.test(curr.text.trimStart())

        if (newPage || bigGap || (numbered && gapY > lineH * 0.8)) {
            flushClause()
        }

        clauseLines.push(curr)
    }
    flushClause()

    return clauses
}

export function buildPdfLayout(fragments: PdfFragment[]): ContractLayout {
    const lines = groupFragmentsToLines(fragments)
    const clauses = groupLinesToClauses(lines)
    const pageCount = fragments.reduce((m, f) => Math.max(m, f.page), 0)
    return { type: "pdf", clauses, pageCount, fragmentCount: fragments.length }
}

// ── DOCX-gruppering ──────────────────────────────────────────────────────────

export function buildDocxLayout(layout: DocxLayout): ContractLayout {
    const clauses: LayoutClause[] = []
    let clauseIndex = 0
    let buffer: DocxParagraph[] = []

    const flushClause = () => {
        if (!buffer.length) return
        const text = buffer.map(p => p.text).join("\n")
        if (!text.trim()) { buffer = []; return }

        const charStart = buffer[0].charStart
        const charEnd   = buffer[buffer.length - 1].charEnd

        clauses.push({
            id: `p${clauseIndex++}`,
            page: 1,
            text,
            bold: buffer[0].bold,
            numbered: NUMBERED_RE.test(text.trimStart()),
            docxRange: { charStart, charEnd },
        })
        buffer = []
    }

    for (let i = 0; i < layout.paragraphs.length; i++) {
        const para = layout.paragraphs[i]
        const nextPara = layout.paragraphs[i + 1]

        const isEmpty = !para.text.trim()
        const currNumbered = NUMBERED_RE.test(para.text.trimStart())
        const nextNumbered = nextPara ? NUMBERED_RE.test(nextPara.text.trimStart()) : false
        const nextBold = nextPara?.bold ?? false

        if (isEmpty) {
            flushClause()
        } else {
            // Klausulskift: det nuværende afsnit er nummereret og buffer har allerede indhold
            if (currNumbered && buffer.length > 0) {
                flushClause()
            }
            buffer.push(para)
            // Flush efter dette afsnit hvis næste er nummereret eller starter med fed
            if (nextNumbered || (nextBold && !currNumbered)) {
                flushClause()
            }
        }
    }
    flushClause()

    return {
        type: "docx",
        clauses,
        pageCount: 1,
        fragmentCount: layout.paragraphs.length,
    }
}

// ── Annoteret kontrakttekst til AI-input ────────────────────────────────────

/**
 * Bygger én sammenhængende kontrakttekst med klausul-ID'er indlejret inline.
 * Hvert klausul præfikses med sit eget ID: "[s1_c14] A. Ugeløn. ..."
 *
 * Denne tekst erstatter extractPdfText()/extractWordText() som AI-input —
 * AI'en læser nu den samme tekst som layout-strukturen er bygget af, og
 * kan aflæse *_clause_id direkte fra linjen uden korrelation eller matching.
 *
 * PII-maskning: kør maskPersonalData() på output FØR brug — ID-tags
 * ([sX_cY]/[pN]-format) påvirkes ikke af de eksisterende maskeringsregexes.
 */
export function buildAnnotatedContractText(layout: ContractLayout): string {
    return layout.clauses
        .map(c => `[${c.id}] ${c.text}`)
        .join("\n")
}

// ── Formatteret output til review ────────────────────────────────────────────

/** Kompakt tekstrepræsentation af layoutet til visning/godkendelse. */
export function formatLayoutSample(layout: ContractLayout, maxClauses = 60): string {
    const lines: string[] = [
        `Type: ${layout.type.toUpperCase()}  |  Sider: ${layout.pageCount}  |  Fragmenter/afsnit: ${layout.fragmentCount}  |  Klausuler: ${layout.clauses.length}`,
        "─".repeat(80),
    ]

    for (const clause of layout.clauses.slice(0, maxClauses)) {
        const flags = [
            clause.bold    ? "FED"   : null,
            clause.numbered ? "§/NR" : null,
        ].filter(Boolean).join(", ")

        const pos = clause.pdfBbox
            ? `s.${clause.page} y=${Math.round(clause.pdfBbox.y)}`
            : `chars ${clause.docxRange?.charStart}–${clause.docxRange?.charEnd}`

        const preview = clause.text.replace(/\n/g, " ↩ ").slice(0, 120)
        lines.push(`[${clause.id}] ${flags ? `(${flags}) ` : ""}${pos}`)
        lines.push(`  ${preview}`)
        lines.push("")
    }

    if (layout.clauses.length > maxClauses) {
        lines.push(`... og ${layout.clauses.length - maxClauses} klausuler mere.`)
    }

    return lines.join("\n")
}
