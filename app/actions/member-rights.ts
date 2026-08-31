"use server"

import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { requireMemberContext } from "@/lib/org"
import { firstRelated } from "@/lib/supabase/relations"

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
                id, run_id, work_id, episode_id, role_label,
                share_bps, individual_net, status, withheld_reason, created_at,
                rights_calculation_runs (
                    period_label, status, booked_at, currency,
                    rights_funds ( name, code )
                ),
                works ( title ),
                episodes ( title )
            `)
            .eq("rights_holder_id", context.rightsHolderId)
            .eq("org_id", context.orgId)
            .order("created_at", { ascending: false })

        if (error) throw error

        const allocations: MemberAllocation[] = (data ?? []).map((r) => {
            const run = firstRelated(r.rights_calculation_runs)
            const fund = firstRelated(run?.rights_funds)
            const work = firstRelated(r.works)
            const episode = firstRelated(r.episodes)
            return {
            id: r.id,
            run_id: r.run_id,
            work_id: r.work_id,
            episode_id: r.episode_id,
            role_label: r.role_label,
            share_bps: r.share_bps,
            individual_net: Number(r.individual_net),
            status: r.status,
            withheld_reason: r.withheld_reason,
            created_at: r.created_at,
            period_label: run?.period_label ?? "—",
            fund_name: fund?.name ?? "—",
            fund_code: fund?.code ?? "—",
            currency: run?.currency ?? "DKK",
            work_title: work?.title ?? null,
            episode_title: episode?.title ?? null,
            run_status: run?.status ?? "—",
            booked_at: run?.booked_at ?? null,
        }})

        return { success: true, allocations }
    } catch (err) {
        console.error("[member-rights] getMemberAllocations fejlede:", err)
        return { success: false, allocations: [], error: String(err) }
    }
}
