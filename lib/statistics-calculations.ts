import { statisticsBoolean, statisticsNumber } from "@/lib/statistics-values";

export type StatisticsContract = {
  id: string;
  type: string;
  premiereYear: number;
  extractedData: Record<string, unknown> | null;
};

export function salaryToMonthly(salary: number, unit: string) {
  if (unit === "weekly") return Math.round(salary * 52 / 12);
  if (unit === "daily") return Math.round(salary * 5 * 52 / 12);
  if (unit === "monthly") return salary;
  return Number.NaN;
}

export function salarySupplements(data: Record<string, unknown> | null | undefined) {
  const personalSupplement = statisticsNumber(data?.personalSupplement ?? data?.loentillaeg) ?? 0;
  const others = Array.isArray(data?.otherSupplements) ? (data.otherSupplements as Array<{ category?: string; amount?: unknown }>) : [];
  const structuredPostProduction = others
    .filter(supplement => supplement.category === "efterarbejde")
    .reduce((sum, supplement) => sum + (statisticsNumber(supplement.amount) ?? 0), 0);
  // Older extractions used one dedicated field. It is only a fallback: a
  // structured afterwork supplement is more precise and must never be counted
  // twice when both representations are present.
  const legacyPostProduction = structuredPostProduction > 0
    ? 0
    : statisticsNumber(data?.postProductionSupplement) ?? 0;
  return personalSupplement + structuredPostProduction + legacyPostProduction;
}

export function salaryDataToWeekly(data: Record<string, unknown> | null | undefined) {
  const salary = statisticsNumber(data?.salary);
  if (salary == null || salary <= 0) return Number.NaN;
  const unitValue = String(data?.salaryUnit ?? "").trim().toLocaleLowerCase("da");
  const unit = ["uge", "ugeløn", "week"].includes(unitValue) ? "weekly"
    : ["dag", "dagsløn", "day"].includes(unitValue) ? "daily"
      : ["måned", "månedsløn", "month"].includes(unitValue) ? "monthly"
        : unitValue;
  const baseWeekly = unit === "daily" ? salary * 5
    : unit === "monthly" ? salary * 12 / 52
    : unit === "weekly" ? salary
    : Number.NaN;
  return Number.isFinite(baseWeekly) ? baseWeekly + salarySupplements(data) : Number.NaN;
}

export function salaryDataToMonthly(data: Record<string, unknown> | null | undefined) {
  const weekly = salaryDataToWeekly(data);
  return Number.isFinite(weekly) ? Math.round(weekly * 52 / 12) : Number.NaN;
}

export function contributionForContract(contract: StatisticsContract) {
  const data = contract.extractedData;
  if (!data || (statisticsNumber(data.salary) ?? 0) <= 0) return null;
  const baseWeekly = salaryDataToWeekly(data);
  if (!Number.isFinite(baseWeekly)) return null;
  const weeks = statisticsNumber(data.workingWeeks) ?? 0;
  const totalSalary = Math.round(baseWeekly * weeks);
  const holidayRate = statisticsNumber(data.holidayPayRate) ?? Number.NaN;
  const betaRate = statisticsNumber(data.betaRate) ?? Number.NaN;
  const isFreelance = contract.type === "leverandør" || statisticsBoolean(data.isFreelanceContract) === true;
  return {
    year: contract.premiereYear,
    weeks,
    weeklyRate: baseWeekly,
    totalSalary,
    holidayPay: isFreelance ? 0 : Number.isFinite(holidayRate) ? Math.round(totalSalary * holidayRate / 100) : null,
    beta: isFreelance ? 0 : Number.isFinite(betaRate) ? Math.round(totalSalary * betaRate / 100) : null,
    holidayRate,
    betaRate,
    isFreelance,
  };
}

export function aggregateContributionsByYear(contracts: StatisticsContract[]) {
  const years = [...new Set(contracts.map(contract => contract.premiereYear))].sort();
  return years.map(year => {
    const yearContracts = contracts.filter(contract => contract.premiereYear === year);
    const rows = yearContracts.map(contributionForContract).filter((row): row is NonNullable<typeof row> => Boolean(row));
    const holidayRates = rows.map(row => row.holidayRate).filter(Number.isFinite);
    const betaRates = rows.map(row => row.betaRate).filter(Number.isFinite);
    const avgHolidayPayRate = holidayRates.length ? holidayRates.reduce((sum, rate) => sum + rate, 0) / holidayRates.length : 0;
    const avgBetaRate = betaRates.length ? betaRates.reduce((sum, rate) => sum + rate, 0) / betaRates.length : 0;
    return {
      year,
      avgHolidayPayRate: Math.round(avgHolidayPayRate * 10) / 10,
      avgBetaRate: Math.round(avgBetaRate * 100) / 100,
      totalHolidayPayAmount: rows.reduce((sum, row) => sum + (row.holidayPay ?? 0), 0),
      totalBetaAmount: rows.reduce((sum, row) => sum + (row.beta ?? 0), 0),
      incompleteContributionCount: rows.filter(row => row.holidayPay == null || row.beta == null).length,
      contractCount: yearContracts.length,
    };
  }).filter(row => row.contractCount > 0);
}
