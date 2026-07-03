import "server-only"
import mammoth from "mammoth"
import { createServiceClient } from "@/lib/supabase/service"
import { extractPdfText } from "@/lib/pdf-parse"

const BUCKET = "kontrakter"

// Henter og sammensætter rå tekst fra alle allonger på en kontrakt,
// klar til at blive tilføjet til kontraktteksten FØR maskePersonalData().
export async function hentAllongeTekst(contractId: string): Promise<string> {
    const db = createServiceClient()
    const { data: attachments } = await db
        .from("contract_attachments")
        .select("title, pdf_url, created_at")
        .eq("contract_id", contractId)
        .eq("type", "allonge")
        .order("created_at", { ascending: true })

    if (!attachments?.length) return ""

    let combined = ""
    for (const a of attachments) {
        if (!a.pdf_url) continue
        const { data: fileData, error } = await db.storage.from(BUCKET).download(a.pdf_url)
        if (error || !fileData) {
            console.warn("[allonge-text] Kunne ikke hente allonge-fil:", a.pdf_url, error?.message)
            continue
        }
        const buffer = Buffer.from(await fileData.arrayBuffer())
        const ext = a.pdf_url.split(".").pop()?.toLowerCase()

        let text = ""
        try {
            if (ext === "pdf") text = await extractPdfText(buffer)
            else if (ext === "docx") text = (await mammoth.extractRawText({ buffer })).value
            else text = buffer.toString("utf-8")
        } catch (e) {
            console.warn("[allonge-text] Kunne ikke udtrække tekst fra allonge:", a.title, e)
            continue
        }
        if (!text.trim()) continue

        combined += `\n\n──────────────────────────────────────\nALLONGE: ${a.title ?? "Uden titel"} (uploadet ${a.created_at?.substring(0, 10) ?? ""})\n──────────────────────────────────────\n${text}`
    }
    return combined
}

export const ALLONGE_PROMPT_NOTE = `Kontraktteksten kan indeholde et eller flere "ALLONGE"-afsnit efter selve kontrakten — disse er senere tillæg/forlængelser til den oprindelige kontrakt. Hvis en allonge ændrer en værdi fra kontrakten (fx forlænget slutdato, flere arbejdsuger, ændret løn eller tillæg), skal allongens værdi bruges frem for kontraktens oprindelige værdi. Nævn kort i specialNotes hvilke felter der er ændret af en allonge.`
