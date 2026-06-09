import { createClient } from "@/lib/supabase/client"
import type { DbWork, DbWorkProductionNumber, DbEpisode, DbWorkAssignment } from "./types"

export type WorkWithRelations = DbWork & {
    employers: { id: string; name: string } | null
    work_production_numbers: DbWorkProductionNumber[]
    episodes: DbEpisode[]
    work_assignments: (DbWorkAssignment & {
        rettighedshavere: { id: string; full_name: string } | null
    })[]
}

// Hent alle værker i en org
export async function getWorks(orgId: string): Promise<WorkWithRelations[]> {
    const supabase = createClient()
    const { data } = await supabase
        .from("works")
        .select(`
            *,
            employers(id, name),
            work_production_numbers(*),
            episodes(*),
            work_assignments(*, rettighedshavere(id, full_name))
        `)
        .eq("org_id", orgId)
        .order("title")

    return (data as WorkWithRelations[]) ?? []
}

// Hent ét værk
export async function getWork(id: string): Promise<WorkWithRelations | null> {
    const supabase = createClient()
    const { data } = await supabase
        .from("works")
        .select(`
            *,
            employers(id, name),
            work_production_numbers(*),
            episodes(*),
            work_assignments(*, rettighedshavere(id, full_name))
        `)
        .eq("id", id)
        .single()

    return (data as WorkWithRelations) ?? null
}

// Hent mine værker (som rettighedshaver)
export async function getMyWorks(orgId: string): Promise<WorkWithRelations[]> {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    // Find rettighedshaver-id for denne bruger
    const { data: rh } = await supabase
        .from("rettighedshavere")
        .select("id")
        .eq("user_id", user.id)
        .single()

    if (!rh) return []

    const { data } = await supabase
        .from("works")
        .select(`
            *,
            employers(id, name),
            work_production_numbers(*),
            episodes(*),
            work_assignments!inner(*, rettighedshavere(id, full_name))
        `)
        .eq("org_id", orgId)
        .eq("work_assignments.rights_holder_id", rh.id)
        .order("title")

    return (data as WorkWithRelations[]) ?? []
}

// Opret værk
export async function createWork(
    input: Pick<DbWork, "org_id" | "employer_id" | "title" | "type" | "year" | "duration_minutes" | "episode_count" | "genre">
): Promise<DbWork | null> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from("works")
        .insert(input)
        .select()
        .single()

    if (error) return null
    return data
}

// Opdater værk
export async function updateWork(
    id: string,
    input: Partial<Pick<DbWork, "title" | "type" | "year" | "duration_minutes" | "episode_count" | "genre" | "status" | "employer_id">>
): Promise<void> {
    const supabase = createClient()
    await supabase.from("works").update(input).eq("id", id)
}

// ── Produktionsnumre ──────────────────────────────────────────

export async function addProductionNumber(
    workId: string,
    tvStation: string,
    number: string
): Promise<DbWorkProductionNumber | null> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from("work_production_numbers")
        .upsert(
            { work_id: workId, tv_station: tvStation, number },
            { onConflict: "work_id,tv_station" }
        )
        .select()
        .single()

    if (error) return null
    return data
}

// ── Episoder ──────────────────────────────────────────────────

export async function getEpisodes(workId: string): Promise<DbEpisode[]> {
    const supabase = createClient()
    const { data } = await supabase
        .from("episodes")
        .select("*")
        .eq("work_id", workId)
        .order("episode_number")

    return data ?? []
}

export async function upsertEpisode(
    input: Pick<DbEpisode, "work_id" | "episode_number" | "title" | "duration_minutes" | "produktionsnr">
): Promise<DbEpisode | null> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from("episodes")
        .upsert(input, { onConflict: "work_id,episode_number" })
        .select()
        .single()

    if (error) return null
    return data
}

// ── Arbejdsfordeling ──────────────────────────────────────────

export async function getWorkAssignments(workId: string): Promise<DbWorkAssignment[]> {
    const supabase = createClient()
    const { data } = await supabase
        .from("work_assignments")
        .select("*, rettighedshavere(id, full_name)")
        .eq("work_id", workId)

    return data ?? []
}

export async function addWorkAssignment(
    input: Pick<DbWorkAssignment, "work_id" | "episode_id" | "org_id" | "rights_holder_id" | "role" | "contract_id">
): Promise<DbWorkAssignment | null> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from("work_assignments")
        .insert(input)
        .select()
        .single()

    if (error) return null
    return data
}

export async function removeWorkAssignment(id: string): Promise<void> {
    const supabase = createClient()
    await supabase.from("work_assignments").delete().eq("id", id)
}
