import assert from "node:assert/strict"
import test from "node:test"

import { applyAftalelicensRerunFactor, markAftalelicensReruns } from "../lib/aftalelicens-reruns"
import type { AftalelicensVaerk } from "../lib/streaming-types"

function screening(overrides: Partial<AftalelicensVaerk>): AftalelicensVaerk {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        batchId: "batch",
        rawTitle: "Badehotellet",
        sortStatus: "approved",
        ...overrides,
    }
}

test("marks a later screening of the same episode within the rolling window", () => {
    const result = markAftalelicensReruns([
        screening({ id: "premiere", episodeId: "badehotellet-s6e6", season: 6, episode: 6, broadcastDate: "2026-07-11", broadcastTime: "20:00" }),
        screening({ id: "rerun", episodeId: "badehotellet-s6e6", season: 6, episode: 6, broadcastDate: "2026-07-19", broadcastTime: "11:00" }),
    ], 1)

    assert.equal(result[0].isGenudsendelse, false)
    assert.equal(result[1].isGenudsendelse, true)
})

test("does not treat different episodes in the same series as reruns", () => {
    const result = markAftalelicensReruns([
        screening({ id: "e5", episodeId: "badehotellet-s6e5", season: 6, episode: 5, broadcastDate: "2026-07-12" }),
        screening({ id: "e6", episodeId: "badehotellet-s6e6", season: 6, episode: 6, broadcastDate: "2026-07-19" }),
    ], 1)

    assert.equal(result[1].isGenudsendelse, false)
})

test("starts a new premiere period outside the rolling window", () => {
    const result = markAftalelicensReruns([
        screening({ id: "first", episodeId: "episode", broadcastDate: "2026-01-31" }),
        screening({ id: "outside", episodeId: "episode", broadcastDate: "2026-03-01" }),
        screening({ id: "second-rerun", episodeId: "episode", broadcastDate: "2026-03-15" }),
    ], 1)

    assert.deepEqual(result.map(item => item.isGenudsendelse), [false, false, true])
})

test("falls back to series, season and episode when episode_id is missing", () => {
    const result = markAftalelicensReruns([
        screening({ id: "first", season: 6, episode: 6, broadcastDate: "2026-07-11" }),
        screening({ id: "second", season: 6, episode: 6, broadcastDate: "2026-07-19" }),
    ], 1)

    assert.equal(result[1].isGenudsendelse, true)
})

test("applies the configured rerun factor to points", () => {
    assert.equal(applyAftalelicensRerunFactor(5_500, true, 0.5), 2_750)
    assert.equal(applyAftalelicensRerunFactor(5_500, false, 0.5), 5_500)
})
