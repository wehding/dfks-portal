"use server"

import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { revalidatePath } from "next/cache"

const ADMIN_ORG_ROLES = ["superadmin", "admin", "org-admin"] as const

// ── Typer ────────────────────────────────────────────────────────────────────

export type ReserveEntryType =
    | "claim_reserve"
    | "sku_reserve"
    | "statutory_collective"
    | "undistributable_transfer"
    | "release"

export type ReserveEntry = {
    id: string
    org_id: string
    fund_id: string
    run_id: string | null
    work_allocation_id: string | null
    entry_type: ReserveEntryType
    amount: number              // øre
    currency: string
    reference_date: string
    claim_deadline: string | null
    eligible_for_undistributable_at: string | null
    notes: string | null
    created_at: string
    // Joins
    fund_name?: string
    period_label?: string
}

export type ClaimStatus = "submitted" | "under_review" | "approved" | "rejected" | "paid_out"

export type RightsClaim = {
    id: string
    org_id: string
    fund_id: string
    run_id: string | null
    work_allocation_id: string | null
    rights_holder_id: string
    submitted_at: string
    claim_amount: number        // øre
    currency: string
    is_timely: boolean
    blocks_undistributable: boolean
    status: ClaimStatus
    reviewed_by: string | null
    reviewed_at: string | null
    review_notes: string | null
    paid_out_at: string | null
    notes: string | null
    created_at: string
    // Joins
    rights_holder_name?: string
    member_number?: string | null
    fund_name?: string
    period_label?: string
}

export type UndistributableAction = {
    id: string
    org_id: string
    fund_id: string
    run_id: string
    action_type: "transfer_to_collective" | "return_to_pool" | "hold"
    amount: number
    currency: string
    actioned_at: string
    actioned_by: string | null
    notes: string | null
    created_at: string
    fund_name?: string
    period_label?: string
}

// ── Hensættelsesposter: hent for run ─────────────────────────────────────────

export async function getReserveEntries(run_id: string): Promise<{
    success: boolean
    entries: ReserveEntry[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { data, error } = await db
            .from("reserve_entries")
            .select(`
                *,
                rights_funds ( name ),
                rights_calculation_runs ( period_label )
            `)
            .eq("run_id", run_id)
            .eq("org_id", caller.orgId)
            .order("reference_date", { ascending: false })

        if (error) throw error

        const entries: ReserveEntry[] = (data ?? []).map((r: any) => ({
            ...r,
            amount: Number(r.amount),
            fund_name: r.rights_funds?.name,
            period_label: r.rights_calculation_runs?.period_label,
        }))

        return { success: true, entries }
    } catch (err) {
        console.error("[rights-reserves] getReserveEntries fejlede:", err)
        return { success: false, entries: [], error: String(err) }
    }
}

// ── Hensættelsesposter: opret ─────────────────────────────────────────────────

