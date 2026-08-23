import test from "node:test";
import assert from "node:assert/strict";
import { aggregateContributionsByYear, contributionForContract, salaryDataToMonthly, salaryDataToWeekly, salaryToMonthly } from "../lib/statistics-calculations";

test("normalizes weekly and daily salary to monthly", () => {
  assert.equal(salaryToMonthly(10_000, "weekly"), 43_333);
  assert.equal(salaryToMonthly(2_000, "daily"), 43_333);
});

test("manglende lønenhed bliver ikke antaget som ugeløn", () => {
  assert.equal(Number.isNaN(salaryDataToWeekly({ salary: 10_000 })), true);
  assert.equal(contributionForContract({ id: "a", type: "a-løn", premiereYear: 2025, extractedData: { salary: 10_000, workingWeeks: 10 } }), null);
});

test("adds personal and post-production supplements consistently", () => {
  const data = {
    salary: 10_000, salaryUnit: "weekly", personalSupplement: 1_000,
    otherSupplements: [{ category: "efterarbejde", amount: 500, unit: "pr. uge", note: "", sourceText: null }],
  };
  assert.equal(salaryDataToWeekly(data), 11_500);
  assert.equal(salaryDataToMonthly(data), 49_833);
  assert.equal(contributionForContract({ id: "a", type: "a-løn", premiereYear: 2025, extractedData: { ...data, workingWeeks: 2 } })?.totalSalary, 23_000);
});

test("uses legacy afterwork supplement only as a structured fallback", () => {
  assert.equal(salaryDataToWeekly({
    salary: 9_249,
    salaryUnit: "weekly",
    personalSupplement: 2_751,
    postProductionSupplement: 2_000,
  }), 14_000);
  assert.equal(salaryDataToWeekly({
    salary: 9_249,
    salaryUnit: "weekly",
    personalSupplement: 2_751,
    postProductionSupplement: 2_000,
    otherSupplements: [{ category: "efterarbejde", amount: 2_000 }],
  }), 14_000);
});

test("does not interpret legacy free-text supplements automatically", () => {
  assert.equal(salaryDataToWeekly({
    salary: 9_249,
    salaryUnit: "weekly",
    personalSupplement: 2_751,
    otherSupplements: "Efterarbejde 2.000 kr.",
  }), 12_000);
});

test("ignores the removed loentillaeg legacy field", () => {
  assert.equal(salaryDataToWeekly({
    salary: 10_000,
    salaryUnit: "weekly",
    loentillaeg: 2_000,
  }), 10_000);
});

test("aggregates actual producer contributions per year", () => {
  const rows = aggregateContributionsByYear([
    { id: "a", type: "a-løn", premiereYear: 2025, extractedData: { salary: 10_000, salaryUnit: "weekly", workingWeeks: 10, holidayPayRate: 1, betaRate: 0.5 } },
    { id: "b", type: "leverandør", premiereYear: 2025, extractedData: { salary: 10_000, salaryUnit: "weekly", workingWeeks: 10, holidayPayRate: 1, betaRate: 0.5 } },
  ]);
  assert.equal(rows[0].totalHolidayPayAmount, 1_000);
  assert.equal(rows[0].totalBetaAmount, 500);
  assert.equal(contributionForContract({ id: "b", type: "leverandør", premiereYear: 2025, extractedData: { salary: 10_000, salaryUnit: "weekly", workingWeeks: 10 } })?.holidayPay, 0);
});

test("manglende bidragssatser markeres som ukendte og tælles ikke som nul-aftaler", () => {
  const contribution = contributionForContract({ id: "a", type: "a-løn", premiereYear: 2025, extractedData: { salary: 10_000, salaryUnit: "weekly", workingWeeks: 10 } });
  assert.equal(contribution?.holidayPay, null);
  assert.equal(contribution?.beta, null);
});
