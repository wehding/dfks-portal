import "server-only";

import { contributionForContract, salaryDataToMonthly, salaryDataToWeekly } from "@/lib/statistics-calculations";
import { createServiceClient } from "@/lib/supabase/service";
import { experienceGroupAt, type ExperienceGroup } from "@/lib/experience-groups";

export const MIN_STATISTICS_CONTRACTS = 1;
export const LOW_SAMPLE_CONTRACTS = 5;

export type StatisticsFilters = {
  years?: number[];
  gender?: string | null;
  categories?: string[];
  contractType?: string | null;
  producerIds?: string[];
  producerTypeCodes?: string[];
  membershipTypes?: string[];
  professionType?: string | null;
  experienceGroup?: ExperienceGroup | null;
};

type FactRow = {
  contract_id: string;
  rights_holder_id: string;
  contract_status: "valideret" | "kladde";
  contract_type: string;
  period_year: number;
  profession_type: string | null;
  production_type: string | null;
  gender: string | null;
  primary_profession_type_id: string | null;
  professional_start_year: number | null;
  usual_work_mode: string | null;
  primary_work_region_code: string | null;
  producer_ids: string[] | null;
  producer_type_codes: string[] | null;
  membership_types: string[] | null;
  statistics_data: Record<string, unknown> | null;
  start_date: string | null;
  contract_date: string | null;
};

type ContractRow = {
  id: string;
  rightsHolderId: string;
  status: "valideret" | "kladde";
  producerIds: string[];
  producerTypeCodes: string[];
  membershipTypes: string[];
  type: string;
  startDate: string | null;
  contractDate: string | null;
  year: number;
  category: string | null;
  gender: string | null;
  professionType: string;
  professionalStartYear: number | null;
  usualWorkMode: string | null;
  primaryWorkRegionCode: string | null;
  data: Record<string, unknown>;
};

function overlaps(left: string[], right?: string[]) {
  return !right?.length || right.some(value => left.includes(value));
}

function sampleMeta(items: ContractRow[]) {
  return {
    contractCount: items.length,
    memberCount: new Set(items.map(item => item.rightsHolderId)).size,
    validatedCount: items.filter(item => item.status === "valideret").length,
    draftCount: items.filter(item => item.status === "kladde").length,
    lowSample: items.length < LOW_SAMPLE_CONTRACTS,
  };
}

