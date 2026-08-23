import test from "node:test"
import assert from "node:assert/strict"
import { resolveContractCredit } from "../lib/contract-credit"

test("udleder krediteringsrollen uden personens navn og bevarer klausul-id", () => {
  assert.deepEqual(resolveContractCredit({}, [
    "[s1_c9] 5. Kreditering",
    "[s1_c10] Der er aftalt følgende vedrørende kreditering: Klipper Sofie Steenberger",
  ].join("\n")), {
    creditedRoles: "Klipper",
    sourceText: "Der er aftalt følgende vedrørende kreditering: Klipper Sofie Steenberger",
    clauseId: "s1_c10",
  })
})

test("bevarer en eksplicit kreditering og dens AI-kilde", () => {
  assert.deepEqual(resolveContractCredit({
    creditedRoles: "Film Editor",
    _sources: {
      creditedRoles: "[s2_c4] Alex Jensen krediteres som Film Editor",
      creditedRoles_clause_id: "s2_c4",
    },
  }), {
    creditedRoles: "Film Editor",
    sourceText: "Alex Jensen krediteres som Film Editor",
    clauseId: "s2_c4",
  })
})
