"use server"

import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { revalidatePath } from "next/cache"
import { firstRelated } from "@/lib/supabase/relations"
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit"

const ADMIN_ORG_ROLES = ["superadmin", "admin", "org-admin"] as const

// ── Typer ────────────────────────────────────────────────────────────────────

export type AllocationStatus =
    | "pending"
    | "distributed"
    | "partially_withheld"
    | "fully_withheld"
    | "cancelled"

export type RightsAllocation = {
    id: string
    org_id: string
    run_id: string
    work_allocation_id: string
    rights_holder_id: string
    episode_id: string | null
    work_id: string | null
    role_label: string | null
    share_bps: number         // 10000 = 100%
    gross_share: number       // øre
    admin_share: number
    claim_reserve_share: number
    sku_direct_share: number
    sku_from_reserve_share: number
    statutory_collective_share: number
    net_claim_reserve_share: number
    individual_net: number
    status: AllocationStatus
    withheld_reason: string | null
    notes: string | null
    created_at: string
    updated_at: string
    // Joins
    rights_holder_name?: string
    rights_holder_member_number?: string | null
    work_title?: string
    episode_title?: string
}

export type AllocationInput = {
    work_allocation_id: string
    rights_holder_id: string
    role_label?: string | null
    share_bps: number        // andel i bps, fx 5000 = 50%
}

export type RightsAdjustment = {
    id: string
    org_id: string
    allocation_id: string
    adjustment_type: "correction" | "withhold_lift" | "manual_override"
    delta_individual_net: number   // øre, kan være negativ
    reason: string
    created_by: string | null
    approved_by: string | null
    created_at: string
    // Joins
    rights_holder_name?: string
}

export type WithheldPosition = {
    id: string
    org_id: string
    run_id: string
    work_allocation_id: string
    rights_holder_id: string
    withheld_amount: number    // øre
    withheld_reason: string
    resolved_at: string | null
    resolved_by: string | null
    resolution_notes: string | null
    created_at: string
    // Joins
    rights_holder_name?: string
    rights_holder_member_number?: string | null
}

// ── Rettighedstildelinger: hent for en run ────────────────────────────────────

