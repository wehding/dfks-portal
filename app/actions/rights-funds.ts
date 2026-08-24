"use server"

import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { revalidatePath } from "next/cache"

const ADMIN_ORG_ROLES = ["superadmin", "admin", "org-admin"] as const

// ── Typer ────────────────────────────────────────────────────────────────────

export type RightsFund = {
    id: string
    org_id: string
    code: string
    name: string
    rights_category: string
    exploitation_type: "primary" | "secondary"
    calculation_method: "pool_weighted" | "individual_work" | "royalty_percentage"
    currency: string
    allowed_roles: string[]
    allowed_groups: string[]
    active: boolean
    notes: string | null
    created_at: string
    updated_at: string
}

export type DistributionPolicy = {
    id: string
    org_id: string
    fund_id: string
    name: string
    valid_from: string
    valid_to: string | null
    claim_period_years: number
    claim_period_start_rule: "end_of_usage_year" | "end_of_calculation_year" | "fixed_date"
    undistributable_treatment: "redistribute_by_work" | "transfer_to_collective" | "individual_redistribution" | "manual_decision"
    approval_body: string | null
    approved_at: string | null
    approval_ref: string | null
    four_eyes_required: boolean
    notes: string | null
    created_at: string
    updated_at: string
}

export type PolicyVersion = {
    id: string
    org_id: string
    policy_id: string
    version_number: number
    status: "draft" | "preview" | "active" | "superseded" | "archived"
    admin_rate_bps: number
    snapshot_components: PolicyComponent[]
    prepared_by: string | null
    approved_by: string | null
    activated_at: string | null
    used_in_calculation: boolean
    notes: string | null
    created_at: string
}

export type PolicyComponent = {
    id?: string
    org_id?: string
    policy_version_id?: string
    component_type: "CLAIM_RESERVE" | "SKU_DIRECT" | "SKU_FROM_RESERVE" | "STATUTORY_COLLECTIVE_SHARE"
    sort_order: number
    rate_bps: number
    calculation_basis: "GROSS" | "AFTER_ADMIN" | "ORIGINAL_CLAIM_RESERVE" | "REMAINING_INDIVIDUAL"
    is_statutory_collective: boolean
    label: string | null
    description: string | null
    active: boolean
}

export type PolicyVersionWithComponents = PolicyVersion & {
    components: PolicyComponent[]
}

// ── Beregningspreview ─────────────────────────────────────────────────────────

export type PolicyPreview = {
    gross: number
    admin: number
    distribution_basis: number
    claim_reserve: number
    sku_direct: number
    sku_from_reserve: number
    statutory_collective: number
    net_claim_reserve: number
    individual: number
    invariant_ok: boolean
}

export function computePolicyPreview(
    gross_minor: number,
    admin_rate_bps: number,
    components: PolicyComponent[]
): PolicyPreview {
    const bps = (n: number, rate: number) => Math.floor((n * rate) / 10000)

    const admin = bps(gross_minor, admin_rate_bps)
    const distribution_basis = gross_minor - admin

    // Hensættelse (CLAIM_RESERVE beregnes af AFTER_ADMIN)
    const reserveComp = components.find(
        c => c.component_type === "CLAIM_RESERVE" && c.active
    )
    const claim_reserve = reserveComp ? bps(distribution_basis, reserveComp.rate_bps) : 0

    // Direkte SKU (AFTER_ADMIN eller REMAINING_INDIVIDUAL)
    const sku_direct = components
        .filter(c => c.component_type === "SKU_DIRECT" && c.active)
        .reduce((sum, c) => {
            const base = c.calculation_basis === "AFTER_ADMIN" ? distribution_basis : distribution_basis - claim_reserve
            return sum + bps(base, c.rate_bps)
        }, 0)

    // SKU fra hensættelsen (beregnes altid af ORIGINAL_CLAIM_RESERVE)
    const sku_from_reserve = components
        .filter(c => c.component_type === "SKU_FROM_RESERVE" && c.active)
        .reduce((sum, c) => sum + bps(claim_reserve, c.rate_bps), 0)

    // Lovbestemt kollektiv andel
    const statutory_collective = components
        .filter(c => c.component_type === "STATUTORY_COLLECTIVE_SHARE" && c.active)
        .reduce((sum, c) => sum + bps(distribution_basis, c.rate_bps), 0)

    const net_claim_reserve = claim_reserve - sku_from_reserve
    const individual = distribution_basis - claim_reserve - sku_direct - statutory_collective

    const invariant_total = admin + individual + net_claim_reserve + sku_direct + sku_from_reserve + statutory_collective
    const invariant_ok = invariant_total === gross_minor

    return {
        gross: gross_minor,
        admin,
        distribution_basis,
        claim_reserve,
        sku_direct,
        sku_from_reserve,
        statutory_collective,
        net_claim_reserve,
        individual,
        invariant_ok,
    }
}

