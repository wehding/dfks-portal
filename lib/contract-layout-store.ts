import "server-only"

import { createClient } from "@/lib/supabase/server"
import { extractPdfTextWithLayout } from "@/lib/pdf-parse"
import { extractWordTextWithLayout } from "@/lib/word-text"
import { buildPdfLayout, buildDocxLayout } from "@/lib/contract-layout"
import type { ContractLayout } from "@/lib/contract-layout"

/**
 * Henter layout_data for en kontrakt — bygger og gemmer det hvis det ikke findes endnu.
 * Returnerer null hvis kontrakten ikke har en fil, eller filen ikke kan parses.
 */
export async function getOrBuildContractLayout(
    contractId: string,
    pdfUrl: string,
): Promise<ContractLayout | null> {
    const supabase = await createClient()

    // Tjek om layout allerede er gemt
    const { data: existing } = await supabase
        .from("contracts")
        .select("layout_data")
        .eq("id", contractId)
        .single()

    if (existing?.layout_data) {
        return existing.layout_data as ContractLayout
    }

    // Download fil
    let buffer: Buffer
    let ext: string
    try {
        if (pdfUrl.startsWith("http")) {
            const res = await fetch(pdfUrl)
            if (!res.ok) return null
            buffer = Buffer.from(await res.arrayBuffer())
            ext = pdfUrl.split("?")[0].split(".").pop()?.toLowerCase() ?? "pdf"
        } else {
            const { data, error } = await supabase.storage.from("kontrakter").download(pdfUrl)
            if (error || !data) return null
            buffer = Buffer.from(await data.arrayBuffer())
            ext = pdfUrl.split(".").pop()?.toLowerCase() ?? "pdf"
        }
    } catch {
        return null
    }

    // Byg layout
    let layout: ContractLayout | null = null
    try {
        if (ext === "pdf") {
            const fragments = await extractPdfTextWithLayout(buffer)
            layout = buildPdfLayout(fragments)
        } else if (ext === "docx" || ext === "doc") {
            const docxLayout = await extractWordTextWithLayout(buffer, pdfUrl)
            layout = buildDocxLayout(docxLayout)
        }
    } catch {
        return null
    }

    if (!layout) return null

    // Gem til DB (best-effort — fejl stopper ikke valideringsflowet)
    await supabase
        .from("contracts")
        .update({ layout_data: layout })
        .eq("id", contractId)

    return layout
}

/**
 * Slår et klausul-ID op i et layout og returnerer klausulen — eller null hvis ID er ukendt.
 * Mekanisk sikkerhedsnet: AI-returnerede IDs valideres altid mod den kendte liste.
 */
export function resolveClauseById(
    layout: ContractLayout | null | undefined,
    clauseId: string | null | undefined,
): import("@/lib/contract-layout").LayoutClause | null {
    if (!layout || !clauseId) return null
    return layout.clauses.find(c => c.id === clauseId) ?? null
}
