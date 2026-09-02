"use server"

import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { revalidatePath } from "next/cache"
import { firstRelated } from "@/lib/supabase/relations"
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit"

const ADMIN_ORG_ROLES = ["superadmin", "admin", "org-admin"] as const

// ── Typer ────────────────────────────────────────────────────────────────────

export type SettlementStatus = "draft" | "prepared" | "approved" | "paid_out" | "cancelled"

export type Settlement = {
    id: string
    org_id: string
    fund_id: string
    label: string
    status: SettlementStatus
    total_gross: number
    total_individual: number
    total_below_threshold: number
    total_payable: number
    currency: string
    payout_threshold_minor: number
    prepared_by: string | null
    approved_by: string | null
    paid_out_at: string | null
    notes: string | null
    created_at: string
    updated_at: string
    // Joins
    fund_name?: string
    item_count?: number
}

export type SettlementItem = {
    id: string
    org_id: string
    settlement_id: string
    allocation_id: string
    rights_holder_id: string
    individual_net: number
    adjustment_total: number
    payable_amount: number
    below_threshold: boolean
    blocked_reason: string | null
    currency: string
    // Joins
    rights_holder_name?: string
    member_number?: string | null
    work_title?: string | null
    episode_title?: string | null
    run_label?: string
}

export type PayoutStatus = "pending" | "processing" | "completed" | "failed"

export type Payout = {
    id: string
    org_id: string
    settlement_id: string
    rights_holder_id: string
    gross_amount: number
    net_amount: number
    currency: string
    status: PayoutStatus
    payroll_batch_id: string | null
    nem_konto_ref: string | null
    processed_at: string | null
    failed_reason: string | null
    created_at: string
    // Joins
    rights_holder_name?: string
    member_number?: string | null
}

export type PayrollRecipientReference = {
    id: string
    org_id: string
    rights_holder_id: string
    system: string              // "datalon", "zenegy" osv.
    recipient_id: string        // ekstern ID i lønsystemet
    active: boolean
    created_at: string
    // Joins
    rights_holder_name?: string
}

export type PayrollExportBatch = {
    id: string
    org_id: string
    settlement_id: string
    export_system: string
    exported_at: string
    exported_by: string | null
    row_count: number
    file_reference: string | null
    status: "pending" | "exported" | "error"
    created_at: string
    // Joins
    settlement_label?: string
}

// ── Tærskel: hent fra org ────────────────────────────────────────────────────

export async function getOrgPayoutThreshold(): Promise<{
    success: boolean
    threshold_minor: number
    currency: string
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { data, error } = await db
            .from("organisations")
            .select("payout_threshold_minor, base_currency")
            .eq("id", caller.orgId)
            .single()

        if (error) throw error

        await recordSensitiveFlow({
            actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" },
            action: "read", component: "admin.rights_settlement_settings", entityType: "organisation", entityId: caller.orgId,
            purposeCode: "rights_administration", legalBasis: "gdpr_art_6_1_f",
            dataCategories: ["financial_data"],
        })

        return {
            success: true,
            threshold_minor: Number(data.payout_threshold_minor ?? 50000),  // 500 kr. default
            currency: data.base_currency ?? "DKK",
        }
    } catch (err) {
        console.error("[rights-settlements] getOrgPayoutThreshold fejlede:", err)
        return { success: false, threshold_minor: 50000, currency: "DKK", error: String(err) }
    }
}

