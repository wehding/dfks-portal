/**
 * lib/compliance-types.ts
 *
 * Output-skema for trin 2 (compliance-udtræk) i tre-trins analyse-flowet.
 * Indeholder KUN strukturerede data — ingen prosa.
 */

export interface RequiredClause {
    clause_id: string
    exact_text_da: string
    exact_text_en?: string
    source: "altid" | "baggrund"
    requires_gul: boolean
    position_hint?: string
}

export interface FlaggedIssue {
    issue_id: string
    internal_note: string
    severity: "LAV" | "MELLEM" | "HØJ"
    requires_gul: boolean
}

export interface LoanCalculation {
    amount: number
    basis: string
}

export interface ComplianceExtract {
    risk_level: "LAV" | "MELLEM" | "HØJ"
    should_escalate: boolean
    required_clauses: RequiredClause[]
    flagged_issues: FlaggedIssue[]
    royalty_rate?: 1.0 | 1.5
    loan_calculation?: LoanCalculation
    non_covered_pedagogical: boolean
    overenskomst_navn: string | null
    contract_language: "da" | "en" | "other"
}
