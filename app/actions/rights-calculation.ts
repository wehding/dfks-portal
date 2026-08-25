"use server"

import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { revalidatePath } from "next/cache"
import { computePolicyPreview } from "@/lib/rights-policy-preview"
import type { PolicyVersionWithComponents } from "@/app/actions/rights-funds"

const ADMIN_ORG_ROLES = ["superadmin", "admin", "org-admin"] as const

// ── Typer ────────────────────────────────────────────────────────────────────

export type CalculationRunStatus =
    | "draft" | "calculated" | "awaiting_approval" | "approved" | "booked" | "cancelled"

export type CalculationRun = {
    id: string
    org_id: string
    fund_id: string
    policy_version_id: string
    source_batch_id: string | null
    source_batch_ref: string | null
    period_label: string
    period_from: string | null
    period_to: string | null
    currency: string
    gross_amount: bigint
    admin_amount: bigint
    distribution_basis: bigint
    claim_reserve_amount: bigint
    sku_direct_amount: bigint
    sku_from_reserve_amount: bigint
    statutory_collective_amount: bigint
    net_claim_reserve_amount: bigint
    individual_amount: bigint
    weight_config_snapshot: unknown
    status: CalculationRunStatus
    version_number: number
    prepared_by: string | null
    approved_by: string | null
    booked_at: string | null
    notes: string | null
    created_at: string
    updated_at: string
    // Joins
    fund_name?: string
    fund_code?: string
    policy_version_number?: number
}

export type WorkAllocation = {
    id: string
    org_id: string
    run_id: string
    work_id: string | null
    episode_id: string | null
    source_row_id: string | null
    source_ref: string | null
    usage_date: string | null
    usage_year: number
    claim_period_start: string
    claim_deadline: string
    eligible_for_undistributable_at: string
    is_rebroadcast: boolean
    points: number | null
    pool_share_bps: number | null
    currency: string
    gross_share: number
    admin_share: number
    claim_reserve_share: number
    sku_direct_share: number
    sku_from_reserve_share: number
    statutory_collective_share: number
    net_claim_reserve_share: number
    individual_net: number
    status: "pending" | "distributed" | "partially_withheld" | "fully_withheld"
    created_at: string
    // Joins
    work_title?: string
    episode_title?: string
}

// ── Beregningsrunder: hent ────────────────────────────────────────────────────

export async function getCalculationRuns(fund_id?: string): Promise<{
    success: boolean
    runs: CalculationRun[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        let q = db
            .from("rights_calculation_runs")
            .select(`
                *,
                rights_funds ( name, code ),
                distribution_policy_versions ( version_number )
            `)
            .eq("org_id", caller.orgId)
            .order("created_at", { ascending: false })

        if (fund_id) q = q.eq("fund_id", fund_id)

        const { data, error } = await q
        if (error) throw error

        const runs: CalculationRun[] = (data ?? []).map((r: any) => ({
            ...r,
            fund_name: r.rights_funds?.name,
            fund_code: r.rights_funds?.code,
            policy_version_number: r.distribution_policy_versions?.version_number,
        }))

        return { success: true, runs }
    } catch (err) {
        console.error("[rights-calculation] getCalculationRuns fejlede:", err)
        return { success: false, runs: [], error: String(err) }
    }
}

