import assert from "node:assert/strict";
import test from "node:test";
import { contractReadiness, normalizeTriState } from "../lib/contract-list-status";

test("normaliserer gamle og nested AI-værdier", () => {
  assert.equal(normalizeTriState("implicit via overenskomst"), "implicit");
  assert.equal(normalizeTriState("uklart"), "unknown");
});

test("anbefaler med advarsler uden underskrift og overenskomst", () => {
  assert.equal(contractReadiness({
    status: "kladde",
    work_id: "work",
    employer_id: "producer",
    overenskomst: null,
    validation_data: { rightsOverview: { copydanforbehold: "implicit via overenskomst" }, signatureStatus: "unknown" },
  }), "recommended_with_warnings");
});

test("manglende værk eller producent giver ikke anbefaling", () => {
  assert.equal(contractReadiness({ status: "kladde", employer_id: "producer", validation_data: { copydan: true } }), "needs_information");
  assert.equal(contractReadiness({ status: "kladde", work_id: "work", validation_data: { copydan: true } }), "needs_information");
});

test("ikke relevant kan opfylde rettighedskravet", () => {
  assert.equal(contractReadiness({ status: "kladde", work_id: "work", employer_id: "producer", overenskomst: "faf", validation_data: { rightsNotApplicable: true, signatureStatus: "yes" } }), "recommended");
});
