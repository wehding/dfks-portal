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

export function contributionForContract(contract: StatisticsContract) {
  const data = contract.extractedData;
  if (!data?.salary) return null;
  const salary = Number(data.salary);
  const baseWeekly = data.salaryUnit === "weekly" ? salary
    : data.salaryUnit === "daily" ? salary * 5
    : data.salaryUnit === "monthly" ? Math.round(salary * 12 / 52)
    : salary;
  const weeks = Number(data.workingWeeks ?? 0);
  const totalSalary = Math.round(baseWeekly * weeks);
  const holidayRate = Number(data.holidayPayRate);
  const betaRate = Number(data.betaRate);
  const isFreelance = contract.type === "leverandør" || Boolean(data.isFreelanceContract);
  return {
    year: contract.premiereYear,
    weeks,
    weeklyRate: baseWeekly,
    totalSalary,
    holidayPay: isFreelance || !Number.isFinite(holidayRate) ? 0 : Math.round(totalSalary * holidayRate / 100),
    beta: isFreelance || !Number.isFinite(betaRate) ? 0 : Math.round(totalSalary * betaRate / 100),
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
      totalHolidayPayAmount: rows.reduce((sum, row) => sum + row.holidayPay, 0),
      totalBetaAmount: rows.reduce((sum, row) => sum + row.beta, 0),
      contractCount: yearContracts.length,
    };
  }).filter(row => row.contractCount > 0);
}
