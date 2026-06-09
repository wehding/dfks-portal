import { createClient } from "@/lib/supabase/client"
import type { DbOrganisation, DbUserOrgRole } from "./types"

export async function getMyOrganisation(): Promise<DbOrganisation | null> {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data } = await supabase
        .from("user_org_roles")
        .select("org_id, organisations(*)")
        .eq("user_id", user.id)
        .limit(1)
        .single()

    return (data?.organisations as unknown as DbOrganisation) ?? null
}

export async function getMyOrgRole(): Promise<DbUserOrgRole | null> {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data } = await supabase
        .from("user_org_roles")
        .select("*")
        .eq("user_id", user.id)
        .limit(1)
        .single()

    return data ?? null
}

export async function getAllOrganisations(): Promise<DbOrganisation[]> {
    const supabase = createClient()
    const { data } = await supabase
        .from("organisations")
        .select("*")
        .order("name")

    return data ?? []
}
