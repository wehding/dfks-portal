import test from "node:test";
import assert from "node:assert/strict";
import { applyAgreementWage, wageRulesToSatser, type AgreementWageRule } from "../lib/agreement-wage";

function rule(overrides: Partial<AgreementWageRule> = {}): AgreementWageRule {
  return {
    id: "wage-rule-1",
    agreementCode: "de4-fiction-2022",
    agreementTitle: "De4 Fiktionsoverenskomst 2022",
    agreementStatus: "approved",
    productionTypes: ["feature", "tvSeries"],
    professionRoles: ["klipper"],
    professionRole: "Klipper",
    wageGroup: "Løngruppe 2",
    employmentForm: "a-løn",
    rateKind: "normalløn",
    amount: 21500,
    currency: "DKK",
    unit: "uge",
    pensionIncluded: false,
    validFrom: "2022-02-07",
    validTo: null,
    sourceTitle: "De4 2022 lønskema",
    sourceUrl: null,
    sourceSection: "§ 4",
    sourceNote: null,
    status: "approved",
    ...overrides,
  };
}

const baseContract: Record<string, unknown> = {
  contractType: "a-løn",
  collectiveAgreement: true,
  agreementCode: "de4-fiction-2022",
  pensionAgreementCode: "de4-fiction-2022",
  agreementEmploymentForm: "a-løn",
  productionType: "feature",
  creditedFunction: "klipper",
  startDate: "2023-01-01",
};

test("applyAgreementWage: returnerer normalløn når kontrakt og regel matcher", () => {
  const result = applyAgreementWage(baseContract, [rule()]);
  assert.equal(result.applied, true);
  assert.equal(result.reason, "approved_agreement_rule");
  assert.equal(result.data.minimumWage, 21500);
  assert.equal(result.data.minimumWageCurrency, "DKK");
  assert.equal(result.data.minimumWageUnit, "uge");
  assert.equal(result.data.wageStatus, "inferred_agreement");
});

test("applyAgreementWage: leverandørkontrakt giver not_applicable", () => {
  const result = applyAgreementWage({ ...baseContract, contractType: "leverandør" }, [rule()]);
  assert.equal(result.applied, false);
  assert.equal(result.reason, "supplier_not_covered");
  assert.equal(result.data.wageStatus, "not_applicable");
});

test("applyAgreementWage: ingen overenskomst-reference giver unknown", () => {
  const result = applyAgreementWage({ ...baseContract, collectiveAgreement: false, pensionAgreementCode: "" }, [rule()]);
  assert.equal(result.applied, false);
  assert.equal(result.data.wageStatus, "unknown");
});

test("applyAgreementWage: manglende data giver review_required", () => {
  const result = applyAgreementWage({ ...baseContract, startDate: undefined, productionType: undefined }, [rule()]);
  assert.equal(result.applied, false);
  assert.equal(result.reason, "coverage_data_missing");
  assert.equal(result.data.wageStatus, "review_required");
});

test("applyAgreementWage: ingen matchende regel (forkert produktionstype)", () => {
  const r = rule({ productionTypes: ["documentary"] });
  const result = applyAgreementWage(baseContract, [r]);
  assert.equal(result.applied, false);
  assert.equal(result.reason, "no_approved_matching_rule");
});

test("applyAgreementWage: regel uden for gyldighedsperiode ignoreres", () => {
  const expiredRule = rule({ validTo: "2022-12-31" });
  const result = applyAgreementWage(baseContract, [expiredRule]);
  assert.equal(result.applied, false);
  assert.equal(result.reason, "no_approved_matching_rule");
});

test("applyAgreementWage: draft-regel ignoreres selv ved match", () => {
  const draftRule = rule({ status: "draft" });
  const result = applyAgreementWage(baseContract, [draftRule]);
  assert.equal(result.applied, false);
});

test("applyAgreementWage: detecterer løn under minimum", () => {
  const result = applyAgreementWage({ ...baseContract, weeklyWage: 18000 }, [rule()]);
  assert.equal(result.applied, true);
  assert.equal(result.data.minimumWageBelowMinimum, true);
});

test("applyAgreementWage: løn over minimum flagges korrekt", () => {
  const result = applyAgreementWage({ ...baseContract, weeklyWage: 25000 }, [rule()]);
  assert.equal(result.applied, true);
  assert.equal(result.data.minimumWageBelowMinimum, false);
});

test("wageRulesToSatser: konverterer godkendte regler til tekstformat", () => {
  const rules = [
    rule({ rateKind: "normalløn", amount: 21500, currency: "DKK", unit: "uge" }),
    rule({ id: "r2", rateKind: "helligdag", amount: 300, currency: "DKK", unit: "time" }),
    rule({ id: "r3", rateKind: "overtid", amount: 450, currency: "DKK", unit: "time", status: "draft" }),
  ];
  const satser = wageRulesToSatser(rules);
  assert.equal(satser.length, 2); // draft-reglen filtreres fra
  assert.equal(satser[0].beskrivelse, "normalløn: Klipper (Løngruppe 2)");
  assert.equal(satser[0].vaerdi, 21500);
  assert.equal(satser[0].enhed, "DKK/uge");
});