// ── Rights Funds ──────────────────────────────────────────────────────────────

export async function getRightsFunds(): Promise<{ success: boolean; funds: RightsFund[]; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        const db = createServiceClient()
        if (!caller) throw new Error("Ingen adgang")
        const orgId = caller.orgId

        const { data, error } = await db
            .from("rights_funds")
            .select("*")
            .eq("org_id", orgId)
            .order("name")

        if (error) throw error
        return { success: true, funds: (data ?? []) as RightsFund[] }
    } catch (err) {
        console.error("[rights-funds] getRightsFunds fejlede:", err)
        return { success: false, funds: [], error: String(err) }
    }
}

export async function createRightsFund(payload: {
    code: string
    name: string
    rights_category: string
    exploitation_type: "primary" | "secondary"
    calculation_method: "pool_weighted" | "individual_work" | "royalty_percentage"
    currency: string
    allowed_roles: string[]
    allowed_groups: string[]
    notes?: string
}): Promise<{ success: boolean; fund?: RightsFund; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        const db = createServiceClient()
        if (!caller) throw new Error("Ingen adgang")
        const orgId = caller.orgId

        const { data, error } = await db
            .from("rights_funds")
            .insert({ ...payload, org_id: orgId })
            .select()
            .single()

        if (error) throw error
        revalidatePath("/admin/stamdata")
        return { success: true, fund: data as RightsFund }
    } catch (err) {
        console.error("[rights-funds] createRightsFund fejlede:", err)
        return { success: false, error: String(err) }
    }
}

