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

    const reserveComp = components.find(
        c => c.component_type === "CLAIM_RESERVE" && c.active
    )
    const claim_reserve = reserveComp ? bps(distribution_basis, reserveComp.rate_bps) : 0

    const sku_direct = components
        .filter(c => c.component_type === "SKU_DIRECT" && c.active)
        .reduce((sum, c) => {
            const base = c.calculation_basis === "AFTER_ADMIN" ? distribution_basis : distribution_basis - claim_reserve
            return sum + bps(base, c.rate_bps)
        }, 0)

    const sku_from_reserve = components
        .filter(c => c.component_type === "SKU_FROM_RESERVE" && c.active)
        .reduce((sum, c) => sum + bps(claim_reserve, c.rate_bps), 0)

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
