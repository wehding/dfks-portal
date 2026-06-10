/**
 * Server-side PDF tekst-udtræk via pdf-parse v1.
 * v1 bruger ikke pdfjs-dist workers og virker direkte i Node.js.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse")
    const data = await pdfParse(buffer)
    return data.text as string
}
