import assert from "node:assert/strict";
import test from "node:test";
import { contractReadiness, effectiveCopydanStatus, hasCopydanAgreementReference, normalizeTriState, weeklySalaryWithPersonalSupplement } from "../lib/contract-list-status";

test("normaliserer gamle og nested AI-værdier", () => {
  assert.equal(normalizeTriState("implicit via overenskomst"), "implicit");
  assert.equal(normalizeTriState("uklart"), "unknown");
});

test("anbefaler med advarsler uden underskrift og overenskomst", () => {
  assert.equal(contractReadiness({
    status: "kladde",
    work_id: "work",
    employer_id: "producer",
    rights_holder_id: "holder",
    overenskomst: null,
    validation_data: { rightsOverview: { copydanforbehold: "implicit via overenskomst" }, signatureStatus: "unknown" },
  }), "recommended_with_warnings");
});

test("manglende værk eller producent giver ikke anbefaling", () => {
  assert.equal(contractReadiness({ status: "kladde", employer_id: "producer", rights_holder_id: "holder", validation_data: { copydan: true } }), "needs_information");
  assert.equal(contractReadiness({ status: "kladde", work_id: "work", rights_holder_id: "holder", validation_data: { copydan: true } }), "needs_information");
  assert.equal(contractReadiness({ status: "kladde", work_id: "work", employer_id: "producer", validation_data: { copydan: true } }), "needs_information");
});

test("ikke relevant kan opfylde rettighedskravet", () => {
  assert.equal(contractReadiness({ status: "kladde", work_id: "work", employer_id: "producer", rights_holder_id: "holder", overenskomst: "faf", validation_data: { rightsNotApplicable: true, signatureStatus: "yes" } }), "recommended");
});

test("direkte henvisning til de fem aftaler giver implicit Copydan", () => {
  for (const overenskomst of ["de4-fiktion", "faf", "faf-dokumentar", "dj", "metal"]) {
    const contract = { overenskomst, validation_data: { agreementReferenceStatus: "yes" } };
    assert.equal(hasCopydanAgreementReference(contract), true, overenskomst);
    assert.equal(effectiveCopydanStatus(contract), "implicit", overenskomst);
  }
});

test("aftalenavn og bekræftet henvisning kræves samtidig", () => {
  assert.equal(hasCopydanAgreementReference({ overenskomst: "faf", validation_data: { agreementReferenceStatus: "unknown" } }), false);
  assert.equal(hasCopydanAgreementReference({ overenskomst: "ingen", validation_data: { agreementReferenceStatus: "yes" } }), false);
  assert.equal(hasCopydanAgreementReference({ overenskomst: "faf", validation_data: { agreementReferenceStatus: "no", collectiveAgreement: true } }), false);
});

test("overenskomsthenvisning anbefaler med advarsel uden underskrift", () => {
  assert.equal(contractReadiness({
    status: "kladde",
    work_id: "work",
    employer_id: "producer",
    rights_holder_id: "holder",
    overenskomst: "de4-fiktion",
    validation_data: { agreementReferenceStatus: "yes", signatureStatus: "unknown" },
  }), "recommended_with_warnings");
});

test("ugelønsresume tæller aldrig to navne for samme personlige tillæg", () => {
  assert.equal(weeklySalaryWithPersonalSupplement({ salary: 15000, personalSupplement: 1000, loentillaeg: 2000, postProductionSupplement: 500 }), 16500);
  assert.equal(weeklySalaryWithPersonalSupplement({ salary: 15000, loentillaeg: 2000 }), 17000);
  assert.equal(weeklySalaryWithPersonalSupplement({ personalSupplement: 1000 }), null);
});
