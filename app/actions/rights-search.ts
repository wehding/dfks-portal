"use server"

import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { revalidatePath } from "next/cache"
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit"

const ADMIN_ORG_ROLES = ["superadmin", "admin", "org-admin"] as const

// ── Typer ────────────────────────────────────────────────────────────────────

export type SearchPublicationStatus =
    | "draft" | "published" | "responded" | "closed"

export type SearchPublication = {
    id: string
    org_id: string
    fund_id: string | null
    run_id: string | null
    work_allocation_id: string | null
    withheld_position_id: string | null
    // Hvem søges
    known_name: string | null
    known_alias: string | null
    known_work_titles: string[] | null
    known_period_from: string | null
    known_period_to: string | null
    description: string
    // Beløb
    withheld_amount: number | null
    currency: string
    claim_deadline: string | null
    // Publicering
    status: SearchPublicationStatus
    published_at: string | null
    closed_at: string | null
    response_received_at: string | null
    response_notes: string | null
    // Metadata
    created_by: string | null
    created_at: string
    updated_at: string
    // Joins
    fund_name?: string
    period_label?: string
}

export type InheritanceRelation = {
    id: string
    org_id: string
    rights_holder_id: string
    heir_name: string
    heir_cpr_encrypted: string | null   // krypteret — vises aldrig i UI
    heir_relation: string               // "ægtefælle", "barn", "juridisk arving" osv.
    heir_address: string | null
    heir_contact_email: string | null
    heir_contact_phone: string | null
    verified_at: string | null
    verified_by: string | null
    valid_from: string
    valid_to: string | null
    notes: string | null
    created_at: string
    // Joins
    rights_holder_name?: string
    member_number?: string | null
}

// ── Efterlysninger: hent ─────────────────────────────────────────────────────

export async function getSearchPublications(status?: SearchPublicationStatus): Promise<{
    success: boolean
    publications: SearchPublication[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        let q = db
            .from("rights_holder_search_publications")
            .select(`
                *,
                rights_funds ( name ),
                rights_calculation_runs ( period_label )
            `)
            .eq("org_id", caller.orgId)
            .order("created_at", { ascending: false })

        if (status) q = q.eq("status", status)

        const { data, error } = await q
        if (error) throw error

        const publications: SearchPublication[] = (data ?? []).map((r) => ({
            ...r,
            withheld_amount: r.withheld_amount != null ? Number(r.withheld_amount) : null,
            fund_name: r.rights_funds?.name,
            period_label: r.rights_calculation_runs?.period_label,
        }))

        await recordSensitiveFlow({
            actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" },
            action: "search", component: "admin.rights_holder_search_publications", entityType: "rights_holder_search_publication",
            purposeCode: "rights_holder_identification", legalBasis: "gdpr_art_6_1_f",
            dataCategories: ["rights_data", "identity_data"], counts: { results: publications.length, filtered: Boolean(status) },
        })

        return { success: true, publications }
    } catch (err) {
        console.error("[rights-search] getSearchPublications fejlede:", err)
        return { success: false, publications: [], error: String(err) }
    }
}

// ── Efterlysninger: opret ────────────────────────────────────────────────────

