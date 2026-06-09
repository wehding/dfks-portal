import { createClient } from "@/lib/supabase/client"
import type { DbAgreement, DbReferenceDoc, DbLegalNote, DbLegalNoteHistory, DbCaseLearning } from "./types"

// ── Overenskomster ────────────────────────────────────────────

export async function getAgreements(orgId?: string): Promise<DbAgreement[]> {
    const supabase = createClient()
    let query = supabase
        .from("agreements")
        .select("*")
        .order("valid_from", { ascending: false })

    // Hent fælles (org_id = null) + org-specifikke
    if (orgId) {
        query = query.or(`org_id.is.null,org_id.eq.${orgId}`)
    } else {
        query = query.is("org_id", null)
    }

    const { data } = await query
    return data ?? []
}

export async function saveAgreement(
    input: Pick<DbAgreement, "org_id" | "title" | "doc_type" | "content_url" | "is_primary" | "valid_from" | "valid_to">
): Promise<DbAgreement | null> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from("agreements")
        .insert(input)
        .select()
        .single()

    if (error) return null
    return data
}

export async function updateAgreement(
    id: string,
    input: Partial<Pick<DbAgreement, "title" | "doc_type" | "content_url" | "is_primary" | "valid_from" | "valid_to">>
): Promise<void> {
    const supabase = createClient()
    await supabase.from("agreements").update(input).eq("id", id)
}

// ── Referencedokumenter ───────────────────────────────────────

export async function getReferenceDocs(orgId?: string): Promise<DbReferenceDoc[]> {
    const supabase = createClient()
    let query = supabase.from("reference_docs").select("*").order("title")

    if (orgId) {
        query = query.or(`org_id.is.null,org_id.eq.${orgId}`)
    } else {
        query = query.is("org_id", null)
    }

    const { data } = await query
    return data ?? []
}

export async function saveReferenceDoc(
    input: Pick<DbReferenceDoc, "org_id" | "title" | "url" | "doc_type" | "doc_subtype" | "owner" | "content_text" | "file_name">
): Promise<DbReferenceDoc | null> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from("reference_docs")
        .insert(input)
        .select()
        .single()

    if (error) { console.error("[saveReferenceDoc]", error); return null }
    return data
}

export async function updateReferenceDoc(
    id: string,
    input: Partial<Pick<DbReferenceDoc, "title" | "doc_subtype" | "owner" | "archived">>
): Promise<void> {
    const supabase = createClient()
    await supabase.from("reference_docs").update(input).eq("id", id)
}

export async function deleteReferenceDoc(id: string): Promise<void> {
    const supabase = createClient()
    await supabase.from("reference_docs").delete().eq("id", id)
}

// ── Juridiske noter ───────────────────────────────────────────

export async function getLegalNotes(orgId?: string): Promise<DbLegalNote[]> {
    const supabase = createClient()
    let query = supabase
        .from("legal_notes")
        .select("*")
        .eq("active", true)
        .order("sort_order")

    if (orgId) {
        query = query.or(`org_id.is.null,org_id.eq.${orgId}`)
    } else {
        query = query.is("org_id", null)
    }

    const { data } = await query
    return data ?? []
}

export async function saveLegalNote(
    input: Pick<DbLegalNote, "org_id" | "scope" | "title" | "body" | "priority" | "active" | "exclude_for_overenskomst" | "sort_order">
): Promise<DbLegalNote | null> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from("legal_notes")
        .insert(input)
        .select()
        .single()

    if (error) return null
    return data
}

export async function updateLegalNote(
    id: string,
    input: Partial<Pick<DbLegalNote, "title" | "body" | "priority" | "active" | "scope" | "exclude_for_overenskomst" | "sort_order">>
): Promise<void> {
    const supabase = createClient()

    // Gem historik inden opdatering
    const { data: existing } = await supabase
        .from("legal_notes")
        .select("*")
        .eq("id", id)
        .single()

    if (existing) {
        const { data: { user } } = await supabase.auth.getUser()
        await supabase.from("legal_note_history").insert({
            note_id: id,
            changed_by: user?.id ?? null,
            org_id: existing.org_id,
            old_value: existing,
        })
    }

    const { error } = await supabase.from("legal_notes").update(input).eq("id", id)
    if (error) console.error("[updateLegalNote]", error)
}

export async function deleteLegalNote(id: string): Promise<void> {
    const supabase = createClient()
    await supabase.from("legal_notes").delete().eq("id", id)
}

export async function getLegalNoteHistory(noteId: string): Promise<DbLegalNoteHistory[]> {
    const supabase = createClient()
    const { data } = await supabase
        .from("legal_note_history")
        .select("*")
        .eq("note_id", noteId)
        .order("changed_at", { ascending: false })

    return data ?? []
}

// ── Sagserfaringer ─────────────────────────────────────────

export async function getCaseLearnings(orgId?: string): Promise<DbCaseLearning[]> {
    const supabase = createClient()
    let query = supabase
        .from("case_learnings")
        .select("*")
        .order("added_at", { ascending: false })

    if (orgId) {
        query = query.or(`org_id.is.null,org_id.eq.${orgId}`)
    } else {
        query = query.is("org_id", null)
    }

    const { data } = await query
    return data ?? []
}

export async function saveCaseLearning(
    input: Pick<DbCaseLearning, "org_id" | "kontrakttype" | "titel" | "regel" | "added_at">
): Promise<DbCaseLearning | null> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from("case_learnings")
        .insert(input)
        .select()
        .single()

    if (error) { console.error("[saveCaseLearning]", error); return null }
    return data
}

export async function updateCaseLearning(
    id: string,
    input: Partial<Pick<DbCaseLearning, "kontrakttype" | "titel" | "regel">>
): Promise<void> {
    const supabase = createClient()
    await supabase.from("case_learnings").update(input).eq("id", id)
}

export async function deleteCaseLearning(id: string): Promise<void> {
    const supabase = createClient()
    await supabase.from("case_learnings").delete().eq("id", id)
}
