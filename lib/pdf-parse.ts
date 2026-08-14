/**
 * Server-side PDF tekst-udtræk via pdf-parse v1.
 * v1 bruger ikke pdfjs-dist workers og virker direkte i Node.js.
 */
type PdfTextPage = {
    pageIndex?: number
    getTextContent: (options: Record<string, boolean>) => Promise<{ items: Array<{ str?: string; transform?: number[] }> }>
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

export async function extractPdfText(buffer: Buffer): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse")
    const data = await pdfParse(buffer, {
        pagerender: renderPdfPageText,
    })
    return String(data.text ?? "").trim()
}
