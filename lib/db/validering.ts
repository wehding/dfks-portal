import { createClient } from "@/lib/supabase/client"
import type { DbContractValidation } from "./types"

// Hent validering for en kontrakt
export async function getValidation(contractId: string): Promise<DbContractValidation | null> {
    const supabase = createClient()
    const { data } = await supabase
        .from("contract_validations")
        .select("*")
        .eq("contract_id", contractId)
        .single()

    return data ?? null
}

// Hent alle valideringer i en org
export async function getValidations(orgId: string): Promise<DbContractValidation[]> {
    const supabase = createClient()
    const { data } = await supabase
        .from("contract_validations")
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })

    return data ?? []
}

// Gem validering (upsert — én per kontrakt)
export async function saveValidation(
    input: Pick<DbContractValidation,
        "contract_id" | "org_id" |
        "holiday_pay_rate" | "beta_rate" |
        "has_credit_clause" | "has_termination_clause" |
        "termination_days_editor" | "termination_days_producer" |
        "has_indemnification" | "has_overenskomst_incorporation" |
        "notes"
    >
): Promise<DbContractValidation | null> {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data, error } = await supabase
        .from("contract_validations")
        .upsert(
            {
                ...input,
                validated_by: user?.id ?? null,
                validated_at: new Date().toISOString(),
            },
            { onConflict: "contract_id" }
        )
        .select()
        .single()

    if (error) return null
    return data
}
