"use server"

import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { revalidatePath } from "next/cache"
import { allocateByLargestRemainder } from "@/lib/rights-largest-remainder"

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

function validationConfirmsRight(extracted: unknown, rightType: "copydan" | "svod" | "royalty"): boolean {
    if (!extracted || typeof extracted !== "object") return false
    const data = extracted as Record<string, unknown>
    const overview = data.rightsOverview && typeof data.rightsOverview === "object"
        ? data.rightsOverview as Record<string, unknown>
        : {}
    const value = rightType === "copydan"
        ? data.copydan ?? overview.copydanforbehold
        : rightType === "svod"
            ? data.svod ?? overview.streamingforbehold
            : data.royalty
    if (value === true) return true
    if (typeof value !== "string") return false
    return ["ja", "yes", "true", "fundet", "confirmed", "bekræftet"].includes(value.trim().toLowerCase())
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
                rettighedshavere ( full_name, member_number ),
                rights_work_allocations ( works ( title ), episodes ( title ) )
            `)
            .eq("run_id", run_id)
            .eq("org_id", caller.orgId)
            .order("individual_amount", { ascending: false })

        if (error) throw error

        const allocations: RightsAllocation[] = (data ?? []).map((r: any) => ({
            ...r,
            role_label: r.role_code,
            share_percent: r.share_percent,
            individual_net: Number(r.individual_amount),
            withheld_reason: r.blocked_reason,
            rights_holder_name: r.rettighedshavere?.full_name,
            rights_holder_member_number: r.rettighedshavere?.member_number,
            work_title: r.rights_work_allocations?.works?.title,
            episode_title: r.rights_work_allocations?.episodes?.title,
        }))

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
): Promise<{ success: boolean; count: number; withheldCount?: number; error?: string }> {
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

        const { data: wa, error: waErr } = await db
            .from("rights_work_allocations")
            .select(`*, rights_calculation_runs!inner(
                id, rights_funds!inner(id, rights_category, allowed_roles)
            )`)
            .eq("id", work_allocation_id)
            .eq("org_id", caller.orgId)
            .eq("run_id", run_id)
            .single()

        if (waErr) throw waErr

        const run = Array.isArray((wa as any).rights_calculation_runs)
            ? (wa as any).rights_calculation_runs[0]
            : (wa as any).rights_calculation_runs
        const fund = Array.isArray(run?.rights_funds) ? run.rights_funds[0] : run?.rights_funds
        const category = String(fund?.rights_category ?? "copydan").toLowerCase()
        const rightType: "copydan" | "svod" | "royalty" = category.includes("royalt")
            ? "royalty" : category.includes("svod") || category.includes("stream") ? "svod" : "copydan"
        const allowedRoles = (fund?.allowed_roles ?? []).map((role: string) => role.trim().toLowerCase())
        for (const item of items) {
            if (allowedRoles.length > 0 && !allowedRoles.includes((item.role_label ?? "").trim().toLowerCase())) {
                throw new Error(`Rollen ${item.role_label ?? "(mangler)"} forvaltes ikke af denne organisations rettighedskasse.`)
            }
        }

        const holderIds = items.map(item => item.rights_holder_id)
        const { data: contracts, error: contractsError } = await db.from("contracts")
            .select("id,rights_holder_id,status,contract_validations(extracted_data,validated_by,validated_at)")
            .eq("org_id", caller.orgId).eq("work_id", wa.work_id).in("rights_holder_id", holderIds)
            .in("status", ["valideret", "arkiveret"])
        if (contractsError) throw contractsError

        const evidenceByHolder = new Map<string, { documented: boolean; contractId: string | null }>()
        for (const item of items) {
            const candidates = (contracts ?? []).filter(contract => contract.rights_holder_id === item.rights_holder_id)
            const documentedContract = candidates.find(contract => {
                const validation = Array.isArray(contract.contract_validations)
                    ? contract.contract_validations[0] : contract.contract_validations
                return Boolean(validation?.validated_by && validation?.validated_at)
                    && validationConfirmsRight(validation?.extracted_data, rightType)
            })
            evidenceByHolder.set(item.rights_holder_id, {
                documented: Boolean(documentedContract),
                contractId: documentedContract?.id ?? candidates[0]?.id ?? null,
            })
        }

        const distributionWeights = items.map(item => ({ id: item.rights_holder_id, weight: item.share_bps }))
        const distribute = (amount: number) => new Map(
            allocateByLargestRemainder(Number(amount), distributionWeights).map(row => [row.id, row.amount]),
        )
        const allocated = {
            gross: distribute(wa.gross_share), admin: distribute(wa.admin_share),
            reserve: distribute(wa.claim_reserve_share), skuDirect: distribute(wa.sku_direct_share),
            skuReserve: distribute(wa.sku_from_reserve_share), collective: distribute(wa.statutory_collective_share),
            individual: distribute(wa.individual_net),
        }
        const rows = items.map(item => ({
            rights_holder_id: item.rights_holder_id,
            role_code: item.role_label ?? null,
            share_bps: item.share_bps,
            distribution_key_scope: wa.episode_id ? "episode" : "work",
            distribution_key_snapshot: { items: items.map(entry => ({ rights_holder_id: entry.rights_holder_id, role: entry.role_label, share_bps: entry.share_bps })) },
            documented: evidenceByHolder.get(item.rights_holder_id)?.documented === true,
            contract_id: evidenceByHolder.get(item.rights_holder_id)?.contractId,
            gross_share: allocated.gross.get(item.rights_holder_id),
            admin_share: allocated.admin.get(item.rights_holder_id),
            claim_reserve_share: allocated.reserve.get(item.rights_holder_id),
            sku_direct_share: allocated.skuDirect.get(item.rights_holder_id),
            sku_from_reserve_share: allocated.skuReserve.get(item.rights_holder_id),
            statutory_collective_share: allocated.collective.get(item.rights_holder_id),
            net_amount: allocated.individual.get(item.rights_holder_id),
        }))

        const { data, error } = await db.rpc("distribute_rights_work_allocation", {
            p_org_id: caller.orgId, p_run_id: run_id, p_work_allocation_id: work_allocation_id,
            p_right_type: rightType, p_items: rows, p_actor: caller.userId,
        })
        if (error) throw error
        const result = Array.isArray(data) ? data[0] : data

        revalidatePath("/admin/rettighedsmidler")
        revalidatePath("/portal/okonomi")
        return { success: true, count: Number(result?.allocation_count ?? 0), withheldCount: Number(result?.withheld_count ?? 0) }
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
            .select(`*, rettighedshavere ( full_name, member_number )`)
            .eq("run_id", run_id)
            .eq("org_id", caller.orgId)
            .order("created_at", { ascending: false })

        if (error) throw error

        const positions: WithheldPosition[] = (data ?? []).map((r: any) => ({
            ...r,
            rights_holder_name: r.rettighedshavere?.full_name,
            rights_holder_member_number: r.rettighedshavere?.member_number,
        }))

        return { success: true, positions }
    } catch (err) {
        console.error("[rights-allocations] getWithheldPositions fejlede:", err)
        return { success: false, positions: [], error: String(err) }
    }
}

// ── Tilbageholdt position: frigiv ─────────────────────────────────────────────

export async function resolveWithheldPosition(
    id: string,
    resolutionNotes: string
): Promise<{ success: boolean; error?: string }> {
    void id
    void resolutionNotes
    return {
        success: false,
        error: "Positionen kan kun afgøres gennem den tilknyttede rettighedssag og fire-øjne-flowet.",
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
                individual_net,
                status,
                rettighedshavere ( full_name, member_number )
            `)
            .eq("run_id", run_id)
            .eq("org_id", caller.orgId)

        if (error) throw error

        // Aggregér per rettighedshaver
        const map = new Map<string, RightsHolderSummary>()
        for (const row of (data ?? []) as any[]) {
            const id = row.rights_holder_id
            if (!map.has(id)) {
                map.set(id, {
                    rights_holder_id: id,
                    rights_holder_name: row.rettighedshavere?.full_name ?? "—",
                    member_number: row.rettighedshavere?.member_number ?? null,
                    allocation_count: 0,
                    total_individual_net: 0,
                    has_withheld: false,
                })
            }
            const entry = map.get(id)!
            entry.allocation_count++
            entry.total_individual_net += Number(row.individual_net)
            if (["partially_withheld", "fully_withheld"].includes(row.status)) {
                entry.has_withheld = true
            }
        }

        return {
            success: true,
            summary: Array.from(map.values()).sort(
                (a, b) => b.total_individual_net - a.total_individual_net
            ),
        }
    } catch (err) {
        console.error("[rights-allocations] getRightsHolderSummary fejlede:", err)
        return { success: false, summary: [], error: String(err) }
    }
}