export async function getCalculationRun(id: string): Promise<{
    success: boolean
    run?: CalculationRun
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { data, error } = await db
            .from("rights_calculation_runs")
            .select(`
                *,
                rights_funds ( name, code ),
                distribution_policy_versions ( version_number )
            `)
            .eq("id", id)
            .eq("org_id", caller.orgId)
            .single()

        if (error) throw error

        return {
            success: true,
            run: {
                ...data,
                fund_name: (data as any).rights_funds?.name,
                fund_code: (data as any).rights_funds?.code,
                policy_version_number: (data as any).distribution_policy_versions?.version_number,
            } as CalculationRun,
        }
    } catch (err) {
        console.error("[rights-calculation] getCalculationRun fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Beregningsrunde: opret ────────────────────────────────────────────────────

export async function createCalculationRun(payload: {
    fund_id: string
    policy_version_id: string
    period_label: string
    period_from?: string | null
    period_to?: string | null
    gross_amount_minor: number           // beløb i øre
    source_batch_id?: string | null
    source_batch_ref?: string | null
    weight_config_snapshot?: unknown
    notes?: string | null
}): Promise<{ success: boolean; run?: CalculationRun; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        // Hent policyversion med komponenter til beregning
        const { data: versionData, error: vErr } = await db
            .from("distribution_policy_versions")
            .select(`*, distribution_policy_components(*)`)
            .eq("id", payload.policy_version_id)
            .eq("org_id", caller.orgId)
            .single()

        if (vErr) throw vErr
        if (versionData.status !== "active") {
            throw new Error("Kun aktive policyversioner kan bruges til beregning.")
        }

        const version = versionData as PolicyVersionWithComponents & {
            distribution_policy_components: any[]
        }
        const components = version.distribution_policy_components ?? []

        // Beregn alle summer deterministisk
        const preview = computePolicyPreview(
            payload.gross_amount_minor,
            version.admin_rate_bps,
            components
        )

        if (!preview.invariant_ok) {
            throw new Error("Beregningsinvariant brudt — beløbene summerer ikke til brutto. Tjek afrunding.")
        }

        // Hent valuta fra kassen
        const { data: fund, error: fErr } = await db
            .from("rights_funds")
            .select("currency")
            .eq("id", payload.fund_id)
            .eq("org_id", caller.orgId)
            .single()

        if (fErr) throw fErr

        const { data: run, error: rErr } = await db
            .from("rights_calculation_runs")
            .insert({
                org_id: caller.orgId,
                fund_id: payload.fund_id,
                policy_version_id: payload.policy_version_id,
                period_label: payload.period_label,
                period_from: payload.period_from ?? null,
                period_to: payload.period_to ?? null,
                source_batch_id: payload.source_batch_id ?? null,
                source_batch_ref: payload.source_batch_ref ?? null,
                currency: fund.currency,
                gross_amount: preview.gross,
                admin_amount: preview.admin,
                distribution_basis: preview.distribution_basis,
                claim_reserve_amount: preview.claim_reserve,
                sku_direct_amount: preview.sku_direct,
                sku_from_reserve_amount: preview.sku_from_reserve,
                statutory_collective_amount: preview.statutory_collective,
                net_claim_reserve_amount: preview.net_claim_reserve,
                individual_amount: preview.individual,
                weight_config_snapshot: payload.weight_config_snapshot ?? null,
                status: "draft",
                version_number: 1,
                prepared_by: caller.userId,
                notes: payload.notes ?? null,
            })
            .select()
            .single()

        if (rErr) throw rErr

        // Markér policyversion som brugt i beregning
        await db
            .from("distribution_policy_versions")
            .update({ used_in_calculation: true })
            .eq("id", payload.policy_version_id)

        revalidatePath("/admin/rettighedsmidler")
        return { success: true, run: run as CalculationRun }
    } catch (err) {
        console.error("[rights-calculation] createCalculationRun fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Beregningsrunde: statusskift ──────────────────────────────────────────────

export async function advanceCalculationRunStatus(
    id: string,
    targetStatus: "calculated" | "awaiting_approval" | "approved" | "booked" | "cancelled"
): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { data: run, error: fetchErr } = await db
            .from("rights_calculation_runs")
            .select("status, prepared_by")
            .eq("id", id)
            .eq("org_id", caller.orgId)
            .single()

        if (fetchErr) throw fetchErr
        if (run.status === "booked") throw new Error("En booket runde kan ikke ændres.")

        // Fire øjne: godkender må ikke være udarbejder
        if (targetStatus === "approved" && run.prepared_by === caller.userId) {
            throw new Error("Fire-øjne-krav: godkender og udarbejder skal være forskellige personer.")
        }

        const patch: Record<string, unknown> = {
            status: targetStatus,
            updated_at: new Date().toISOString(),
        }
        if (targetStatus === "approved") patch.approved_by = caller.userId
        if (targetStatus === "booked") patch.booked_at = new Date().toISOString()

        const { error } = await db
            .from("rights_calculation_runs")
            .update(patch)
            .eq("id", id)
            .eq("org_id", caller.orgId)

        if (error) throw error

        revalidatePath("/admin/rettighedsmidler")
        return { success: true }
    } catch (err) {
        console.error("[rights-calculation] advanceCalculationRunStatus fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Værkbeløb: hent ──────────────────────────────────────────────────────────

export async function getWorkAllocations(run_id: string): Promise<{
    success: boolean
    allocations: WorkAllocation[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { data, error } = await db
            .from("rights_work_allocations")
            .select(`
                *,
                works ( title ),
                episodes ( title )
            `)
            .eq("run_id", run_id)
            .eq("org_id", caller.orgId)
            .order("gross_share", { ascending: false })

        if (error) throw error

        const allocations: WorkAllocation[] = (data ?? []).map((r: any) => ({
            ...r,
            work_title: r.works?.title,
            episode_title: r.episodes?.title,
        }))

        return { success: true, allocations }
    } catch (err) {
        console.error("[rights-calculation] getWorkAllocations fejlede:", err)
        return { success: false, allocations: [], error: String(err) }
    }
}

// ── Værkbeløb: opret batch ────────────────────────────────────────────────────
// Indsætter værkbeløb for en beregningsrunde.
// Kald én gang pr. runde med alle værkrækker — ikke enkeltvis.

export type WorkAllocationInput = {
    work_id?: string | null
    episode_id?: string | null
    source_row_id?: string | null
    source_ref?: string | null
    usage_date?: string | null
    usage_year: number
    is_rebroadcast?: boolean
    points?: number | null
    pool_share_bps?: number | null
    gross_share: number        // beløb i øre
}

export async function createWorkAllocations(
    run_id: string,
    items: WorkAllocationInput[]
): Promise<{ success: boolean; count: number; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        // Hent runden for at få policy og valuta
        const { data: run, error: runErr } = await db
            .from("rights_calculation_runs")
            .select(`
                *,
                distribution_policy_versions (
                    admin_rate_bps,
                    distribution_policy_components (*),
                    distribution_policies ( claim_period_years )
                )
            `)
            .eq("id", run_id)
            .eq("org_id", caller.orgId)
            .single()

        if (runErr) throw runErr
        if (run.status === "booked") throw new Error("Kan ikke tilføje værkbeløb til en booket runde.")

        const pv = (run as any).distribution_policy_versions
        const components = pv?.distribution_policy_components ?? []
        const claimPeriodYears: number = pv?.distribution_policies?.claim_period_years ?? 3

        // Beregn fristdatoer og individuelle beløb pr. værkrække
        const rows = items.map(item => {
            const preview = computePolicyPreview(item.gross_share, pv.admin_rate_bps, components)

            const usageYear = item.usage_year
            const claimPeriodStart = `${usageYear}-12-31`
            const deadlineYear = usageYear + claimPeriodYears
            const claimDeadline = `${deadlineYear}-12-31`
            // dagen efter deadline
            const eligibleDate = new Date(`${deadlineYear}-12-31`)
            eligibleDate.setDate(eligibleDate.getDate() + 1)
            const eligible = eligibleDate.toISOString().slice(0, 10)

            return {
                org_id: caller.orgId,
                run_id,
                work_id: item.work_id ?? null,
                episode_id: item.episode_id ?? null,
                source_row_id: item.source_row_id ?? null,
                source_ref: item.source_ref ?? null,
                usage_date: item.usage_date ?? null,
                usage_year: usageYear,
                claim_period_start: claimPeriodStart,
                claim_deadline: claimDeadline,
                eligible_for_undistributable_at: eligible,
                is_rebroadcast: item.is_rebroadcast ?? false,
                points: item.points ?? null,
                pool_share_bps: item.pool_share_bps ?? null,
                currency: run.currency,
                gross_share: preview.gross,
                admin_share: preview.admin,
                claim_reserve_share: preview.claim_reserve,
                sku_direct_share: preview.sku_direct,
                sku_from_reserve_share: preview.sku_from_reserve,
                statutory_collective_share: preview.statutory_collective,
                net_claim_reserve_share: preview.net_claim_reserve,
                individual_net: preview.individual,
                status: "pending",
            }
        })

        const { error } = await db
            .from("rights_work_allocations")
            .insert(rows)

        if (error) throw error

        revalidatePath("/admin/rettighedsmidler")
        return { success: true, count: rows.length }
    } catch (err) {
        console.error("[rights-calculation] createWorkAllocations fejlede:", err)
        return { success: false, count: 0, error: String(err) }
    }
}
