export type MemberSalaryBenchmarkRow = {
  holderId: string | null;
  weekly: number;
  contributes: boolean;
};

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
  const personMeans = [...byHolder.values()].map(values => values.reduce((sum, value) => sum + value, 0) / values.length).sort((left, right) => left - right);
  const middle = Math.floor(personMeans.length / 2);
  return Math.round(personMeans.length % 2 ? personMeans[middle] : (personMeans[middle - 1] + personMeans[middle]) / 2);
}
