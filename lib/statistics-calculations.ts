export type StatisticsContract = {
  id: string;
  type: string;
  premiereYear: number;
  extractedData: Record<string, any> | null;
};

export function salaryToMonthly(salary: number, unit: string) {
  if (unit === "weekly") return Math.round(salary * 52 / 12);
  if (unit === "daily") return Math.round(salary * 5 * 52 / 12);
  return salary;
}

export function contributionForContract(contract: StatisticsContract) {
  const data = contract.extractedData;
  if (!data?.salary) return null;
  const baseWeekly = data.salaryUnit === "weekly" ? data.salary
    : data.salaryUnit === "daily" ? data.salary * 5
    : data.salaryUnit === "monthly" ? Math.round(data.salary * 12 / 52)
    : data.salary;
  const weeks = Number(data.workingWeeks ?? 0);
  const totalSalary = Math.round(baseWeekly * weeks);
  const holidayRate = Number(data.holidayPayRate ?? 1);
  const betaRate = Number(data.betaRate ?? 0.5);
  const isFreelance = contract.type === "leverandør" || Boolean(data.isFreelanceContract);
  return {
    year: contract.premiereYear,
    weeks,
    weeklyRate: baseWeekly,
    totalSalary,
    holidayPay: isFreelance ? 0 : Math.round(totalSalary * holidayRate / 100),
    beta: isFreelance ? 0 : Math.round(totalSalary * betaRate / 100),
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
    const avgHolidayPayRate = rows.length ? rows.reduce((sum, row) => sum + row.holidayRate, 0) / rows.length : 0;
    const avgBetaRate = rows.length ? rows.reduce((sum, row) => sum + row.betaRate, 0) / rows.length : 0;
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