export async function getRightsAllocations(run_id: string): Promise<{
    success: boolean
    allocations: RightsAllocation[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { data, error } = await db
            .from("rights_allocations")
            .select(`
                *,
                rettighedshavere ( full_name, org_affiliations ( member_no ) ),
                rights_work_allocations (
                    work_id,
                    episode_id,
                    works ( title ),
                    episodes ( title )
                )
            `)
            .eq("run_id", run_id)
            .eq("org_id", caller.orgId)
            .order("created_at", { ascending: false })

        if (error) throw error

        const allocations: RightsAllocation[] = (data ?? []).map((r) => {
            const rh = firstRelated(r.rettighedshavere)
            const aff = Array.isArray(rh?.org_affiliations) ? rh.org_affiliations[0] : rh?.org_affiliations
            const wa = firstRelated(r.rights_work_allocations)
            const work = firstRelated(wa?.works)
            const episode = firstRelated(wa?.episodes)
            return {
                ...r,
                individual_net: Number(r.individual_net ?? r.individual_amount ?? r.net_amount ?? 0),
                rights_holder_name: rh?.full_name,
                rights_holder_member_number: aff?.member_no ?? null,
                work_title: work?.title,
                episode_title: episode?.title,
            }
        })

        await recordSensitiveFlow({ actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" }, action: "read", component: "admin.rights.allocations", entityType: "rights_allocations", entityId: run_id, targetMemberUuids: allocations.map(item => item.rights_holder_id), orgIds: [caller.orgId], purposeCode: "rights_distribution", legalBasis: "GDPR Art. 6(1)(c)/(f) og 9(2)(d)", dataCategories: ["rights_data", "financial_data", "union_membership_data"], counts: { results: allocations.length } })

        return { success: true, allocations }
    } catch (err) {
        console.error("[rights-allocations] getRightsAllocations fejlede:", err)
        return { success: false, allocations: [], error: String(err) }
    }
}

// ── Rettighedstildelinger: batch-opret for et værkbeløb ──────────────────────

export async function createRightsAllocations(
    run_id: string,
    work_allocation_id: string,
    items: AllocationInput[]
): Promise<{ success: boolean; count: number; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        // Valider at andele summerer til 10000 bps
        const totalBps = items.reduce((s, i) => s + i.share_bps, 0)
        if (totalBps !== 10000) {
            throw new Error(
                `Andele skal summere til 10 000 bps (100%). Nuværende sum: ${totalBps} bps.`
            )
        }

        // Hent værkbeløb for at fordele summer
        const { data: wa, error: waErr } = await db
            .from("rights_work_allocations")
            .select("*")
            .eq("id", work_allocation_id)
            .eq("org_id", caller.orgId)
            .single()

        if (waErr) throw waErr

        const rows = items.map(item => {
            const factor = item.share_bps / 10000
            const applyShare = (amount: number) => Math.round(amount * factor)

            return {
                org_id: caller.orgId,
                run_id,
                work_allocation_id,
                rights_holder_id: item.rights_holder_id,
                work_id: wa.work_id,
                episode_id: wa.episode_id,
                role_label: item.role_label ?? null,
                share_bps: item.share_bps,
                gross_share: applyShare(wa.gross_share),
                admin_share: applyShare(wa.admin_share),
                claim_reserve_share: applyShare(wa.claim_reserve_share),
                sku_direct_share: applyShare(wa.sku_direct_share),
                sku_from_reserve_share: applyShare(wa.sku_from_reserve_share),
                statutory_collective_share: applyShare(wa.statutory_collective_share),
                net_claim_reserve_share: applyShare(wa.net_claim_reserve_share),
                individual_net: applyShare(wa.individual_net),
                status: "pending",
            }
        })

        const { error } = await db
            .from("rights_allocations")
            .insert(rows)

        if (error) throw error

        await recordSensitiveFlow({ actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" }, action: "create", component: "admin.rights.allocations-create", entityType: "rights_allocations", entityId: run_id, targetMemberUuids: items.map(item => item.rights_holder_id), orgIds: [caller.orgId], purposeCode: "rights_distribution", legalBasis: "GDPR Art. 6(1)(c)/(f) og 9(2)(d)", dataCategories: ["rights_data", "financial_data", "union_membership_data"], counts: { created: rows.length } })

        revalidatePath("/admin/rettighedsmidler")
        return { success: true, count: rows.length }
    } catch (err) {
        console.error("[rights-allocations] createRightsAllocations fejlede:", err)
        return { success: false, count: 0, error: String(err) }
    }
}

// ── Tilbageholdt position: opret ──────────────────────────────────────────────

export async function createWithheldPosition(payload: {
    run_id: string
    work_allocation_id: string
    rights_holder_id: string
    withheld_amount: number
    withheld_reason: string
}): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { error } = await db
            .from("withheld_beneficiary_positions")
            .insert({
                org_id: caller.orgId,
                run_id: payload.run_id,
                work_allocation_id: payload.work_allocation_id,
                rights_holder_id: payload.rights_holder_id,
                withheld_amount: payload.withheld_amount,
                withheld_reason: payload.withheld_reason,
            })

        if (error) throw error

        // Sæt tilknyttet allokering til delvist/fuldt tilbageholdt
        await db
            .from("rights_allocations")
            .update({ status: "partially_withheld", withheld_reason: payload.withheld_reason })
            .eq("work_allocation_id", payload.work_allocation_id)
            .eq("rights_holder_id", payload.rights_holder_id)
            .eq("org_id", caller.orgId)

        await recordSensitiveFlow({ actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" }, action: "create", component: "admin.rights.withheld-create", entityType: "withheld_beneficiary_positions", entityId: payload.work_allocation_id, targetMemberUuid: payload.rights_holder_id, orgIds: [caller.orgId], purposeCode: "rights_distribution", legalBasis: "GDPR Art. 6(1)(c)/(f) og 9(2)(d)", dataCategories: ["rights_data", "financial_data", "union_membership_data"] })

        revalidatePath("/admin/rettighedsmidler")
        return { success: true }
    } catch (err) {
        console.error("[rights-allocations] createWithheldPosition fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Tilbageholdt position: hent for run ───────────────────────────────────────

export async function getWithheldPositions(run_id: string): Promise<{
    success: boolean
    positions: WithheldPosition[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { data, error } = await db
            .from("withheld_beneficiary_positions")
            .select(`*, rettighedshavere ( full_name, org_affiliations ( member_no ) )`)
            .eq("run_id", run_id)
            .eq("org_id", caller.orgId)
            .order("created_at", { ascending: false })

        if (error) throw error

        const positions: WithheldPosition[] = (data ?? []).map((r) => {
            const rh = firstRelated(r.rettighedshavere)
            const aff = Array.isArray(rh?.org_affiliations) ? rh.org_affiliations[0] : rh?.org_affiliations
            return {
                ...r,
                rights_holder_name: rh?.full_name,
                rights_holder_member_number: aff?.member_no ?? null,
            }
        })

        await recordSensitiveFlow({ actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" }, action: "read", component: "admin.rights.withheld-list", entityType: "withheld_beneficiary_positions", entityId: run_id, targetMemberUuids: positions.map(item => item.rights_holder_id), orgIds: [caller.orgId], purposeCode: "rights_distribution", legalBasis: "GDPR Art. 6(1)(c)/(f) og 9(2)(d)", dataCategories: ["rights_data", "financial_data", "union_membership_data"], counts: { results: positions.length } })

        return { success: true, positions }
    } catch (err) {
        console.error("[rights-allocations] getWithheldPositions fejlede:", err)
        return { success: false, positions: [], error: String(err) }
    }
}

// ── Tilbageholdt position: frigiv ─────────────────────────────────────────────

export async function resolveWithheldPosition(
    id: string,
    resolution_notes: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()
        const { data: position } = await db.from("withheld_beneficiary_positions").select("rights_holder_id").eq("id", id).eq("org_id", caller.orgId).maybeSingle()

        const { error } = await db
            .from("withheld_beneficiary_positions")
            .update({
                resolved_at: new Date().toISOString(),
                resolved_by: caller.userId,
                resolution_notes,
            })
            .eq("id", id)
            .eq("org_id", caller.orgId)

        if (error) throw error

        await recordSensitiveFlow({ actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" }, action: "update", component: "admin.rights.withheld-resolve", entityType: "withheld_beneficiary_positions", entityId: id, targetMemberUuid: position?.rights_holder_id ?? null, orgIds: [caller.orgId], purposeCode: "rights_distribution", legalBasis: "GDPR Art. 6(1)(c)/(f) og 9(2)(d)", dataCategories: ["rights_data", "financial_data", "union_membership_data"] })

        revalidatePath("/admin/rettighedsmidler")
        return { success: true }
    } catch (err) {
        console.error("[rights-allocations] resolveWithheldPosition fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Korrektioner: opret ───────────────────────────────────────────────────────

export async function createRightsAdjustment(payload: {
    allocation_id: string
    adjustment_type: "correction" | "withhold_lift" | "manual_override"
    delta_individual_net: number
    reason: string
}): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()
        const { data: allocation } = await db.from("rights_allocations").select("rights_holder_id").eq("id", payload.allocation_id).eq("org_id", caller.orgId).maybeSingle()

        const { error } = await db
            .from("rights_adjustments")
            .insert({
                org_id: caller.orgId,
                allocation_id: payload.allocation_id,
                adjustment_type: payload.adjustment_type,
                delta_individual_net: payload.delta_individual_net,
                reason: payload.reason,
                created_by: caller.userId,
            })

        if (error) throw error

        await recordSensitiveFlow({ actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" }, action: "update", component: "admin.rights.adjustment", entityType: "rights_allocations", entityId: payload.allocation_id, targetMemberUuid: allocation?.rights_holder_id ?? null, orgIds: [caller.orgId], purposeCode: "rights_distribution", legalBasis: "GDPR Art. 6(1)(c)/(f) og 9(2)(d)", dataCategories: ["rights_data", "financial_data", "union_membership_data"] })

        revalidatePath("/admin/rettighedsmidler")
        return { success: true }
    } catch (err) {
        console.error("[rights-allocations] createRightsAdjustment fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Oversigt: rettighedshavere for en run (aggregeret) ───────────────────────

export type RightsHolderSummary = {
    rights_holder_id: string
    rights_holder_name: string
    member_number: string | null
    allocation_count: number
    total_individual_net: number
    has_withheld: boolean
}

export async function getRightsHolderSummary(run_id: string): Promise<{
    success: boolean
    summary: RightsHolderSummary[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { data, error } = await db
            .from("rights_allocations")
            .select(`
                rights_holder_id,
                individual_net:individual_amount,
                net_amount,
                status,
                rettighedshavere ( full_name, org_affiliations ( member_no ) )
            `)
            .eq("run_id", run_id)
            .eq("org_id", caller.orgId)

        if (error) throw error

        // Aggregér per rettighedshaver
        const map = new Map<string, RightsHolderSummary>()
        for (const row of data ?? []) {
            const id = row.rights_holder_id
            const holder = firstRelated(row.rettighedshavere)
            const aff = Array.isArray(holder?.org_affiliations) ? holder.org_affiliations[0] : holder?.org_affiliations
            if (!map.has(id)) {
                map.set(id, {
                    rights_holder_id: id,
                    rights_holder_name: holder?.full_name ?? "—",
                    member_number: aff?.member_no ?? null,
                    allocation_count: 0,
                    total_individual_net: 0,
                    has_withheld: false,
                })
            }
            const entry = map.get(id)!
            entry.allocation_count++
            entry.total_individual_net += Number(row.individual_net ?? row.net_amount ?? 0)
            if (["partially_withheld", "fully_withheld"].includes(row.status)) {
                entry.has_withheld = true
            }
        }

        const summary = Array.from(map.values()).sort(
            (a, b) => b.total_individual_net - a.total_individual_net
        )
        await recordSensitiveFlow({ actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" }, action: "read", component: "admin.rights.holder-summary", entityType: "rights_allocations", entityId: run_id, targetMemberUuids: summary.map(item => item.rights_holder_id), orgIds: [caller.orgId], purposeCode: "rights_distribution", legalBasis: "GDPR Art. 6(1)(c)/(f) og 9(2)(d)", dataCategories: ["rights_data", "financial_data", "union_membership_data"], counts: { results: summary.length } })
        return {
            success: true,
            summary,
        }
    } catch (err) {
        console.error("[rights-allocations] getRightsHolderSummary fejlede:", err)
        return { success: false, summary: [], error: String(err) }
    }
}
