import test from "node:test"
import assert from "node:assert/strict"
import { applyPercentageRule, type ApprovedPercentageRule } from "../lib/agreement-percentage-rule"

const rule: ApprovedPercentageRule = {
  id: "holiday-rule",
  agreementCode: "de4-fiktion",
  agreementTitle: "De4 Fiktionsoverenskomst",
  agreementStatus: "approved",
  labelKey: "helligdagsbetaling",
  label: "Helligdagsbetaling",
  percent: 1,
  basis: "salary",
  productionType: null,
  triggerCondition: null,
  sectionReference: null,
  validFrom: "2020-01-01",
  validTo: null,
  status: "approved",
}

const options = {
  labelKey: "helligdagsbetaling",
  contractField: "holidayPayRate",
  outputPrefix: "holidayPay",
  label: "Helligdagsbetaling",
  requiresEmployeeCoverage: true,
}

test("anvender ikke lønmodtagersats på leverandørens rettighedsreference", () => {
  const result = applyPercentageRule({
    contractType: "leverandør",
    isFreelanceContract: true,
    overenskomst: "de4-fiktion",
    collectiveAgreementByReference: true,
    _resolvedAgreementCode: "de4-fiktion",
  }, [rule], options)

  assert.equal(result.applied, false)
  assert.equal(result.reason, "supplier_rights_reference_only")
  assert.equal(result.data.holidayPayRate, undefined)
  assert.equal(result.data.collectiveAgreementByReference, true)
})

test("bevarer en sats der står eksplicit i leverandørkontrakten", () => {
  const result = applyPercentageRule({
    contractType: "leverandør",
    holidayPayRate: 2,
    _resolvedAgreementCode: "de4-fiktion",
  }, [rule], options)

  assert.equal(result.reason, "explicit_contract_term")
  assert.equal(result.data.holidayPayRate, 2)
})
