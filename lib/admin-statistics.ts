import "server-only";

import { contributionForContract, salaryToMonthly } from "@/lib/statistics-calculations";
import { createServiceClient } from "@/lib/supabase/service";

export const MIN_STATISTICS_MEMBERS = 10;

type Filters = { year?: number | null; gender?: string | null; category?: string | null; contractType?: string | null; producerId?: string | null; professionType?: string | null };
type ContractRow = {
  id: string; rightsHolderId: string; employerId: string | null; type: string; startDate: string | null; contractDate: string | null;
  year: number; data: Record<string, unknown>;
};

function weeksInYear(startValue: string | null, endValue: string | null, totalWeeks: number, year: number) {
  if (!startValue || totalWeeks <= 0) return totalWeeks;
  const start = new Date(startValue);
  const end = endValue ? new Date(endValue) : new Date(start.getTime() + totalWeeks * 604_800_000);
  const overlapStart = new Date(Math.max(start.getTime(), new Date(year, 0, 1).getTime()));
  const overlapEnd = new Date(Math.min(end.getTime(), new Date(year + 1, 0, 1).getTime()));
  if (overlapEnd <= overlapStart) return 0;
  const totalDays = (end.getTime() - start.getTime()) / 86_400_000;
  return totalDays <= 0 ? totalWeeks : Math.round(totalWeeks * ((overlapEnd.getTime() - overlapStart.getTime()) / 86_400_000 / totalDays) * 10) / 10;
}

function groupSafe<T extends ContractRow>(rows: T[], key: (row: T) => string | number) {
  const groups = new Map<string | number, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return [...groups.entries()].filter(([, items]) => new Set(items.map(item => item.rightsHolderId)).size >= MIN_STATISTICS_MEMBERS);
}