export async function setOrgPayoutThreshold(threshold_minor: number): Promise<{
    success: boolean; error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { error } = await db
            .from("organisations")
            .update({ payout_threshold_minor: threshold_minor })
            .eq("id", caller.orgId)

        if (error) throw error
        revalidatePath("/admin/rettighedsmidler/afregning")
        return { success: true }
    } catch (err) {
        console.error("[rights-settlements] setOrgPayoutThreshold fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Afregninger: hent ────────────────────────────────────────────────────────

export async function getSettlements(): Promise<{
    success: boolean
    settlements: Settlement[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { data, error } = await db
            .from("settlements")
            .select(`*, rights_funds ( name )`)
            .eq("org_id", caller.orgId)
            .order("created_at", { ascending: false })

        if (error) throw error

        const settlements: Settlement[] = (data ?? []).map((r) => ({
            ...r,
            total_gross: Number(r.total_gross ?? 0),
            total_individual: Number(r.total_individual ?? 0),
            total_below_threshold: Number(r.total_below_threshold ?? 0),
            total_payable: Number(r.total_payable ?? 0),
            payout_threshold_minor: Number(r.payout_threshold_minor ?? 0),
            fund_name: r.rights_funds?.name,
        }))

        return { success: true, settlements }
    } catch (err) {
        console.error("[rights-settlements] getSettlements fejlede:", err)
        return { success: false, settlements: [], error: String(err) }
    }
}

// ── Afregninger: opret ───────────────────────────────────────────────────────
// Samler alle betalbare tildelinger for en kasse og opretter poster.
// Tærskelkontrol sker her.

export async function createSettlement(payload: {
    fund_id: string
    label: string
    run_ids: string[]     // hvilke beregningsrunder inkluderes
    notes?: string | null
}): Promise<{ success: boolean; settlement_id?: string; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        // Hent tærskel
        const { data: org } = await db
            .from("organisations")
            .select("payout_threshold_minor, base_currency")
            .eq("id", caller.orgId)
            .single()

        const threshold = Number(org?.payout_threshold_minor ?? 50000)
        const currency = org?.base_currency ?? "DKK"

        // Hent alle betalbare (status=pending) tildelinger for de angivne runder
        const { data: allocs, error: allocErr } = await db
            .from("rights_allocations")
            .select(`
                id, rights_holder_id, individual_net,
                works ( title ), episodes ( title ),
                rights_calculation_runs ( period_label )
            `)
            .eq("org_id", caller.orgId)
            .in("run_id", payload.run_ids)
            .eq("status", "pending")

        if (allocErr) throw allocErr

        if (!allocs || allocs.length === 0) {
            throw new Error("Ingen betalbare tildelinger fundet for de valgte runder.")
        }

        // Summér pr. rettighedshaver
        const byHolder = new Map<string, {
            allocIds: string[]
            total: number
            work_title: string | null
            run_label: string | null
        }>()

        for (const a of allocs) {
            const id = a.rights_holder_id
            if (!byHolder.has(id)) {
                byHolder.set(id, { allocIds: [], total: 0, work_title: null, run_label: null })
            }
            const entry = byHolder.get(id)!
            entry.allocIds.push(a.id)
            entry.total += Number(a.individual_net)
            entry.work_title = firstRelated(a.episodes)?.title ?? firstRelated(a.works)?.title ?? null
            entry.run_label = firstRelated(a.rights_calculation_runs)?.period_label ?? null
        }

        // Beregn summer
        let totalIndividual = 0
        let totalBelowThreshold = 0
        let totalPayable = 0

        const items: Array<{
            rights_holder_id: string
            allocation_id: string
            individual_net: number
            adjustment_total: number
            payable_amount: number
            below_threshold: boolean
            currency: string
        }> = []

        for (const [rhId, entry] of byHolder.entries()) {
            totalIndividual += entry.total
            const belowThreshold = entry.total < threshold
            if (belowThreshold) {
                totalBelowThreshold += entry.total
            } else {
                totalPayable += entry.total
            }
            // En post pr. allokering
            for (const allocId of entry.allocIds) {
                items.push({
                    rights_holder_id: rhId,
                    allocation_id: allocId,
                    individual_net: Number(allocs.find(a => a.id === allocId)?.individual_net ?? 0),
                    adjustment_total: 0,
                    payable_amount: belowThreshold ? 0 : Number(allocs.find(a => a.id === allocId)?.individual_net ?? 0),
                    below_threshold: belowThreshold,
                    currency,
                })
            }
        }

        // Opret settlement
        const { data: settlement, error: sErr } = await db
            .from("settlements")
            .insert({
                org_id: caller.orgId,
                fund_id: payload.fund_id,
                label: payload.label,
                status: "draft",
                total_gross: totalIndividual,
                total_individual: totalIndividual,
                total_below_threshold: totalBelowThreshold,
                total_payable: totalPayable,
                currency,
                payout_threshold_minor: threshold,
                prepared_by: caller.userId,
                notes: payload.notes ?? null,
            })
            .select("id")
            .single()

        if (sErr) throw sErr

        // Opret settlement items
        const { error: itemErr } = await db
            .from("settlement_items")
            .insert(items.map(item => ({
                org_id: caller.orgId,
                settlement_id: settlement.id,
                ...item,
            })))

        if (itemErr) throw itemErr

        revalidatePath("/admin/rettighedsmidler/afregning")
        return { success: true, settlement_id: settlement.id }
    } catch (err) {
        console.error("[rights-settlements] createSettlement fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Afregninger: statusskift ─────────────────────────────────────────────────

export async function advanceSettlementStatus(
    id: string,
    targetStatus: "prepared" | "approved" | "paid_out" | "cancelled"
): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { data: settlement, error: fetchErr } = await db
            .from("settlements")
            .select("status, prepared_by")
            .eq("id", id)
            .eq("org_id", caller.orgId)
            .single()

        if (fetchErr) throw fetchErr
        if (settlement.status === "paid_out") throw new Error("En udbetalt afregning kan ikke ændres.")

        // Fire øjne: godkender må ikke være den der forberedte
        if (targetStatus === "approved" && settlement.prepared_by === caller.userId) {
            throw new Error("Fire-øjne-krav: godkender og forberedende bruger skal være forskellige.")
        }

        const patch: Record<string, unknown> = { status: targetStatus, updated_at: new Date().toISOString() }
        if (targetStatus === "approved") patch.approved_by = caller.userId
        if (targetStatus === "paid_out") patch.paid_out_at = new Date().toISOString()

        const { error } = await db
            .from("settlements")
            .update(patch)
            .eq("id", id)
            .eq("org_id", caller.orgId)

        if (error) throw error

        revalidatePath("/admin/rettighedsmidler/afregning")
        return { success: true }
    } catch (err) {
        console.error("[rights-settlements] advanceSettlementStatus fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Afregningsposter: hent ───────────────────────────────────────────────────

export async function getSettlementItems(settlement_id: string): Promise<{
    success: boolean
    items: SettlementItem[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { data, error } = await db
            .from("settlement_items")
            .select(`
                *,
                rettighedshavere ( full_name, member_number ),
                rights_allocations (
                    works ( title ),
                    episodes ( title ),
                    rights_calculation_runs ( period_label )
                )
            `)
            .eq("settlement_id", settlement_id)
            .eq("org_id", caller.orgId)
            .order("payable_amount", { ascending: false })

        if (error) throw error

        const items: SettlementItem[] = (data ?? []).map((r) => ({
            ...r,
            individual_net: Number(r.individual_net),
            adjustment_total: Number(r.adjustment_total),
            payable_amount: Number(r.payable_amount),
            rights_holder_name: r.rettighedshavere?.full_name,
            member_number: r.rettighedshavere?.member_number,
            work_title: r.rights_allocations?.episodes?.title ?? r.rights_allocations?.works?.title,
            run_label: r.rights_allocations?.rights_calculation_runs?.period_label,
        }))

        return { success: true, items }
    } catch (err) {
        console.error("[rights-settlements] getSettlementItems fejlede:", err)
        return { success: false, items: [], error: String(err) }
    }
}

// ── DataLøn-referencer: hent og opret ────────────────────────────────────────

export async function getPayrollReferences(): Promise<{
    success: boolean
    references: PayrollRecipientReference[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { data, error } = await db
            .from("payroll_recipient_references")
            .select(`*, rettighedshavere ( full_name )`)
            .eq("org_id", caller.orgId)
            .order("created_at", { ascending: false })

        if (error) throw error

        const references: PayrollRecipientReference[] = (data ?? []).map((r) => ({
            ...r,
            rights_holder_name: r.rettighedshavere?.full_name,
        }))

        return { success: true, references }
    } catch (err) {
        console.error("[rights-settlements] getPayrollReferences fejlede:", err)
        return { success: false, references: [], error: String(err) }
    }
}

export async function upsertPayrollReference(payload: {
    rights_holder_id: string
    system: string
    recipient_id: string
}): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { error } = await db
            .from("payroll_recipient_references")
            .upsert({
                org_id: caller.orgId,
                rights_holder_id: payload.rights_holder_id,
                system: payload.system,
                recipient_id: payload.recipient_id,
                active: true,
            }, { onConflict: "org_id,rights_holder_id,system" })

        if (error) throw error
        revalidatePath("/admin/rettighedsmidler/afregning")
        return { success: true }
    } catch (err) {
        console.error("[rights-settlements] upsertPayrollReference fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Eksportbatches: hent ──────────────────────────────────────────────────────

export async function getPayrollExportBatches(): Promise<{
    success: boolean
    batches: PayrollExportBatch[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { data, error } = await db
            .from("payroll_export_batches")
            .select(`*, settlements ( label )`)
            .eq("org_id", caller.orgId)
            .order("created_at", { ascending: false })

        if (error) throw error

        const batches: PayrollExportBatch[] = (data ?? []).map((r) => ({
            ...r,
            settlement_label: r.settlements?.label,
        }))

        return { success: true, batches }
    } catch (err) {
        console.error("[rights-settlements] getPayrollExportBatches fejlede:", err)
        return { success: false, batches: [], error: String(err) }
    }
}
