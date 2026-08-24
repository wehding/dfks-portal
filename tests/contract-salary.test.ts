import test from "node:test"
import assert from "node:assert/strict"
import { resolveContractSalary } from "../lib/contract-salary"

test("omregner en tydelig klumpsum til ugeløn og bevarer totalbeløbet", () => {
  assert.deepEqual(resolveContractSalary({
    salary: 147200,
    salaryUnit: "total",
    salarySourceType: "lump_calculated",
    workingWeeks: 16,
    needsManualSalaryReview: true,
  }), {
    salary: 9200,
    salaryUnit: "weekly",
    salarySourceType: "lump_calculated",
    lumpSumAmount: 147200,
    workingWeeks: 16,
    salaryNote: "Samlet honorar 147.200 kr. for 16 uger. Ugeløn beregnet som 147.200 / 16 = 9.200 kr./uge.",
    needsManualSalaryReview: false,
  })
})

test("ændrer ikke en klumpsum når perioden mangler", () => {
  const data = { salary: 147200, salaryUnit: "total", workingWeeks: null }
  assert.equal(resolveContractSalary(data), data)
})

test("omregner ikke en allerede beregnet ugeløn igen", () => {
  const data = { salary: 9200, salaryUnit: "weekly", salarySourceType: "lump_calculated", workingWeeks: 16, lumpSumAmount: 147200 }
  assert.equal(resolveContractSalary(data), data)
})
