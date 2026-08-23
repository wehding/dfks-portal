import type { FilterRule } from "@/lib/streaming-types"

export type AftalelicensBatchFilterConfig = {
    localRules: FilterRule[]
    disabledGlobalRuleIds: string[]
}

export function combineAftalelicensFilterRules(
    globalRules: FilterRule[],
    config: AftalelicensBatchFilterConfig,
): FilterRule[] {
    const disabled = new Set(config.disabledGlobalRuleIds)
    return [
        ...globalRules
            .filter(rule => rule.active)
            .map(rule => ({ ...rule, scope: "global" as const, active: !disabled.has(rule.id) })),
        ...config.localRules.map(rule => ({ ...rule, scope: "local" as const })),
    ]
}

export function buildAftalelicensBatchFilterConfig(rules: FilterRule[]): AftalelicensBatchFilterConfig {
    return {
        localRules: rules.filter(rule => rule.scope === "local"),
        disabledGlobalRuleIds: rules
            .filter(rule => rule.scope === "global" && !rule.active)
            .map(rule => rule.id),
    }
}
