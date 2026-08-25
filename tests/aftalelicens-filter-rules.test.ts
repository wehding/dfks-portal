import assert from "node:assert/strict"
import test from "node:test"

import { buildAftalelicensBatchFilterConfig, combineAftalelicensFilterRules } from "../lib/aftalelicens-filter-rules"
import type { FilterRule } from "../lib/streaming-types"

const globalRule: FilterRule = {
    id: "global-sport",
    name: "Sport",
    type: "title_keyword",
    value: "sport",
    active: true,
    createdAt: "2026-08-23T00:00:00.000Z",
}

test("uses active Stamdata rules for a batch without hardcoded defaults", () => {
    const result = combineAftalelicensFilterRules([globalRule], { localRules: [], disabledGlobalRuleIds: [] })
    assert.deepEqual(result, [{ ...globalRule, scope: "global", active: true }])
    assert.deepEqual(combineAftalelicensFilterRules([], { localRules: [], disabledGlobalRuleIds: [] }), [])
})

test("can disable a Stamdata rule for one batch without deleting it globally", () => {
    const result = combineAftalelicensFilterRules([globalRule], { localRules: [], disabledGlobalRuleIds: [globalRule.id] })
    assert.equal(result[0].active, false)
    assert.equal(globalRule.active, true)
})

test("persists local rules and batch-specific global exclusions separately", () => {
    const localRule: FilterRule = { ...globalRule, id: "local-weather", name: "Vejret", value: "vejret", scope: "local" }
    const effective: FilterRule[] = [{ ...globalRule, scope: "global", active: false }, localRule]
    assert.deepEqual(buildAftalelicensBatchFilterConfig(effective), {
        localRules: [localRule],
        disabledGlobalRuleIds: [globalRule.id],
    })
})
