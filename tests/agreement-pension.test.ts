import test from "node:test";
import assert from "node:assert/strict";
import { applyAgreementPension, isSupplierContract, type AgreementPensionRule } from "../lib/agreement-pension";

function rule(overrides: Partial<AgreementPensionRule> = {}): AgreementPensionRule {
  return {
    id: "rule-1",
    agreementCode: "de4-fiction-2022",
    agreementTitle: "De4 Fiktionsoverenskomst 2022",
    agreementStatus: "approved",
    sourceUrl: "https://example.test/de4",
    productionTypes: ["feature", "tvSeries"],
    professionRoles: ["klipper"],
    employmentForm: "a-løn",
    employerPercent: 9.5,
    employeePercent: 0,
    basis: "normalløn",
    schemeKind: "occupational_pension",
    validFrom: "2022-02-07",
    validTo: null,
    sectionReference: "§ 3, stk. 4",
    sourceNote: null,
    status: "approved",
    ...overrides,
  };
}

const baseContract = {
  contractType: "a-løn",
  collectiveAgreement: true,
  overenskomst: "De4 Fiktion",
  productionType: "feature",
  creditedFunction: "Klipper",
  startDate: "2026-03-01",
};

test("adds pension from an approved agreement when the contract has no explicit pension", () => {
  const result = applyAgreementPension(baseContract, [rule()]);
  assert.equal(result.applied, true);
  assert.equal(result.data.pensionPercent, 9.5);
  assert.equal(result.data.pensionStatus, "inferred_agreement");
  assert.match(String(result.data.pensionTag), /via De4/);
  assert.match(String(result.data.pensionEvidence), /ikke særskilt angivet/);
});

test("never infers collective-agreement pension for a supplier contract", () => {
  const result = applyAgreementPension({ ...baseContract, contractType: "leverandør" }, [rule()]);
  assert.equal(isSupplierContract(result.data), true);
  assert.equal(result.applied, false);
  assert.equal(result.data.pensionStatus, "not_applicable");
  assert.equal(result.data.pensionPercent, undefined);
});

test("keeps an explicit supplier pension as an individual contract term", () => {
  const result = applyAgreementPension({ ...baseContract, contractType: "leverandør", pensionPercent: 6 }, [rule()]);
  assert.equal(result.applied, false);
  assert.equal(result.data.pensionStatus, "explicit_contract");
  assert.equal(result.data.pensionPercent, 6);
  assert.equal(result.data.pensionSourceType, "contract");
  assert.match(String(result.data.pensionTag), /individuelt kontraktvilkår/);
});

test("freelance wording alone does not classify a wage-earner freelancer as a supplier", () => {
  const tvRule = rule({
    agreementCode: "faf-tv-freelance-2008",
    agreementTitle: "FAF/DJ TV-overenskomst for lønmodtagerfreelancere",
    employmentForm: "lønmodtager-freelance",
    employerPercent: 9,
    employeePercent: 0.8,
    productionTypes: ["tvEntertainment"],
    professionRoles: ["redigering", "klipper"],
  });
  const result = applyAgreementPension({
    contractType: "a-løn",
    agreementEmploymentForm: "lønmodtager-freelance",
    collectiveAgreement: true,
    overenskomst: "FAF TV",
    productionType: "tvEntertainment",
    creditedFunction: "Redigering / klipper",
    startDate: "2026-01-01",
  }, [tvRule]);
  assert.equal(result.applied, true);
  assert.equal(result.data.pensionEmployerPercent, 9);
  assert.equal(result.data.pensionEmployeePercent, 0.8);
});

test("uses the date-specific DR and Dansk Metal rate", () => {
  const metalRules = [
    rule({ agreementCode: "dr-metal-2025", agreementTitle: "DR og Dansk Metal 2025-2028", employerPercent: 15, basis: "alle-løndele", validFrom: "2024-06-01", validTo: "2027-05-31", productionTypes: ["tvSeries"] }),
    rule({ id: "rule-2", agreementCode: "dr-metal-2025", agreementTitle: "DR og Dansk Metal 2025-2028", employerPercent: 16, basis: "alle-løndele", validFrom: "2027-06-01", validTo: "2028-05-31", productionTypes: ["tvSeries"] }),
  ];
  const result = applyAgreementPension({ ...baseContract, overenskomst: "Dansk Metal", employerName: "Danmarks Radio", productionType: "tvSeries", startDate: "2027-06-01" }, metalRules);
  assert.equal(result.applied, true);
  assert.equal(result.data.pensionPercent, 16);
});

test("requires date, production type and credited role before inferring", () => {
  const result = applyAgreementPension({ collectiveAgreement: true, overenskomst: "De4" }, [rule()]);
  assert.equal(result.applied, false);
  assert.equal(result.data.pensionStatus, "review_required");
});
