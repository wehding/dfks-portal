import assert from "node:assert/strict";
import test from "node:test";
import { applyAgreementRoyalty, type AgreementRoyaltyRule } from "../lib/agreement-royalty";

const featureRule: AgreementRoyaltyRule = {
  id: "de4-royalty",
  agreementCode: "de4-fiktion",
  agreementTitle: "De4 Fiktionsoverenskomst 2022",
  agreementStatus: "approved",
  productionType: null,
  distributionType: null,
  percent: 1,
  basis: "Producentens indtægter fra spillefilm",
  sectionReference: "§ 22, stk. 2 a",
  validFrom: "2022-01-01",
  validTo: null,
  status: "approved",
};

test("De4-spillefilmsroyalty anvendes ikke på en tv-serie", () => {
  const result = applyAgreementRoyalty({
    _resolvedAgreementCode: "de4-fiktion",
    productionType: "tv-serie",
    startDate: "2024-01-01",
    royalty: false,
  }, [featureRule]);

  assert.equal(result.applied, true);
  assert.equal(result.reason, "not_applicable_production_type");
  assert.equal(result.data.royalty, false);
  assert.equal(result.data.royaltySourceType, "collective_agreement");
});

test("De4-spillefilmsroyalty anvendes på en spillefilm", () => {
  const result = applyAgreementRoyalty({
    _resolvedAgreementCode: "de4-fiktion",
    productionType: "spillefilm",
    startDate: "2024-01-01",
  }, [featureRule]);

  assert.equal(result.applied, true);
  assert.equal(result.data.royalty, true);
  assert.equal(result.data.royaltyPercent, 1);
});

test("ukendt produktionstype bliver ikke automatisk afvist", () => {
  const result = applyAgreementRoyalty({
    _resolvedAgreementCode: "de4-fiktion",
    startDate: "2024-01-01",
  }, [featureRule]);

  assert.equal(result.applied, false);
  assert.equal(result.reason, "no_matching_production_type");
});

test("en eksplicit royaltyprocent i kontrakten har forrang", () => {
  const result = applyAgreementRoyalty({
    _resolvedAgreementCode: "de4-fiktion",
    productionType: "tv-serie",
    royaltyPercent: 2.5,
  }, [featureRule]);

  assert.equal(result.applied, false);
  assert.equal(result.reason, "explicit_contract_term");
  assert.equal(result.data.royaltyPercent, 2.5);
  assert.equal(result.data.royaltySourceType, "individually_negotiated");
});