export async function getAdminStatistics(orgId: string, filters: Filters) {
  const db = createServiceClient();
  const { data: holders, error: holderError } = await db.from("rettighedshavere")
    .select("id,org_affiliations!inner(org_id)")
    .eq("opt_out_statistics", false)
    .eq("org_affiliations.org_id", orgId);
  if (holderError) throw new Error(holderError.message);
  const allowedHolderIds = (holders ?? []).map(holder => holder.id as string);
  if (!allowedHolderIds.length) return { suppressed: true, minimum: MIN_STATISTICS_MEMBERS, memberCount: null, years: [] };

  const { data: contracts, error: contractError } = await db.from("contracts")
    .select("id,type,contract_date,start_date,rights_holder_id,employer_id")
    .eq("org_id", orgId)
    .in("rights_holder_id", allowedHolderIds)
    .in("status", ["valideret", "kladde"]);
  if (contractError) throw new Error(contractError.message);
  const ids = (contracts ?? []).map(contract => contract.id);
  const { data: validations, error: validationError } = ids.length
    ? await db.from("contract_validations").select("contract_id,extracted_data").eq("org_id", orgId).in("contract_id", ids)
    : { data: [], error: null };
  if (validationError) throw new Error(validationError.message);
  const validationMap = new Map((validations ?? []).map(row => [row.contract_id as string, (row.extracted_data ?? {}) as Record<string, unknown>]));
  const sourceRows: ContractRow[] = (contracts ?? []).flatMap(contract => {
    if (!contract.rights_holder_id) return [];
    const data = validationMap.get(contract.id) ?? {};
    const rawDate = data.startDate ?? contract.start_date ?? data.contractDate ?? contract.contract_date ?? null;
    const date = typeof rawDate === "string" ? rawDate : null;
    const year = date && !Number.isNaN(Date.parse(date)) ? new Date(date).getFullYear() : new Date().getFullYear();
    return [{ id: contract.id, rightsHolderId: contract.rights_holder_id, employerId: contract.employer_id, type: contract.type, startDate: contract.start_date, contractDate: contract.contract_date, year, data }];
  });
  const years = [...new Set(sourceRows.map(row => row.year))].sort((a, b) => b - a);
  const rows = sourceRows.filter(row => {
    if (filters.year && row.year !== filters.year) return false;
    if (filters.gender && row.data.gender !== filters.gender) return false;
    if (filters.category && row.data.productionType !== filters.category) return false;
    if (filters.contractType && row.type !== filters.contractType) return false;
    if (filters.producerId && row.employerId !== filters.producerId) return false;
    const profession = String(row.data.professionType ?? row.data.role ?? "").trim().toLocaleLowerCase("da");
    if (filters.professionType && profession !== filters.professionType.trim().toLocaleLowerCase("da")) return false;
    return true;
  });
  const memberCount = new Set(rows.map(row => row.rightsHolderId)).size;
  if (memberCount < MIN_STATISTICS_MEMBERS) return { suppressed: true, minimum: MIN_STATISTICS_MEMBERS, memberCount: null, years };

  const salary = groupSafe(rows.filter(row => Number(row.data.salary) > 0), row => row.year).map(([year, items]) => {
    const monthly = items.filter(row => row.type !== "leverandør").map(row => salaryToMonthly(Number(row.data.salary), String(row.data.salaryUnit ?? "monthly")));
    const daily = items.map(row => row.data.salaryUnit === "daily" ? Number(row.data.salary) : salaryToMonthly(Number(row.data.salary), String(row.data.salaryUnit ?? "monthly")) / (52 / 12 * 5));
    return { year: Number(year), monthlyRate: monthly.length ? Math.round(monthly.reduce((a, b) => a + b, 0) / monthly.length) : 0, dailyRate: Math.round(daily.reduce((a, b) => a + b, 0) / daily.length), memberCount: new Set(items.map(row => row.rightsHolderId)).size };
  }).sort((a, b) => a.year - b.year);

  const pension = groupSafe(rows.filter(row => Number(row.data.pensionPercent) > 0), row => row.year).map(([year, items]) => ({
    year: Number(year), avgPensionPercent: Math.round(items.reduce((sum, row) => sum + Number(row.data.pensionPercent), 0) / items.length * 10) / 10,
    memberCount: new Set(items.map(row => row.rightsHolderId)).size,
  })).sort((a, b) => a.year - b.year);

  const workingWeeks = groupSafe(rows.filter(row => Number(row.data.workingWeeks) > 0), row => row.year).map(([year, items]) => {
    const values = items.map(row => weeksInYear(typeof row.data.startDate === "string" ? row.data.startDate : row.startDate, typeof row.data.endDate === "string" ? row.data.endDate : null, Number(row.data.workingWeeks), Number(year))).filter(value => value > 0).sort((a, b) => a - b);
    return { year: Number(year), avgWeeks: Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10, medianWeeks: values[Math.floor(values.length / 2)], memberCount: new Set(items.map(row => row.rightsHolderId)).size };
  }).sort((a, b) => a.year - b.year);

  const contractCounts = groupSafe(rows, row => row.year).map(([year, items]) => ({
    year: Number(year), total: items.length, aLoen: items.filter(row => row.type === "a-løn").length,
    leverandoer: items.filter(row => row.type !== "a-løn").length, memberCount: new Set(items.map(row => row.rightsHolderId)).size,
  })).sort((a, b) => a.year - b.year);

  const rights = groupSafe(rows.filter(row => row.data.productionType), row => String(row.data.productionType)).map(([category, items]) => ({
    category: String(category), svodPercent: Math.round(items.filter(row => row.data.svod).length / items.length * 100),
    copydanPercent: Math.round(items.filter(row => row.data.copydan).length / items.length * 100), royaltyPercent: Math.round(items.filter(row => row.data.royalty).length / items.length * 100),
    memberCount: new Set(items.map(row => row.rightsHolderId)).size,
  }));

  const gender = groupSafe(rows.filter(row => row.data.gender), row => String(row.data.gender)).map(([genderKey, items]) => ({
    gender: String(genderKey), count: new Set(items.map(row => row.rightsHolderId)).size,
    avgSalary: Math.round(items.reduce((sum, row) => sum + Number(row.data.salary ?? 0), 0) / items.length),
  }));

  const aiClauses = groupSafe(rows, row => row.year).map(([year, items]) => ({
    year: Number(year), withClause: items.filter(row => row.data.aiDataMiningClause).length,
    withoutClause: items.filter(row => !row.data.aiDataMiningClause).length,
    pct: Math.round(items.filter(row => row.data.aiDataMiningClause).length / items.length * 100),
    memberCount: new Set(items.map(row => row.rightsHolderId)).size,
  })).sort((a, b) => a.year - b.year);

  const contributions = groupSafe(rows.filter(row => Number(row.data.salary) > 0), row => row.year).map(([year, items]) => {
    const values = items.map(row => contributionForContract({ id: row.id, premiereYear: row.year, type: row.type, extractedData: row.data })).filter(Boolean) as NonNullable<ReturnType<typeof contributionForContract>>[];
    return { year: Number(year), contractCount: items.length, totalHolidayPayAmount: Math.round(values.reduce((sum, value) => sum + value.holidayPay, 0)), totalBetaAmount: Math.round(values.reduce((sum, value) => sum + value.beta, 0)), memberCount: new Set(items.map(row => row.rightsHolderId)).size };
  }).sort((a, b) => a.year - b.year);

  return { suppressed: false, minimum: MIN_STATISTICS_MEMBERS, memberCount, contractCount: rows.length, years, salary, pension, workingWeeks, contractCounts, rights, gender, aiClauses, contributions };
}
