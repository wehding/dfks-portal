import test from "node:test"
import assert from "node:assert/strict"
import { resolveContractCredit } from "../lib/contract-credit"

test("udleder krediteringsrollen uden personens navn og bevarer klausul-id", () => {
  assert.deepEqual(resolveContractCredit({}, [
    "[s1_c9] 5. Kreditering",
    "[s1_c10] Der er aftalt følgende vedrørende kreditering: Klipper Sofie Steenberger",
  ].join("\n")), {
    contractCredits: [{ title: "Klipper", sourceText: "Der er aftalt følgende vedrørende kreditering: Klipper Sofie Steenberger", clauseId: "s1_c10" }],
    creditedRoles: "Klipper",
    creditClauseStatus: "precise",
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
    contractCredits: [{ title: "Film Editor", sourceText: "Alex Jensen krediteres som Film Editor", clauseId: "s2_c4" }],
    creditedRoles: "Film Editor",
    creditClauseStatus: "precise",
    sourceText: "Alex Jensen krediteres som Film Editor",
    clauseId: "s2_c4",
  })
})

test("udtrækker flere præcise krediteringer fra samme klausul", () => {
  const result = resolveContractCredit({}, "[s3_c2] Medarbejderen skal krediteres som Klipper og Konceptuerende klipper")
  assert.deepEqual(result.contractCredits.map(credit => credit.title), ["Konceptuerende klipper", "Klipper"])
  assert.equal(result.creditClauseStatus, "precise")
})
