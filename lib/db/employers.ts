/**
 * lib/db/employers.ts
 *
 * CRUD for employers + producer list group memberships.
 *
 * Data model (existing tables):
 *   employers            — the company record, never deleted if referenced
 *   employer_registries  — group membership:
 *       association_name = group name (e.g. "ProF Fiktion")
 *       valid_to IS NULL  = active member
 *       valid_to NOT NULL = left (history preserved)
 */

import { createClient } from "@/lib/supabase/client"

export interface DbEmployer {
    id: string
    name: string
    cvr: string | null
    address: string | null
    contact_name: string | null
    contact_email: string | null
    contact_phone: string | null
    website: string | null
    associeret: boolean
    parent_id: string | null
    created_at: string
}

export interface DbEmployerWithGroup extends DbEmployer {
    group_name: string
    member_since: string | null
}

// ── Groups ────────────────────────────────────────────────────────────────────

/** All distinct active group names (ordered by first created) */
export async function getProducerGroups(): Promise<string[]> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from("employer_registries")
        .select("association_name, valid_from")
        .is("valid_to", null)
        .order("valid_from", { ascending: true })
    if (error || !data) return []
    const seen = new Set<string>()
    const groups: string[] = []
    for (const row of data) {
        if (!seen.has(row.association_name)) {
            seen.add(row.association_name)
            groups.push(row.association_name)
        }
    }
    return groups
}

// ── Members ───────────────────────────────────────────────────────────────────

/** All active members in a group */
export async function getGroupMembers(groupName: string): Promise<DbEmployerWithGroup[]> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from("employer_registries")
        .select(`
            association_name,
            valid_from,
            employers (
                id, name, cvr, address,
                contact_name, contact_email, contact_phone, website, associeret, parent_id,
                created_at
            )
        `)
        .eq("association_name", groupName)
        .is("valid_to", null)
        .order("valid_from", { ascending: true })
    if (error || !data) return []
    return (data as any[])
        .filter(r => r.employers)
        .map(r => ({
            ...r.employers,
            group_name: r.association_name,
            member_since: r.valid_from ?? null,
        }))
}

/** All employers NOT in any active group (for "non-members" panel) */
export async function getNonGroupEmployers(): Promise<DbEmployer[]> {
    const supabase = createClient()
    // Fetch all active member employer_ids
    const { data: memberIds } = await supabase
        .from("employer_registries")
        .select("employer_id")
        .is("valid_to", null)
    const ids = (memberIds ?? []).map((r: { employer_id: string }) => r.employer_id)

    const { data, error } = await supabase
        .from("employers")
        .select("id, name, cvr, address, contact_name, contact_email, contact_phone, website, associeret, parent_id, created_at")
        .order("name")
    if (error || !data) return []
    const idSet = new Set(ids)
    // Ekskludér underselskaber (parent_id IS NOT NULL) — de er bundet via moderselskabet
    return (data as DbEmployer[]).filter(e => !idSet.has(e.id) && !e.parent_id)
}

// ── Upsert + add to group ─────────────────────────────────────────────────────

export interface EmployerInput {
    name: string
    contact_name?: string | null
    contact_email?: string | null
    contact_phone?: string | null
    website?: string | null
    cvr?: string | null
    address?: string | null
}

/**
 * Find-or-create employer by name, then add to group.
 * Never creates duplicates — always searches by name first.
 * Returns the employer id.
 */
