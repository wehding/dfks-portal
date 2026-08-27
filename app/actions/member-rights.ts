"use server"

import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { requireMemberContext } from "@/lib/org"

export type MemberAllocation = {
    id: string
    run_id: string
    work_id: string | null
    episode_id: string | null
    role_label: string | null
    share_bps: number
    individual_net: number
    status: string
    withheld_reason: string | null
    created_at: string
    // Joins
    period_label: string
    fund_name: string
    fund_code: string
    currency: string
    work_title: string | null
    episode_title: string | null
    run_status: string
    booked_at: string | null
}

export type MemberEntitlementCase = {
    id: string
    status: string
    right_type: string
    work_title: string | null
    episode_title: string | null
    withheld_amount: number
    currency: string
    opened_at: string
    resolution_reason: string | null
}

export async function getMemberEntitlementCases(): Promise<{
    success: boolean
    cases: MemberEntitlementCase[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error("Ikke logget ind")
        const db = createServiceClient()
        const context = await requireMemberContext(db, user.id)
        if (!context?.rightsHolderId) throw new Error("Ingen rettighedshaver-profil fundet")

        const { data, error } = await db.from("rights_entitlement_cases").select(`
            id,status,right_type,opened_at,resolution_reason,
            works(title),episodes(title),
            withheld_beneficiary_positions(withheld_amount,currency)
        `).eq("org_id", context.orgId).eq("rights_holder_id", context.rightsHolderId)
          .order("opened_at", { ascending: false })
        if (error) throw error
        return {
            success: true,
            cases: (data ?? []).map((row: any) => ({
                id: row.id,
                status: row.status,
                right_type: row.right_type,
                work_title: row.works?.title ?? null,
                episode_title: row.episodes?.title ?? null,
                withheld_amount: Number(row.withheld_beneficiary_positions?.withheld_amount ?? 0),
                currency: row.withheld_beneficiary_positions?.currency ?? "DKK",
                opened_at: row.opened_at,
                resolution_reason: row.resolution_reason,
            })),
        }
    } catch (err) {
        console.error("[member-rights] getMemberEntitlementCases fejlede:", err)
        return { success: false, cases: [], error: String(err) }
    }
}

export async function getMemberAllocations(): Promise<{
    success: boolean
    allocations: MemberAllocation[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error("Ikke logget ind")

        const db = createServiceClient()
        const context = await requireMemberContext(db, user.id)
        if (!context?.rightsHolderId) throw new Error("Ingen rettighedshaver-profil fundet")

        const { data, error } = await db
            .from("rights_allocations")
            .select(`
                id, run_id, work_allocation_id, rights_holder_id, role_code,
                share_bps, individual_amount, status, blocked_reason, created_at,
                rights_work_allocations(work_id,episode_id,works(title),episodes(title)),
                rights_calculation_runs (
                    period_label, status, booked_at, currency,
                    rights_funds ( name, code )
                ),
                rettighedshavere ( full_name )
            `)
            .eq("rights_holder_id", context.rightsHolderId)
            .eq("org_id", context.orgId)
            .order("created_at", { ascending: false })

        if (error) throw error

        const allocations: MemberAllocation[] = (data ?? []).map((r: any) => ({
            id: r.id,
            run_id: r.run_id,
            work_id: r.rights_work_allocations?.work_id ?? null,
            episode_id: r.rights_work_allocations?.episode_id ?? null,
            role_label: r.role_code,
            share_bps: r.share_bps,
            individual_net: Number(r.individual_amount),
            status: r.status,
            withheld_reason: r.blocked_reason,
            created_at: r.created_at,
            period_label: r.rights_calculation_runs?.period_label ?? "—",
            fund_name: r.rights_calculation_runs?.rights_funds?.name ?? "—",
            fund_code: r.rights_calculation_runs?.rights_funds?.code ?? "—",
            currency: r.rights_calculation_runs?.currency ?? "DKK",
            work_title: r.rights_work_allocations?.works?.title ?? null,
            episode_title: r.rights_work_allocations?.episodes?.title ?? null,
            run_status: r.rights_calculation_runs?.status ?? "—",
            booked_at: r.rights_calculation_runs?.booked_at ?? null,
        }))

        return { success: true, allocations }
    } catch (err) {
        console.error("[member-rights] getMemberAllocations fejlede:", err)
        return { success: false, allocations: [], error: String(err) }
    }
}
