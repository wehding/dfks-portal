import "server-only"
import mammoth from "mammoth"
import { createServiceClient } from "@/lib/supabase/service"
import { extractPdfText } from "@/lib/pdf-parse"

const BUCKET = "kontrakter"

// Henter og udtrækker rå tekst for én specifik allonge, til brug i den
// separate allonge-only AI-udtræk (løn, uger, kommentarer).
export async function hentAttachmentTekst(attachmentId: string): Promise<{ title: string | null; text: string } | null> {
    const db = createServiceClient()
    const { data: attachment } = await db
        .from("contract_attachments")
        .select("title, pdf_url")
        .eq("id", attachmentId)
        .single()

    if (!attachment?.pdf_url) return null

    const { data: fileData, error } = await db.storage.from(BUCKET).download(attachment.pdf_url)
    if (error || !fileData) {
        console.warn("[allonge-text] Kunne ikke hente allonge-fil:", attachment.pdf_url, error?.message)
        return null
    }
    const buffer = Buffer.from(await fileData.arrayBuffer())
    const ext = attachment.pdf_url.split(".").pop()?.toLowerCase()

    let text = ""
    if (ext === "pdf") text = await extractPdfText(buffer)
    else if (ext === "docx") text = (await mammoth.extractRawText({ buffer })).value
    else text = buffer.toString("utf-8")

    return { title: attachment.title, text }
}
