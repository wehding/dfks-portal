import assert from "node:assert/strict";
import test from "node:test";

import { adviceRuleCode, CONTRACT_ADVICE_SCHEMA_VERSION, normalizedAdviceCompliance } from "../lib/contract-advice-facts";

test("rådgivningsfund får stabile regelkoder uden at gemme fritekst i complianceudtrækket", () => {
  const result = normalizedAdviceCompliance({
    overblik: { overenskomst: "FAF dokumentar" },
    document_stage: "unsigned",
    agreement_status: "present",
    risk_level: "MELLEM",
    should_escalate: false,
    feedbackpunkter: [{ id: "fp1", titel: "Pension mangler", type: "kritisk", beskrivelse: "Personlig fritekst", citat: "Fortroligt citat" }],
  });
  assert.equal(result.schema_version, CONTRACT_ADVICE_SCHEMA_VERSION);
  assert.equal(result.document_stage, "unsigned");
  assert.equal(result.overenskomst_navn, "FAF dokumentar");
  assert.deepEqual(result.points, [{ point_id: "pension", severity: "HØJ", finding_status: "present", requires_producer_text: false }]);
  assert.equal(JSON.stringify(result).includes("Personlig fritekst"), false);
  assert.equal(JSON.stringify(result).includes("Fortroligt citat"), false);
});

test("AI-leverede regelkoder har forrang og normaliseres", () => {
  assert.equal(adviceRuleCode({ rule_code: "HYBRID-KONTRAKT", titel: "Anden titel" }), "hybrid_kontrakt");
});

test("ukendte fund udelades fra det lukkede statistikskema", () => {
  const result = normalizedAdviceCompliance({ feedbackpunkter: [{ id: "fp42", titel: "Et helt nyt frit emne", type: "info" }] });
  assert.deepEqual(result.points, []);
  assert.equal(result.document_stage, "unknown");
  assert.equal(result.agreement_status, "unknown");
});
