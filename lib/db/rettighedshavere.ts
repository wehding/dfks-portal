import { createClient } from "@/lib/supabase/client"
import type { DbRettighedshaver, DbOrgAffiliation } from "./types"

export type RettighedshaverWithAffiliation = DbRettighedshaver & {
    org_affiliations: DbOrgAffiliation[]
}

const PUBLIC_RIGHTS_HOLDER_SELECT = `
    id,
    full_name,
    email,
    phone,
    address,
    created_at,
    user_id,
    onboarding_completed,
    archived_at,
    invite_sent_at,
    portal_invite_sent_at,
    dfi_person_id,
    tmdb_person_id,
    wikidata_id,
    gender,
    portrait_url,
    org_affiliations!inner(*)
`

// Hent alle rettighedshavere i min org
export async function getRettighedshavere(orgId: string): Promise<RettighedshaverWithAffiliation[]> {
    const supabase = createClient()
    const { data } = await supabase
        .from("rettighedshavere")
        .select(PUBLIC_RIGHTS_HOLDER_SELECT)
        .eq("org_affiliations.org_id", orgId)
        .order("full_name")

    return (data as unknown as RettighedshaverWithAffiliation[]) ?? []
}

// Hent én rettighedshaver
export async function getRettighedshaver(id: string): Promise<RettighedshaverWithAffiliation | null> {
    const supabase = createClient()
    const { data } = await supabase
        .from("rettighedshavere")
        .select(PUBLIC_RIGHTS_HOLDER_SELECT.replace("org_affiliations!inner(*)", "org_affiliations(*)"))
        .eq("id", id)
        .single()

    return (data as unknown as RettighedshaverWithAffiliation) ?? null
}

// Opret ny rettighedshaver (uden portallogin)
export async function createRettighedshaver(
    input: Pick<DbRettighedshaver, "full_name" | "email" | "phone" | "address" | "cpr_no" | "bank_account">,
    orgId: string,
    isMember: boolean,
    memberNo?: string
): Promise<DbRettighedshaver | null> {
    const supabase = createClient()

    const { data: rh, error } = await supabase
        .from("rettighedshavere")
        .insert(input)
        .select()
        .single()

    if (error || !rh) return null

    await supabase.from("org_affiliations").insert({
        org_id: orgId,
        rights_holder_id: rh.id,
        is_member: isMember,
        member_no: memberNo ?? null,
    })

    return rh
}

// Opdater rettighedshaver
export async function updateRettighedshaver(
    id: string,
    input: Partial<Pick<DbRettighedshaver, "full_name" | "email" | "phone" | "address" | "cpr_no">> & Record<string, unknown>
): Promise<void> {
    const supabase = createClient()
    await supabase
        .from("rettighedshavere")
        .update(input)
        .eq("id", id)
}

// Skift medlemsstatus
export async function setMemberStatus(
    rightsHolderId: string,
    orgId: string,
    isMember: boolean,
    memberNo?: string
): Promise<void> {
    const supabase = createClient()
    await supabase
        .from("org_affiliations")
        .update({
            is_member: isMember,
            member_no: memberNo ?? null,
        })
        .eq("rights_holder_id", rightsHolderId)
        .eq("org_id", orgId)
}

// Udmeld (sæt valid_to)
export async function setAffiliationEnd(
    rightsHolderId: string,
    orgId: string,
    validTo: string
): Promise<void> {
    const supabase = createClient()
    await supabase
        .from("org_affiliations")
        .update({ valid_to: validTo })
        .eq("rights_holder_id", rightsHolderId)
        .eq("org_id", orgId)
}

// Hent min egen profil (som portalbruger)
export async function getMyProfile(): Promise<DbRettighedshaver | null> {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data } = await supabase
        .from("rettighedshavere")
        .select("*")
        .eq("user_id", user.id)
        .single()

    return data ?? null
}

// Opdater min egen profil
export async function updateMyProfile(
    input: Partial<Pick<DbRettighedshaver, "full_name" | "email" | "phone" | "address">>
): Promise<void> {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase
        .from("rettighedshavere")
        .update(input)
        .eq("user_id", user.id)
}