export async function updateRightsFund(
    id: string,
    patch: Partial<Pick<RightsFund, "name" | "rights_category" | "allowed_roles" | "allowed_groups" | "active" | "notes">>
): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        const db = createServiceClient()
        if (!caller) throw new Error("Ingen adgang")
        const orgId = caller.orgId

        const { error } = await db
            .from("rights_funds")
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq("id", id)
            .eq("org_id", orgId)

        if (error) throw error
        revalidatePath("/admin/stamdata")
        return { success: true }
    } catch (err) {
        console.error("[rights-funds] updateRightsFund fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Distribution Policies ─────────────────────────────────────────────────────

export async function getDistributionPolicies(fund_id: string): Promise<{ success: boolean; policies: DistributionPolicy[]; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        const db = createServiceClient()
        if (!caller) throw new Error("Ingen adgang")
        const orgId = caller.orgId

        const { data, error } = await db
            .from("distribution_policies")
            .select("*")
            .eq("org_id", orgId)
            .eq("fund_id", fund_id)
            .order("valid_from", { ascending: false })

        if (error) throw error
        return { success: true, policies: (data ?? []) as DistributionPolicy[] }
    } catch (err) {
        console.error("[rights-funds] getDistributionPolicies fejlede:", err)
        return { success: false, policies: [], error: String(err) }
    }
}

export async function createDistributionPolicy(payload: {
    fund_id: string
    name: string
    valid_from: string
    valid_to?: string | null
    claim_period_years?: number
    claim_period_start_rule?: DistributionPolicy["claim_period_start_rule"]
    undistributable_treatment?: DistributionPolicy["undistributable_treatment"]
    approval_body?: string | null
    approval_ref?: string | null
    four_eyes_required?: boolean
    notes?: string | null
}): Promise<{ success: boolean; policy?: DistributionPolicy; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        const db = createServiceClient()
        if (!caller) throw new Error("Ingen adgang")
        const orgId = caller.orgId

        const { data, error } = await db
            .from("distribution_policies")
            .insert({ ...payload, org_id: orgId })
            .select()
            .single()

        if (error) throw error
        revalidatePath("/admin/stamdata")
        return { success: true, policy: data as DistributionPolicy }
    } catch (err) {
        console.error("[rights-funds] createDistributionPolicy fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Policy Versions ───────────────────────────────────────────────────────────

export async function getPolicyVersions(policy_id: string): Promise<{ success: boolean; versions: PolicyVersionWithComponents[]; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        const db = createServiceClient()
        if (!caller) throw new Error("Ingen adgang")
        const orgId = caller.orgId

        const { data: versions, error: vErr } = await db
            .from("distribution_policy_versions")
            .select("*")
            .eq("org_id", orgId)
            .eq("policy_id", policy_id)
            .order("version_number", { ascending: false })

        if (vErr) throw vErr

        const versionIds = (versions ?? []).map(v => v.id)
        const { data: components, error: cErr } = await db
            .from("distribution_policy_components")
            .select("*")
            .in("policy_version_id", versionIds.length > 0 ? versionIds : ["00000000-0000-0000-0000-000000000000"])
            .order("sort_order")

        if (cErr) throw cErr

        const result: PolicyVersionWithComponents[] = (versions ?? []).map(v => ({
            ...(v as PolicyVersion),
            components: (components ?? []).filter(c => c.policy_version_id === v.id) as PolicyComponent[],
        }))

        return { success: true, versions: result }
    } catch (err) {
        console.error("[rights-funds] getPolicyVersions fejlede:", err)
        return { success: false, versions: [], error: String(err) }
    }
}

export async function createPolicyVersion(payload: {
    policy_id: string
    admin_rate_bps: number
    notes?: string | null
    components: Omit<PolicyComponent, "id" | "org_id" | "policy_version_id">[]
}): Promise<{ success: boolean; version?: PolicyVersionWithComponents; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        const db = createServiceClient()
        if (!caller) throw new Error("Ingen adgang")
        const orgId = caller.orgId

        // Find næste versionsnummer
        const { data: existing } = await db
            .from("distribution_policy_versions")
            .select("version_number")
            .eq("policy_id", payload.policy_id)
            .order("version_number", { ascending: false })
            .limit(1)
            .maybeSingle()

        const version_number = (existing?.version_number ?? 0) + 1

        const { data: version, error: vErr } = await db
            .from("distribution_policy_versions")
            .insert({
                org_id: orgId,
                policy_id: payload.policy_id,
                version_number,
                admin_rate_bps: payload.admin_rate_bps,
                notes: payload.notes ?? null,
                prepared_by: caller.userId,
                snapshot_components: payload.components,
            })
            .select()
            .single()

        if (vErr) throw vErr

        const componentRows = payload.components.map(c => ({
            ...c,
            org_id: orgId,
            policy_version_id: version.id,
        }))

        const { data: components, error: cErr } = await db
            .from("distribution_policy_components")
            .insert(componentRows)
            .select()

        if (cErr) throw cErr

        revalidatePath("/admin/stamdata")
        return {
            success: true,
            version: {
                ...(version as PolicyVersion),
                components: (components ?? []) as PolicyComponent[],
            },
        }
    } catch (err) {
        console.error("[rights-funds] createPolicyVersion fejlede:", err)
        return { success: false, error: String(err) }
    }
}

export async function activatePolicyVersion(
    version_id: string,
    policy_id: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        const db = createServiceClient()
        if (!caller) throw new Error("Ingen adgang")
        const orgId = caller.orgId

        // Hent versionen og verificer fire-øjne
        const { data: version, error: fetchErr } = await db
            .from("distribution_policy_versions")
            .select("prepared_by, status, used_in_calculation")
            .eq("id", version_id)
            .eq("org_id", orgId)
            .single()

        if (fetchErr) throw fetchErr
        if (version.status !== "draft" && version.status !== "preview") {
            throw new Error("Kun draft- og preview-versioner kan aktiveres.")
        }
        if (version.prepared_by === caller.userId) {
            throw new Error("Fire-øjne-krav: godkender og udarbejder skal være forskellige personer.")
        }

        // Sæt tidligere aktive versioner til superseded
        await db
            .from("distribution_policy_versions")
            .update({ status: "superseded" })
            .eq("policy_id", policy_id)
            .eq("org_id", orgId)
            .eq("status", "active")

        // Aktiver denne version
        const { error: activateErr } = await db
            .from("distribution_policy_versions")
            .update({
                status: "active",
                approved_by: caller.userId,
                activated_at: new Date().toISOString(),
            })
            .eq("id", version_id)
            .eq("org_id", orgId)

        if (activateErr) throw activateErr

        revalidatePath("/admin/stamdata")
        return { success: true }
    } catch (err) {
        console.error("[rights-funds] activatePolicyVersion fejlede:", err)
        return { success: false, error: String(err) }
    }
}