function groupSafe<T extends ContractRow>(rows: T[], key: (row: T) => string | number) {
  const groups = new Map<string | number, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return [...groups.entries()].filter(([, items]) => items.length >= MIN_STATISTICS_CONTRACTS);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function personWeighted(items: ContractRow[], value: (row: ContractRow) => number) {
  const byPerson = new Map<string, number[]>();
  for (const item of items) {
    const calculated = value(item);
    if (!Number.isFinite(calculated) || calculated <= 0) continue;
    byPerson.set(item.rightsHolderId, [...(byPerson.get(item.rightsHolderId) ?? []), calculated]);
  }
  const values = [...byPerson.values()].map(rows => rows.reduce((sum, row) => sum + row, 0) / rows.length);
  return {
    median: Math.round(median(values)),
    average: values.length ? Math.round(values.reduce((sum, row) => sum + row, 0) / values.length) : 0,
  };
}

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

type RightsStatus = "explicit_yes" | "explicit_no" | "implicit_by_agreement" | "unknown";

function rightsStatus(row: ContractRow, keys: string[]): RightsStatus {
  const value = keys.map(key => row.data[key]).find(candidate => candidate !== undefined && candidate !== null && candidate !== "");
  if (value === true || value === "yes" || value === "ja" || value === "explicit_yes") return "explicit_yes";
  if (value === false || value === "no" || value === "nej" || value === "explicit_no") return "explicit_no";
  if (value === "implicit_by_agreement" || value === "implicit") return "implicit_by_agreement";
  const agreement = row.data.collectiveAgreement ?? row.data.overenskomst ?? row.data.overenskomstIdentified;
  return agreement === true || agreement === "yes" || agreement === "ja" ? "implicit_by_agreement" : "unknown";
}

function rightsDistribution(items: ContractRow[], keys: string[]) {
  const statuses = items.map(item => rightsStatus(item, keys));
  const known = statuses.filter(status => status !== "unknown");
  const positive = known.filter(status => status === "explicit_yes" || status === "implicit_by_agreement").length;
  return {
    yesPercent: known.length ? Math.round(positive / known.length * 100) : 0,
    unknownCount: statuses.filter(status => status === "unknown").length,
  };
}

export async function getAdminStatistics(orgId: string, filters: StatisticsFilters) {
  const db = createServiceClient();
  const { data: organisation, error: organisationError } = await db.from("organisations")
    .select("statistics_contract_scope").eq("id", orgId).single();
  if (organisationError) throw new Error(organisationError.message);
  const includeDrafts = organisation.statistics_contract_scope === "validated_and_drafts";
  const { data, error } = await db.rpc("get_statistics_facts", {
    target_org_id: orgId,
    include_drafts: includeDrafts,
  });
  if (error) throw new Error(error.message);

  const sourceRows: ContractRow[] = ((data ?? []) as FactRow[]).map(fact => ({
    id: fact.contract_id,
    rightsHolderId: fact.rights_holder_id,
    status: fact.contract_status,
    producerIds: fact.producer_ids ?? [],
    producerTypeCodes: fact.producer_type_codes ?? [],
    membershipTypes: fact.membership_types ?? [],
    type: fact.contract_type,
    startDate: fact.start_date,
    contractDate: fact.contract_date,
    year: Number(fact.period_year),
    category: fact.production_type,
    gender: fact.gender,
    professionType: String(fact.profession_type ?? "").trim().toLocaleLowerCase("da"),
    professionalStartYear: fact.professional_start_year == null ? null : Number(fact.professional_start_year),
    usualWorkMode: fact.usual_work_mode,
    primaryWorkRegionCode: fact.primary_work_region_code,
    data: fact.statistics_data ?? {},
  }));
  const years = [...new Set(sourceRows.map(row => row.year))].sort((a, b) => b - a);
  const rows = sourceRows.filter(row => {
    if (filters.years?.length && !filters.years.includes(row.year)) return false;
    if (filters.gender && row.gender !== filters.gender) return false;
    if (filters.categories?.length && (!row.category || !filters.categories.includes(row.category))) return false;
    if (filters.contractType && row.type !== filters.contractType) return false;
    if (!overlaps(row.producerIds, filters.producerIds)) return false;
    if (!overlaps(row.producerTypeCodes, filters.producerTypeCodes)) return false;
    if (filters.membershipTypes?.length) {
      const memberships = row.membershipTypes.length ? row.membershipTypes : ["none"];
      if (!overlaps(memberships, filters.membershipTypes)) return false;
    }
    if (filters.professionType && row.professionType !== filters.professionType.trim().toLocaleLowerCase("da")) return false;
    if (filters.experienceGroup && experienceGroupAt(row.professionalStartYear, row.year) !== filters.experienceGroup) return false;
    return true;
  });

  if (rows.length < MIN_STATISTICS_CONTRACTS) {
    return {
      suppressed: true,
      minimum: MIN_STATISTICS_CONTRACTS,
      lowSampleThreshold: LOW_SAMPLE_CONTRACTS,
      contractCount: rows.length,
      years,
      includeDrafts,
    };
  }

  const salary = groupSafe(rows.filter(row => Number(row.data.salary) > 0), row => row.year).map(([year, items]) => {
    const monthly = personWeighted(items.filter(row => row.type !== "leverandør"), row => salaryDataToMonthly(row.data));
    const daily = personWeighted(items, row => salaryDataToWeekly(row.data) / 5);
    return {
      year: Number(year),
      monthlyRate: monthly.median,
      averageMonthlyRate: monthly.average,
      dailyRate: daily.median,
      ...sampleMeta(items),
    };
  }).sort((left, right) => left.year - right.year);

  const salaryByCategory = groupSafe(
    rows.filter(row => Number(row.data.salary) > 0 && (row.category === "feature" || row.category === "documentary")),
    row => `${row.year}:${row.category}`,
  ).map(([key, items]) => {
    const [year, category] = String(key).split(":");
    const values = personWeighted(items, row => salaryDataToMonthly(row.data));
    return { year: Number(year), category, monthlyRate: values.median, averageMonthlyRate: values.average, ...sampleMeta(items) };
  }).sort((left, right) => left.year - right.year || left.category.localeCompare(right.category));

  const pension = groupSafe(rows.filter(row => Number(row.data.pensionPercent) > 0), row => row.year).map(([year, items]) => ({
    year: Number(year),
    avgPensionPercent: Math.round(items.reduce((sum, row) => sum + Number(row.data.pensionPercent), 0) / items.length * 10) / 10,
    ...sampleMeta(items),
  })).sort((left, right) => left.year - right.year);

  const workingWeeks = groupSafe(rows.filter(row => Number(row.data.workingWeeks) > 0), row => row.year).map(([year, items]) => {
    const values = items.map(row => weeksInYear(
      typeof row.data.startDate === "string" ? row.data.startDate : row.startDate,
      typeof row.data.endDate === "string" ? row.data.endDate : null,
      Number(row.data.workingWeeks),
      Number(year),
    )).filter(value => value > 0).sort((a, b) => a - b);
    return { year: Number(year), avgWeeks: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10, medianWeeks: values[Math.floor(values.length / 2)], ...sampleMeta(items) };
  }).sort((left, right) => left.year - right.year);

  const contractCounts = groupSafe(rows, row => row.year).map(([year, items]) => ({
    year: Number(year),
    total: items.length,
    aLoen: items.filter(row => row.type === "a-løn").length,
    leverandoer: items.filter(row => row.type !== "a-løn").length,
    ...sampleMeta(items),
  })).sort((left, right) => left.year - right.year);

  const rights = groupSafe(rows.filter(row => row.category), row => String(row.category)).map(([category, items]) => {
    const streaming = rightsDistribution(items, ["svod", "streamingReservation", "streaming"]);
    const copydan = rightsDistribution(items, ["copydan", "copydanReservation"]);
    const royalty = rightsDistribution(items, ["royalty", "royaltyClause"]);
    return { category: String(category), svodPercent: streaming.yesPercent, svodUnknown: streaming.unknownCount, copydanPercent: copydan.yesPercent, copydanUnknown: copydan.unknownCount, royaltyPercent: royalty.yesPercent, royaltyUnknown: royalty.unknownCount, ...sampleMeta(items) };
  });

  const gender = groupSafe(rows.filter(row => row.gender), row => String(row.gender)).map(([genderKey, items]) => ({
    gender: String(genderKey),
    count: new Set(items.map(row => row.rightsHolderId)).size,
    avgSalary: Math.round(items.reduce((sum, row) => sum + Number(row.data.salary ?? 0), 0) / items.length),
    ...sampleMeta(items),
  }));

  const aiClauses = groupSafe(rows, row => row.year).map(([year, items]) => ({
    year: Number(year),
    withClause: items.filter(row => row.data.aiDataMiningClause).length,
    withoutClause: items.filter(row => !row.data.aiDataMiningClause).length,
    pct: Math.round(items.filter(row => row.data.aiDataMiningClause).length / items.length * 100),
    ...sampleMeta(items),
  })).sort((left, right) => left.year - right.year);

  const contributions = groupSafe(rows.filter(row => Number(row.data.salary) > 0), row => row.year).map(([year, items]) => {
    const values = items.map(row => contributionForContract({ id: row.id, premiereYear: row.year, type: row.type, extractedData: row.data })).filter(Boolean) as NonNullable<ReturnType<typeof contributionForContract>>[];
    return {
      year: Number(year),
      totalHolidayPayAmount: Math.round(values.reduce((sum, value) => sum + value.holidayPay, 0)),
      totalBetaAmount: Math.round(values.reduce((sum, value) => sum + value.beta, 0)),
      ...sampleMeta(items),
    };
  }).sort((left, right) => left.year - right.year);

  return {
    suppressed: false,
    minimum: MIN_STATISTICS_CONTRACTS,
    lowSampleThreshold: LOW_SAMPLE_CONTRACTS,
    includeDrafts,
    ...sampleMeta(rows),
    years,
    salary,
    salaryByCategory,
    pension,
    workingWeeks,
    contractCounts,
    rights,
    gender,
    aiClauses,
    contributions,
  };
}