export async function createReserveEntry(payload: {
    fund_id: string
    run_id: string
    work_allocation_id?: string | null
    entry_type: ReserveEntryType
    amount: number
    currency: string
    reference_date: string
    claim_deadline?: string | null
    eligible_for_undistributable_at?: string | null
    notes?: string | null
}): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { error } = await db
            .from("reserve_entries")
            .insert({ ...payload, org_id: caller.orgId })

        if (error) throw error

        revalidatePath("/admin/rettighedsmidler")
        return { success: true }
    } catch (err) {
        console.error("[rights-reserves] createReserveEntry fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Krav: hent for fund (på tværs af runder) ─────────────────────────────────

export async function getRightsClaims(fund_id?: string, run_id?: string): Promise<{
    success: boolean
    claims: RightsClaim[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        let q = db
            .from("rights_claims")
            .select(`
                *,
                rettighedshavere ( full_name, member_number ),
                rights_funds ( name ),
                rights_calculation_runs ( period_label )
            `)
            .eq("org_id", caller.orgId)
            .order("submitted_at", { ascending: false })

        if (fund_id) q = q.eq("fund_id", fund_id)
        if (run_id) q = q.eq("run_id", run_id)

        const { data, error } = await q
        if (error) throw error

        const claims: RightsClaim[] = (data ?? []).map((r: any) => ({
            ...r,
            claim_amount: Number(r.claim_amount),
            rights_holder_name: r.rettighedshavere?.full_name,
            member_number: r.rettighedshavere?.member_number,
            fund_name: r.rights_funds?.name,
            period_label: r.rights_calculation_runs?.period_label,
        }))

        return { success: true, claims }
    } catch (err) {
        console.error("[rights-reserves] getRightsClaims fejlede:", err)
        return { success: false, claims: [], error: String(err) }
    }
}

// ── Krav: opret ──────────────────────────────────────────────────────────────

export async function createRightsClaim(payload: {
    fund_id: string
    run_id?: string | null
    work_allocation_id?: string | null
    rights_holder_id: string
    claim_amount: number
    currency: string
    notes?: string | null
}): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { error } = await db
            .from("rights_claims")
            .insert({
                org_id: caller.orgId,
                fund_id: payload.fund_id,
                run_id: payload.run_id ?? null,
                work_allocation_id: payload.work_allocation_id ?? null,
                rights_holder_id: payload.rights_holder_id,
                submitted_at: new Date().toISOString(),
                claim_amount: payload.claim_amount,
                currency: payload.currency,
                status: "submitted",
                notes: payload.notes ?? null,
            })

        if (error) throw error

        revalidatePath("/admin/rettighedsmidler")
        return { success: true }
    } catch (err) {
        console.error("[rights-reserves] createRightsClaim fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Krav: sagsbehandl ─────────────────────────────────────────────────────────

export async function reviewRightsClaim(
    id: string,
    decision: "approved" | "rejected",
    review_notes: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { error } = await db
            .from("rights_claims")
            .update({
                status: decision,
                reviewed_by: caller.userId,
                reviewed_at: new Date().toISOString(),
                review_notes,
            })
            .eq("id", id)
            .eq("org_id", caller.orgId)

        if (error) throw error

        revalidatePath("/admin/rettighedsmidler")
        return { success: true }
    } catch (err) {
        console.error("[rights-reserves] reviewRightsClaim fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Udistribuerede: registrér handling ───────────────────────────────────────

export async function createUndistributableAction(payload: {
    fund_id: string
    run_id: string
    action_type: "transfer_to_collective" | "return_to_pool" | "hold"
    amount: number
    currency: string
    notes?: string | null
}): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { error } = await db
            .from("undistributable_fund_actions")
            .insert({
                org_id: caller.orgId,
                fund_id: payload.fund_id,
                run_id: payload.run_id,
                action_type: payload.action_type,
                amount: payload.amount,
                currency: payload.currency,
                actioned_at: new Date().toISOString(),
                actioned_by: caller.userId,
                notes: payload.notes ?? null,
            })

        if (error) throw error

        revalidatePath("/admin/rettighedsmidler")
        return { success: true }
    } catch (err) {
        console.error("[rights-reserves] createUndistributableAction fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Udistribuerede: hent for run ─────────────────────────────────────────────

export async function getUndistributableActions(run_id: string): Promise<{
    success: boolean
    actions: UndistributableAction[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { data, error } = await db
            .from("undistributable_fund_actions")
            .select(`*, rights_funds ( name ), rights_calculation_runs ( period_label )`)
            .eq("run_id", run_id)
            .eq("org_id", caller.orgId)
            .order("actioned_at", { ascending: false })

        if (error) throw error

        const actions: UndistributableAction[] = (data ?? []).map((r: any) => ({
            ...r,
            amount: Number(r.amount),
            fund_name: r.rights_funds?.name,
            period_label: r.rights_calculation_runs?.period_label,
        }))

        return { success: true, actions }
    } catch (err) {
        console.error("[rights-reserves] getUndistributableActions fejlede:", err)
        return { success: false, actions: [], error: String(err) }
    }
}
