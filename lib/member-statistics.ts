export type MemberSalaryBenchmarkRow = {
  holderId: string | null;
  weekly: number;
  contributes: boolean;
};

export type SalaryProductionGroup = "fiction" | "documentary";

export function salaryProductionGroup(value: unknown): SalaryProductionGroup | null {
  const normalized = String(value ?? "")
    .trim()
    .toLocaleLowerCase("da")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
  if (["documentary", "docseries", "dokumentar", "dokumentarfilm", "dokumentarserie"].includes(normalized)) {
    return "documentary";
  }
  if (["feature", "tvseries", "fiction", "fiktion", "drama", "spillefilm", "tvserie"].includes(normalized)) {
    return "fiction";
  }
  return null;
}

export function medianWeeklySalary(values: number[]) {
  const eligible = values.filter(value => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
  if (!eligible.length) return null;
  const middle = Math.floor(eligible.length / 2);
  return Math.round(eligible.length % 2 ? eligible[middle] : (eligible[middle - 1] + eligible[middle]) / 2);
}

export function memberSalaryBenchmark(
  rows: MemberSalaryBenchmarkRow[],
  minimumMembers: number,
  minimumContracts = 10,
) {
  const eligible = rows.filter(row => row.contributes && row.holderId && Number.isFinite(row.weekly) && row.weekly > 0);
  if (eligible.length < minimumContracts) return null;
  const byHolder = new Map<string, number[]>();
  for (const row of eligible) {
    const holderId = row.holderId as string;
    byHolder.set(holderId, [...(byHolder.get(holderId) ?? []), row.weekly]);
  }
  if (byHolder.size < minimumMembers) return null;
  const personMeans = [...byHolder.values()].map(values => values.reduce((sum, value) => sum + value, 0) / values.length);
  return medianWeeklySalary(personMeans);
}
