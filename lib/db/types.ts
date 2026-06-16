// ── Database types matching Supabase schema ──────────────────
// These mirror the SQL tables 1:1. Use these for DB operations.
// App-level types remain in lib/types.ts.

export interface DbOrganisation {
    id: string
    name: string
    logo_url: string | null
    features: string[]
    created_at: string
}

export interface DbUserOrgRole {
    id: string
    user_id: string
    org_id: string
    role: string
    created_at: string
}

export interface DbRettighedshaver {
    id: string
    user_id: string | null
    full_name: string
    email: string | null
    phone: string | null
    address: string | null
    cpr_no: string | null
    bank_account: string | null
    onboarding_completed: boolean
    dfi_person_id: number | null
    opt_out_statistics: boolean
    created_at: string
}

export interface DbOrgAffiliation {
    id: string
    org_id: string
    rights_holder_id: string
    is_member: boolean
    member_no: string | null
    valid_from: string | null
    valid_to: string | null
    created_at: string
}

export interface DbEmployer {
    id: string
    name: string
    parent_id: string | null
    dfi_company_id: number | null
    cvr: string | null
    address: string | null
    contact_name: string | null
    contact_email: string | null
    contact_phone: string | null
    created_at: string
}

export interface DbEmployerRegistry {
    id: string
    employer_id: string
    association_name: string
    valid_from: string | null
    valid_to: string | null
    created_at: string
}

export interface DbContract {
    id: string
    org_id: string
    employer_id: string | null
    work_id: string | null
    rights_holder_id: string | null
    type: string
    overenskomst: string | null
    status: string
    pdf_url: string | null
    working_title: string | null
    contract_date: string | null
    start_date: string | null
    end_date: string | null
    created_by: string | null
    created_at: string
}

export interface DbContractAttachment {
    id: string
    contract_id: string
    org_id: string
    type: string
    title: string | null
    pdf_url: string | null
    created_by: string | null
    created_at: string
}

export interface DbContractValidation {
    id: string
    contract_id: string
    org_id: string
    holiday_pay_rate: number | null
    beta_rate: number | null
    has_credit_clause: boolean | null
    has_termination_clause: boolean | null
    termination_days_editor: number | null
    termination_days_producer: number | null
    has_indemnification: boolean | null
    has_overenskomst_incorporation: boolean | null
    notes: string | null
    extracted_data: Record<string, unknown> | null
    validated_by: string | null
    validated_at: string | null
    created_at: string
}

export interface DbContractReview {
    id: string
    contract_id: string | null
    org_id: string
    member_name: string | null
    member_email: string | null
    ai_result: Record<string, unknown>
    reviewed_by: string | null
    reviewed_at: string
    // Indbakke-felter (tilføjet 2026-06-12)
    member_id: string | null
    file_name: string | null
    file_size_bytes: number | null
    contract_type: string | null
    production_type: string | null
    distribution_channels: string[] | null
    producer_name: string | null
    producer_dfks_id: string | null
    producer_dfi_id: string | null
    producer_overenskomst_bound: boolean | null
    focus_areas: string[] | null
    notes: string | null
    status: string
    assigned_to: string | null
    storage_path: string | null
    ai_run_at: string | null
    ai_language: string | null
    updated_at: string | null
    compliance_extract: Record<string, unknown> | null
}

export interface DbAgreement {
    id: string
    org_id: string | null
    title: string
    doc_type: string
    content_url: string | null
    is_primary: boolean
    valid_from: string | null
    valid_to: string | null
    created_at: string
}

export interface DbReferenceDoc {
    id: string
    org_id: string | null
    title: string
    url: string | null
    doc_type: string
    doc_subtype: string | null
    owner: string
    content_text: string | null
    file_name: string | null
    archived: boolean
    created_at: string
}

export interface DbLegalNote {
    id: string
    org_id: string | null
    scope: string[]
    title: string
    body: string
    priority: string
    active: boolean
    exclude_for_overenskomst: string[]
    sort_order: number
    created_at: string
}

export interface DbLegalNoteHistory {
    id: string
    note_id: string
    changed_by: string | null
    org_id: string | null
    old_value: Record<string, unknown>
    changed_at: string
}

export interface DbCaseLearning {
    id: string
    org_id: string | null
    kontrakttype: string
    titel: string
    regel: string
    added_at: string
    created_at: string
}

export interface DbWork {
    id: string
    org_id: string
    employer_id: string | null
    title: string
    type: string
    year: number | null
    duration_minutes: number | null
    episode_count: number | null
    genre: string | null
    status: string
    dfi_id: string | null
    tmdb_id: number | null
    description: string | null
    poster_url: string | null
    created_at: string
}

export interface DbWorkProductionNumber {
    id: string
    work_id: string
    tv_station: string
    number: string
    created_at: string
}

export interface DbEpisode {
    id: string
    work_id: string
    episode_number: number
    title: string | null
    duration_minutes: number | null
    produktionsnr: string | null
    created_at: string
}

export interface DbWorkAssignment {
    id: string
    work_id: string
    episode_id: string | null
    org_id: string
    rights_holder_id: string | null
    role: string
    contract_id: string | null
    created_at: string
}
