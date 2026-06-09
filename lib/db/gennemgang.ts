import { createClient } from "@/lib/supabase/client"
import type { DbContractReview } from "./types"

// Gem AI-gennemgangsresultat
export async function saveReview(
    input: Pick<DbContractReview, "org_id" | "member_name" | "member_email" | "ai_result"> & {
        contract_id?: string
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
        })
        .select()
        .single()

    if (error) return null
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
