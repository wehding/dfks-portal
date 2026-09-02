import "server-only"

import { createClient } from "@/lib/supabase/server"
import { extractPdfTextWithLayout } from "@/lib/pdf-parse"
import { extractWordTextWithLayout } from "@/lib/word-text"
import { buildPdfLayout, buildDocxLayout } from "@/lib/contract-layout"
import type { ContractLayout } from "@/lib/contract-layout"
import { matchCitationToClause } from "@/lib/contract-clause-match"
import { discardIfNoDigits, discardIfNoDkkAmount, discardIfBareNumber } from "@/lib/ai-sources"

export { matchCitationToClause } from "@/lib/contract-clause-match"

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

/**
 * Server-side korrelation: find den klausul der matcher et tekst-citat.
 *
 * Bruger norm() fra resolveAnker.ts — samme normalisering som PDF-highlighting,
 * så de to systemer aldrig kan give modstridende svar på samme kontrakttekst.
 *
 * Entydighed er et krav: hvis citatet forekommer i mere end én klausul returneres
 * null — intet highlight er bedre end et forkert.
 *
 * @param citation  Renset tekst-citat fra AI (EFTER discardIf*-filtre)
 * @param layout    Layout med klausuler og bounding boxes
 * @param minLength Minimum normalised needle-length (default 10)
 */
/**
 * Tilføj klausul-IDs til et _sources-objekt ved at korrelere tekst-citater mod layout.
 *
 * Sikkerhedsnet køres FØR matching: et tomt/bare-tal-citat kan give false positive
 * mod en klausul der tilfældigvis indeholder samme mønster — filtrér det væk først.
 * Felter der allerede har et (AI-returneret og valideret) klausul-ID røres ikke.
 */
export function enrichSourcesWithClauseIds(
    sources: Record<string, string | null>,
    layout: ContractLayout | null | undefined,
): Record<string, string | null> {
    if (!layout) return sources

    const match = (citation: string | null | undefined) =>
        matchCitationToClause(citation, layout)

    return {
        ...sources,
        // Løn: kræver cifre (discardIfNoDigits) + ikke bare et tal (discardIfBareNumber)
        salary_clause_id: sources.salary_clause_id ??
            match(discardIfBareNumber(discardIfNoDigits(sources.salary))),
        // Pension + tillæg: kræver konkret DKK-beløb — fanger ubrugte skabelon-klausuler
        pension_clause_id: sources.pension_clause_id ??
            match(discardIfNoDkkAmount(sources.pension)),
        supplements_clause_id: sources.supplements_clause_id ??
            match(discardIfNoDkkAmount(sources.supplements)),
        // Tekstuelle felter: ingen beløbsfilter, men discardIfBareNumber fjerner løse tal
        workTitle_clause_id: sources.workTitle_clause_id ??
            match(sources.workTitle),
        otherSupplements_clause_id: sources.otherSupplements_clause_id ??
            match(discardIfBareNumber(sources.otherSupplements)),
        workingWeeks_clause_id: sources.workingWeeks_clause_id ??
            match(discardIfBareNumber(sources.workingWeeks)),
        collectiveAgreement_clause_id: sources.collectiveAgreement_clause_id ??
            match(sources.collectiveAgreement),
        // Øvrige: renset af normaliseSources før dette kald — send direkte
        dates_clause_id: sources.dates_clause_id ??
            match(discardIfBareNumber(sources.dates)),
        copydan_clause_id: sources.copydan_clause_id ??
            match(discardIfBareNumber(sources.copydan)),
        svod_clause_id: sources.svod_clause_id ??
            match(discardIfBareNumber(sources.svod)),
        royalty_clause_id: sources.royalty_clause_id ??
            match(discardIfBareNumber(sources.royalty)),
        prolongation_clause_id: sources.prolongation_clause_id ??
            match(discardIfBareNumber(sources.prolongation)),
        creditedRoles_clause_id: sources.creditedRoles_clause_id ??
            match(discardIfBareNumber(sources.creditedRoles)),
    }
}
