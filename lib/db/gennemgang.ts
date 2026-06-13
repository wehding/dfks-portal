import { createClient } from "@/lib/supabase/client"
import type { DbContractReview } from "./types"

// Gem AI-gennemgangsresultat
export async function saveReview(
    input: Pick<DbContractReview, "org_id" | "member_name" | "member_email" | "ai_result"> & {
        contract_id?: string
        member_id?: string
        file_name?: string
        file_size_bytes?: number
        contract_type?: string
        production_type?: string
        distribution_channels?: string[]
        producer_name?: string
        producer_dfks_id?: string
        producer_dfi_id?: string
        producer_overenskomst_bound?: boolean
        focus_areas?: string[]
        notes?: string
        ai_language?: string
    }
): Promise<DbContractReview | null> {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data, error } = await supabase
        .from("contract_reviews")
        .insert({
            ...input,
            contract_id: input.contract_id ?? null,
            reviewed_by: user?.id ?? null,
            status: "afventer",
        })
        .select()
        .single()

    if (error) {
        console.error("[saveReview]", error.message)
        return null
    }
    return data
}

// Hent alle gennemgange i en org
export async function getReviews(orgId: string): Promise<DbContractReview[]> {
    const supabase = createClient()
    const { data } = await supabase
        .from("contract_reviews")
        .select("*")
        .eq("org_id", orgId)
        .order("reviewed_at", { ascending: false })

    return data ?? []
}

// Hent én gennemgang
export async function getReview(id: string): Promise<DbContractReview | null> {
    const supabase = createClient()
    const { data } = await supabase
        .from("contract_reviews")
        .select("*")
        .eq("id", id)
        .single()

    return data ?? null
}
