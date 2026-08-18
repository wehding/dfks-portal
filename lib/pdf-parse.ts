/**
 * Server-side PDF tekst-udtræk via pdf-parse v1.
 * v1 bruger ikke pdfjs-dist workers og virker direkte i Node.js.
 */
type PdfTextPage = {
    pageIndex?: number
    getTextContent: (options: Record<string, boolean>) => Promise<{ items: Array<{ str?: string; transform?: number[]; width?: number; height?: number; fontName?: string }> }>
}

export type PdfFragment = {
    page: number    // 1-baseret
    x: number       // PDF-enheder, venstre kant
    y: number       // PDF-enheder, bund af tegn (PDF-koordinatsystem: 0 = side-bund)
    width: number   // PDF-enheder
    height: number  // skriftstørrelse i PDF-enheder
    text: string
    bold: boolean
}

export async function renderPdfPageText(page: PdfTextPage) {
    const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
    let lastY: number | null = null
    let text = ""
    for (const item of content.items) {
        const y = item.transform?.[5] ?? null
        text += lastY == null || y === lastY ? (item.str ?? "") : `\n${item.str ?? ""}`
        lastY = y
    }
    return `${page.pageIndex ? "\f" : ""}${text}`
}

/**
 * Ny funktion: udtræk PDF-tekst MED layoutpositioner.
 * Eksisterende extractPdfText() røres ikke — mange andre steder bruger den stadig.
 *
 * Koordinatsystem: PDF native (y=0 ved siden-bund, stigende opad).
 * Konvertering til skærm-koordinater sker i rendering-laget (kræver sidehøjde).
 */
export async function extractPdfTextWithLayout(buffer: Buffer): Promise<PdfFragment[]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfLib = require("pdf-parse/lib/pdf-parse.js")
    const fragments: PdfFragment[] = []
    let currentPage = 0

    async function pagerender(page: PdfTextPage & { pageIndex?: number }) {
        currentPage = (page.pageIndex ?? 0) + 1
        const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: true })
        for (const item of content.items) {
            const t = item.transform
            if (!t || !item.str) continue
            const x = t[4] ?? 0
            const y = t[5] ?? 0
            // Skriftstørrelse: |d| element i transformationsmatricen (index 3)
            const height = Math.abs(t[3] ?? t[0] ?? 10)
            const width = item.width ?? 0
            const fontName = item.fontName ?? ""
            const bold = /bold|black|heavy/i.test(fontName)
            if (item.str.trim()) {
                fragments.push({ page: currentPage, x, y, width, height, text: item.str, bold })
            }
        }
        return ""
    }

    await pdfLib(buffer, { pagerender })
    return fragments
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse")
    const data = await pdfParse(buffer, {
        pagerender: renderPdfPageText,
    })
    return String(data.text ?? "").trim()
}
