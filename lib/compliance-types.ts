/**
 * lib/compliance-types.ts
 *
 * Output-skema for trin 2 (compliance-udtræk) i tre-trins analyse-flowet.
 * Indeholder KUN strukturerede data — ingen prosa.
 */

export interface CompliancePoint {
    point_id: string

    title: string
    // Kort overskrift til struktur i mailen, f.eks. "Pension mangler"

    argument_basis: string
    // INTERNT: juridisk/faktamæssigt grundlag for HVORFOR dette er et problem.
    // Bruges af trin 3 til at skrive argumentationen frit.
    // Må ALDRIG optræde ordret i member-rettet tekst.

    proposed_text_da?: string
    // Konkret forslag til kontraktsprog på dansk.
    // Skal forblive ORDRET i den genererede mail — ingen parafrasering.

    proposed_text_en?: string
    // Engelsk version til engelsksprogede kontrakter.

    source?: "altid" | "baggrund"
    // "altid" = standardklausul der altid kræves
    // "baggrund" = kun relevant i denne specifikke kontekst

    requires_producer_text: boolean
    // true: punktet skal udmønte sig i én sammenhængende GUL-markeret
    // argumentation+klausul-blok rettet mod producenten.
    // false: kun member_only_note, ingen GUL-blok.

    member_only_note?: string
    // Valgfri besked KUN til medlemmet — altid uden for GUL.
    // Bruges f.eks. til "tag dette op med sekretariatet" eller intern vejledning.

    severity: "LAV" | "MELLEM" | "HØJ"
    // KUN til intern/admin brug — må ALDRIG lække til member-rettet tekst.
}

export interface LoanCalculation {
    amount: number
    basis: string
}

export interface ComplianceExtract {
    risk_level: "LAV" | "MELLEM" | "HØJ"
    // KUN internt/admin — vises aldrig til член.

    should_escalate: boolean

    non_covered_pedagogical: boolean
    // true hvis producenten IKKE er ProF-medlem/overenskomstdækket.
    // Ét felt — konsistens på tværs af hele mailen.

    overenskomst_navn: string | null
    contract_language: "da" | "en" | "other"

    royalty_rate?: 1.0 | 1.5

    loan_calculation?: LoanCalculation

    points: CompliancePoint[]
}
