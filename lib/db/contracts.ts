import { createClient } from "@/lib/supabase/client"
import type { DbContract, DbContractAttachment, DbEmployer, DbEmployerRegistry } from "./types"

export type ContractWithRelations = DbContract & {
    employers: DbEmployer | null
    rettighedshavere: { id: string; full_name: string } | null
    works: { id: string; title: string } | null
    contract_attachments: DbContractAttachment[]
}

// Hent alle kontrakter i en org
export async function getContracts(orgId: string): Promise<ContractWithRelations[]> {
    const supabase = createClient()
    const { data } = await supabase
        .from("contracts")
        .select(`
            *,
            employers(id, name, cvr),
            rettighedshavere(id, full_name),
            works(id, title),
            contract_attachments(*)
        `)
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })

    return (data as ContractWithRelations[]) ?? []
}

// Hent én kontrakt
export async function getContract(id: string): Promise<ContractWithRelations | null> {
    const supabase = createClient()
    const { data } = await supabase
        .from("contracts")
        .select(`
            *,
            employers(id, name, cvr),
            rettighedshavere(id, full_name),
            works(id, title),
            contract_attachments(*)
        `)
        .eq("id", id)
        .single()

    return (data as ContractWithRelations) ?? null
}

// Opret kontrakt
export async function createContract(
    input: Pick<DbContract,
        "org_id" | "employer_id" | "rights_holder_id" | "work_id" |
        "type" | "overenskomst" | "pdf_url" | "contract_date" | "start_date" | "end_date"
    >
): Promise<DbContract | null> {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data, error } = await supabase
        .from("contracts")
        .insert({ ...input, created_by: user?.id ?? null })
        .select()
        .single()

    if (error) return null
    return data
}

// Opdater kontrakt
export async function updateContract(
    id: string,
    input: Partial<Pick<DbContract, "status" | "employer_id" | "rights_holder_id" | "work_id" | "type" | "overenskomst" | "pdf_url" | "contract_date" | "start_date" | "end_date">>
): Promise<void> {
    const supabase = createClient()
    await supabase.from("contracts").update(input).eq("id", id)
}

// Skift status
export async function setContractStatus(id: string, status: DbContract["status"]): Promise<void> {
    const supabase = createClient()
    await supabase.from("contracts").update({ status }).eq("id", id)
}

// Tilføj allonge/bilag
export async function addContractAttachment(
    input: Pick<DbContractAttachment, "contract_id" | "org_id" | "type" | "title" | "pdf_url">
): Promise<DbContractAttachment | null> {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data, error } = await supabase
        .from("contract_attachments")
        .insert({ ...input, created_by: user?.id ?? null })
        .select()
        .single()

    if (error) return null
    return data
}

// ── Arbejdsgivere ─────────────────────────────────────────────

export async function getEmployers(): Promise<DbEmployer[]> {
    const supabase = createClient()
    const { data } = await supabase
        .from("employers")
        .select("*")
        .order("name")

    return data ?? []
}

export async function createEmployer(
    input: Pick<DbEmployer, "name" | "cvr" | "address" | "contact_name" | "contact_email" | "contact_phone">
): Promise<DbEmployer | null> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from("employers")
        .insert(input)
        .select()
        .single()

    if (error) return null
    return data
}

export async function updateEmployer(
    id: string,
    input: Partial<Pick<DbEmployer, "name" | "cvr" | "address" | "contact_name" | "contact_email" | "contact_phone">>
): Promise<void> {
    const supabase = createClient()
    await supabase.from("employers").update(input).eq("id", id)
}

// Tjek om en arbejdsgiver er ProF-medlem — tjekker også moderselskabet via parent_id
export async function isProFMember(employerId: string): Promise<boolean> {
    const supabase = createClient()
    const today = new Date().toISOString().split("T")[0]

    // Find employer og eventuelt moderselskab
    const { data: emp } = await supabase
        .from("employers")
        .select("id, parent_id")
        .eq("id", employerId)
        .single()

    // Byg liste af IDs der skal tjekkes: selskabet selv + moderselskabet
    const idsToCheck = [employerId]
    if (emp?.parent_id) idsToCheck.push(emp.parent_id)

    const { data } = await supabase
        .from("employer_registries")
        .select("id")
        .in("employer_id", idsToCheck)
        .eq("association_name", "ProF")
        .or(`valid_to.is.null,valid_to.gte.${today}`)
        .limit(1)

    return (data?.length ?? 0) > 0
}

export async function getEmployerRegistries(employerId: string): Promise<DbEmployerRegistry[]> {
    const supabase = createClient()
    const { data } = await supabase
        .from("employer_registries")
        .select("*")
        .eq("employer_id", employerId)

    return data ?? []
}
