function positiveNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function formatDanishAmount(value: number) {
  return value.toLocaleString("da-DK", { maximumFractionDigits: 2 })
}

/**
 * AI'en finder ofte både klumpsum og periode korrekt, men kan alligevel lægge
 * totalbeløbet i salary. Gør den simple division deterministisk, så statistik
 * altid modtager en ugeløn, mens kontraktens oprindelige beløb bevares separat.
 */
export function resolveContractSalary(data: Record<string, unknown>) {
  const salary = positiveNumber(data.salary)
  const weeks = positiveNumber(data.workingWeeks)
  const isUnconvertedLumpSum = data.salaryUnit === "total" && salary !== null && weeks !== null

  if (!isUnconvertedLumpSum) return data

  const weeklySalary = Math.round((salary / weeks) * 100) / 100
  return {
    ...data,
    salary: weeklySalary,
    salaryUnit: "weekly",
    salarySourceType: "lump_calculated",
    lumpSumAmount: positiveNumber(data.lumpSumAmount) ?? salary,
    salaryNote: `Samlet honorar ${formatDanishAmount(salary)} kr. for ${formatDanishAmount(weeks)} uger. Ugeløn beregnet som ${formatDanishAmount(salary)} / ${formatDanishAmount(weeks)} = ${formatDanishAmount(weeklySalary)} kr./uge.`,
    needsManualSalaryReview: false,
  }
}
