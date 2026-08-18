import assert from "node:assert/strict";
import test from "node:test";
import { DataStandardizer } from "../lib/statistics/data-standardizer";
import { PayEquityAnalyzer, PayEquitySampleError, type PayEquityObservation } from "../lib/statistics/pay-equity-analyzer";
import { PrivacyGuard, dominanceRatio, sampleSizeBand } from "../lib/statistics/privacy-guard";
import { StatsCalculator } from "../lib/statistics/stats-calculator";

test("standardiserer fast løn, variable årsbeløb og timeløn uden dobbeltregning", () => {
  const result = new DataStandardizer().standardize({
    personKey: "pseudonym-key-0001", year: 2025, baseMonthlySalary: 40_000,
    employerPensionMonthly: 4_000, employeePensionMonthly: 2_000,
    recurringSupplementsMonthly: 1_000, annualBonus: 12_000, agreedMonthlyHours: 160,
  });
  assert.equal(result.fixedGrossMonthly, 46_000);
  assert.equal(result.totalMonthlyEarnings, 48_000);
  assert.equal(result.standardHourlyRate, 300);
});

test("outlierfilter bruger absolut grænse og Tukey ved mindst otte værdier", () => {
  const values = [200, 205, 210, 215, 220, 225, 230, 2_000];
  const result = new DataStandardizer().filterHourlyOutliers(values, value => value);
  assert.equal(result.bounds.method, "tukey_and_absolute");
  assert.deepEqual(result.excluded.map(item => item.item), [2_000]);
});

test("privacygrænsen kan skærpes, men aldrig sættes under tre", () => {
  assert.equal(new PrivacyGuard({ minimumGroupSize: 1 }).policy.minimumGroupSize, 3);
  assert.equal(new PrivacyGuard({ minimumGroupSize: 7 }).policy.minimumGroupSize, 7);
  assert.equal(sampleSizeBand(4), "3–4");
});

test("dominans og sekundær diskretion skjuler økonomiske celler", () => {
  assert.ok(dominanceRatio([80, 10, 10]) > 0.85);
  const protectedCells = new PrivacyGuard({ minimumGroupSize: 3 }).protectCells([
    { key: "a", contributorIds: ["1", "2"], contributions: [10, 10] },
    { key: "b", contributorIds: ["3", "4", "5"], contributions: [10, 10, 10] },
    { key: "c", contributorIds: ["6", "7", "8", "9"], contributions: [10, 10, 10, 10] },
  ], { additiveEconomicValues: true, hasPublishedTotal: true });
  assert.equal(protectedCells.filter(cell => cell.suppressed).length, 2);
  assert.ok(protectedCells.some(cell => cell.suppressionReason === "secondary"));
});

test("prisfremskrivning og regionalt indeks bruger forhold og ikke summerede satser", () => {
  const calculator = new StatsCalculator();
  assert.equal(calculator.inflateByIndex(100, 100, 110), 110);
  assert.equal(Math.round(calculator.projectWage(100, [0.05, 0.05]) * 100) / 100, 110.25);
  assert.equal(calculator.regionalIndex([108, 108, 108], [100, 100, 100]), 108);
});

function equityRows(): PayEquityObservation[] {
  return Array.from({ length: 50 }, (_, index) => {
    const female = index % 2 === 0;
    const experienceYears = 4 + (index % 10);
    const baseline = 30_000 + experienceYears * 1_000 + (index % 3) * 100;
    return {
      personKey: `person-${index}`, gender: female ? "female" : "male", grossPay: baseline * (female ? 0.9 : 1),
      educationLevel: "higher", educationDirection: "film", experienceYears, disco08: "2654",
      jobLevel: "editor", managementResponsibility: false, nuts3: "DK011",
    };
  });
}

test("ligelønsanalyse beregner justeret gap og tydeligt DFKS-forbehold", () => {
  const result = new PayEquityAnalyzer().analyze(equityRows());
  assert.equal(result.sampleSize, 50);
  assert.match(result.coverageDisclaimer, /kun validerede DFKS-medlemsdata/);
  assert.ok(result.adjustedGapPercent < -8 && result.adjustedGapPercent > -12);
  assert.equal(result.confidenceInterval95.length, 2);
});

test("ligelønsanalyse afviser for små stikprøver", () => {
  assert.throws(() => new PayEquityAnalyzer().analyze(equityRows().slice(0, 10)), PayEquitySampleError);
});