export async function createSearchPublication(payload: {
    fund_id?: string | null
    run_id?: string | null
    work_allocation_id?: string | null
    withheld_position_id?: string | null
    known_name?: string | null
    known_alias?: string | null
    known_work_titles?: string[] | null
    known_period_from?: string | null
    known_period_to?: string | null
    description: string
    withheld_amount?: number | null
    currency?: string
    claim_deadline?: string | null
}): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { data, error } = await db
            .from("rights_holder_search_publications")
            .insert({
                org_id: caller.orgId,
                fund_id: payload.fund_id ?? null,
                run_id: payload.run_id ?? null,
                work_allocation_id: payload.work_allocation_id ?? null,
                withheld_position_id: payload.withheld_position_id ?? null,
                known_name: payload.known_name ?? null,
                known_alias: payload.known_alias ?? null,
                known_work_titles: payload.known_work_titles ?? null,
                known_period_from: payload.known_period_from ?? null,
                known_period_to: payload.known_period_to ?? null,
                description: payload.description,
                withheld_amount: payload.withheld_amount ?? null,
                currency: payload.currency ?? "DKK",
                claim_deadline: payload.claim_deadline ?? null,
                status: "draft",
                created_by: caller.userId,
            })
            .select("id")
            .single()

        if (error) throw error

        revalidatePath("/admin/rettighedsmidler/efterlysninger")
        return { success: true, id: data.id }
    } catch (err) {
        console.error("[rights-search] createSearchPublication fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Efterlysninger: skift status ─────────────────────────────────────────────

export async function updateSearchPublicationStatus(
    id: string,
    status: SearchPublicationStatus,
    opts?: { response_notes?: string }
): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
        if (status === "published") patch.published_at = new Date().toISOString()
        if (status === "responded") {
            patch.response_received_at = new Date().toISOString()
            if (opts?.response_notes) patch.response_notes = opts.response_notes
        }
        if (status === "closed") patch.closed_at = new Date().toISOString()

        const { error } = await db
            .from("rights_holder_search_publications")
            .update(patch)
            .eq("id", id)
            .eq("org_id", caller.orgId)

        if (error) throw error

        revalidatePath("/admin/rettighedsmidler/efterlysninger")
        return { success: true }
    } catch (err) {
        console.error("[rights-search] updateSearchPublicationStatus fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Arvingeprofiler: hent ────────────────────────────────────────────────────

export async function getInheritanceRelations(rights_holder_id?: string): Promise<{
    success: boolean
    relations: InheritanceRelation[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        let q = db
            .from("inheritance_relations")
            .select(`*, rettighedshavere ( full_name, member_number )`)
            .eq("org_id", caller.orgId)
            .order("created_at", { ascending: false })

        if (rights_holder_id) q = q.eq("rights_holder_id", rights_holder_id)

        const { data, error } = await q
        if (error) throw error

        // Returner aldrig krypteret CPR til klienten
        const relations: InheritanceRelation[] = (data ?? []).map((r) => ({
            ...r,
            heir_cpr_encrypted: null,   // bevidst udeladt
            rights_holder_name: r.rettighedshavere?.full_name,
            member_number: r.rettighedshavere?.member_number,
        }))

        return { success: true, relations }
    } catch (err) {
        console.error("[rights-search] getInheritanceRelations fejlede:", err)
        return { success: false, relations: [], error: String(err) }
    }
}

// ── Arvingeprofiler: opret ───────────────────────────────────────────────────

export async function createInheritanceRelation(payload: {
    rights_holder_id: string
    heir_name: string
    heir_relation: string
    heir_address?: string | null
    heir_contact_email?: string | null
    heir_contact_phone?: string | null
    valid_from: string
    valid_to?: string | null
    notes?: string | null
}): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { error } = await db
            .from("inheritance_relations")
            .insert({
                org_id: caller.orgId,
                rights_holder_id: payload.rights_holder_id,
                heir_name: payload.heir_name,
                heir_relation: payload.heir_relation,
                heir_address: payload.heir_address ?? null,
                heir_contact_email: payload.heir_contact_email ?? null,
                heir_contact_phone: payload.heir_contact_phone ?? null,
                valid_from: payload.valid_from,
                valid_to: payload.valid_to ?? null,
                notes: payload.notes ?? null,
            })

        if (error) throw error

        revalidatePath("/admin/rettighedsmidler/efterlysninger")
        return { success: true }
    } catch (err) {
        console.error("[rights-search] createInheritanceRelation fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Arvingeprofiler: verificér ───────────────────────────────────────────────

export async function verifyInheritanceRelation(id: string): Promise<{
    success: boolean
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { error } = await db
            .from("inheritance_relations")
            .update({
                verified_at: new Date().toISOString(),
                verified_by: caller.userId,
            })
            .eq("id", id)
            .eq("org_id", caller.orgId)

        if (error) throw error

        revalidatePath("/admin/rettighedsmidler/efterlysninger")
        return { success: true }
    } catch (err) {
        console.error("[rights-search] verifyInheritanceRelation fejlede:", err)
        return { success: false, error: String(err) }
    }
}