export async function upsertEmployerInGroup(
    input: EmployerInput,
    groupName: string
): Promise<string | null> {
    const supabase = createClient()

    // Normalize apostrophes/dashes (handles curly vs straight quotes from copy-paste)
    const normalizedName = input.name.trim()
        .replace(/[''ʼ´`]/g, "'")
        .replace(/[–—]/g, "-")
        .replace(/\s+/g, " ")

    // 1. Look for existing employer by name (case-insensitive)
    const { data: existing } = await supabase
        .from("employers")
        .select("id")
        .ilike("name", normalizedName)
        .maybeSingle()

    let employerId: string

    if (existing) {
        // Found — update contact info if provided, reuse the record
        employerId = existing.id
        const patch: Partial<EmployerInput> = {}
        if (input.contact_name  !== undefined) patch.contact_name  = input.contact_name
        if (input.contact_email !== undefined) patch.contact_email = input.contact_email
        if (input.contact_phone !== undefined) patch.contact_phone = input.contact_phone
        if (input.website       !== undefined) patch.website       = input.website
        if (Object.keys(patch).length) {
            await supabase.from("employers").update(patch).eq("id", employerId)
        }
    } else {
        // Not found — create new employer record
        const { data: newEmp } = await supabase
            .from("employers")
            .insert({
                name: normalizedName,
                contact_name:  input.contact_name  ?? null,
                contact_email: input.contact_email ?? null,
                contact_phone: input.contact_phone ?? null,
                website:       input.website       ?? null,
                cvr:           input.cvr           ?? null,
                address:       input.address       ?? null,
            })
            .select("id")
            .single()
        if (!newEmp) return null
        employerId = newEmp.id
    }

    // 2. Add to group (idempotent — skips if already active member)
    await addToGroup(employerId, groupName)
    return employerId
}

/** Add employer to group (idempotent — skips if already active member) */
export async function addToGroup(employerId: string, groupName: string): Promise<boolean> {
    const supabase = createClient()
    // Partial unique index on (employer_id, association_name) WHERE valid_to IS NULL
    // is not supported by PostgREST upsert, so we do a manual check-then-insert.
    const { data: existing } = await supabase
        .from("employer_registries")
        .select("employer_id")
        .eq("employer_id", employerId)
        .eq("association_name", groupName)
        .is("valid_to", null)
        .maybeSingle()
    if (existing) return true
    const { error } = await supabase
        .from("employer_registries")
        .insert({ employer_id: employerId, association_name: groupName, valid_from: new Date().toISOString().slice(0, 10) })
    return !error
}

// ── Remove / move ─────────────────────────────────────────────────────────────

/** Soft-delete membership (sets valid_to = today, preserves history) */
export async function removeFromGroup(employerId: string, groupName: string): Promise<boolean> {
    const supabase = createClient()
    const { error } = await supabase
        .from("employer_registries")
        .update({ valid_to: new Date().toISOString().slice(0, 10) })
        .eq("employer_id", employerId)
        .eq("association_name", groupName)
        .is("valid_to", null)
    return !error
}

/**
 * Slår op om et firma er underselskab af et ProF-medlem.
 * Returnerer moderselskabets navn hvis fundet, ellers null.
 */
export async function findParentMember(companyName: string): Promise<string | null> {
    const supabase = createClient()
    // Find firma ved navn (case-insensitiv)
    const { data: company } = await supabase
        .from("employers")
        .select("id, name, parent_id")
        .ilike("name", companyName.trim())
        .maybeSingle()
    if (!company?.parent_id) return null
    // Hent moderselskab
    const { data: parent } = await supabase
        .from("employers")
        .select("id, name")
        .eq("id", company.parent_id)
        .single()
    if (!parent) return null
    // Tjek om moderselskabet er aktivt ProF-medlem
    const { count } = await supabase
        .from("employer_registries")
        .select("*", { count: "exact", head: true })
        .eq("employer_id", parent.id)
        .is("valid_to", null)
    return (count ?? 0) > 0 ? parent.name : null
}

/** Tilknyt et underselskab til et moderselskab */
export async function setParentEmployer(childId: string, parentId: string | null): Promise<boolean> {
    const supabase = createClient()
    const { error } = await supabase
        .from("employers")
        .update({ parent_id: parentId })
        .eq("id", childId)
    return !error
}

/** Hent alle underselskaber for et givet moderselskab */
export async function getSubsidiaries(parentId: string): Promise<DbEmployer[]> {
    const supabase = createClient()
    const { data } = await supabase
        .from("employers")
        .select("id, name, cvr, address, contact_name, contact_email, contact_phone, website, associeret, parent_id, created_at")
        .eq("parent_id", parentId)
        .order("name")
    return (data ?? []) as DbEmployer[]
}

/** Sæt associeret-status på en employer */
export async function setAssocieret(employerId: string, associeret: boolean): Promise<boolean> {
    const supabase = createClient()
    const { error } = await supabase
        .from("employers")
        .update({ associeret })
        .eq("id", employerId)
    return !error
}

/** Tjek om en employer er i mindst én anden aktiv gruppe */
export async function getActiveGroupCount(employerId: string): Promise<number> {
    const supabase = createClient()
    const { count } = await supabase
        .from("employer_registries")
        .select("*", { count: "exact", head: true })
        .eq("employer_id", employerId)
        .is("valid_to", null)
    return count ?? 0
}

/** Move employer from one group to another */
export async function moveToGroup(
    employerId: string,
    fromGroup: string,
    toGroup: string
): Promise<boolean> {
    const removed = await removeFromGroup(employerId, fromGroup)
    if (!removed) return false
    return addToGroup(employerId, toGroup)
}

// ── Bulk import (from Excel / paste) ─────────────────────────────────────────

export interface BulkImportResult {
    inserted: number
    updated: number
    skipped: number
}

/**
 * Bulk-upsert a list of employers into a group.
 * Existing employers are updated with new contact info.
 * New employers are created and added to the group.
 */
export async function bulkImportToGroup(
    rows: EmployerInput[],
    groupName: string
): Promise<BulkImportResult> {
    const result: BulkImportResult = { inserted: 0, updated: 0, skipped: 0 }
    const supabase = createClient()

    // Fetch all existing employers (by name) in one query
    const { data: existing } = await supabase
        .from("employers")
        .select("id, name")
    const existingMap = new Map<string, string>(
        (existing ?? []).map((e: { id: string; name: string }) => [e.name.toLowerCase().trim(), e.id])
    )

    // Fetch all active memberships for this group
    const { data: members } = await supabase
        .from("employer_registries")
        .select("employer_id")
        .eq("association_name", groupName)
        .is("valid_to", null)
    const memberSet = new Set((members ?? []).map((m: { employer_id: string }) => m.employer_id))

    for (const row of rows) {
        const nameLc = row.name.toLowerCase().trim()
        const existingId = existingMap.get(nameLc)

        if (existingId) {
            // Opdater kun felter der har en ny ikke-null-værdi — slet ikke eksisterende data
            const patch: Record<string, string | null> = {}
            if (row.contact_name  != null) patch.contact_name  = row.contact_name
            if (row.contact_email != null) patch.contact_email = row.contact_email
            if (row.contact_phone != null) patch.contact_phone = row.contact_phone
            if (row.website       != null) patch.website       = row.website
            if (Object.keys(patch).length) {
                await supabase.from("employers").update(patch).eq("id", existingId)
            }

            if (!memberSet.has(existingId)) {
                await addToGroup(existingId, groupName)
                result.inserted++
            } else {
                result.updated++
            }
        } else {
            // Insert new employer
            const { data: newEmp } = await supabase
                .from("employers")
                .insert({
                    name: row.name,
                    contact_name: row.contact_name ?? null,
                    contact_email: row.contact_email ?? null,
                    contact_phone: row.contact_phone ?? null,
                    website: row.website ?? null,
                })
                .select("id")
                .single()
            if (newEmp) {
                await addToGroup(newEmp.id, groupName)
                result.inserted++
            } else {
                result.skipped++
            }
        }
    }

    return result
}

// ── Group management ──────────────────────────────────────────────────────────

/** Rename a group (updates all active memberships) */
export async function renameGroup(oldName: string, newName: string): Promise<boolean> {
    const supabase = createClient()
    const { error } = await supabase
        .from("employer_registries")
        .update({ association_name: newName })
        .eq("association_name", oldName)
        .is("valid_to", null)
    return !error
}

/** Soft-delete all active memberships in a group */
export async function deleteGroup(groupName: string): Promise<boolean> {
    const supabase = createClient()
    const { error } = await supabase
        .from("employer_registries")
        .update({ valid_to: new Date().toISOString().slice(0, 10) })
        .eq("association_name", groupName)
        .is("valid_to", null)
    return !error
}

/** Group member counts — returns { [groupName]: count } */
export async function getGroupMemberCounts(): Promise<Record<string, number>> {
    const supabase = createClient()
    const { data } = await supabase
        .from("employer_registries")
        .select("association_name")
        .is("valid_to", null)
    if (!data) return {}
    const counts: Record<string, number> = {}
    for (const row of data) {
        counts[row.association_name] = (counts[row.association_name] ?? 0) + 1
    }
    return counts
}
