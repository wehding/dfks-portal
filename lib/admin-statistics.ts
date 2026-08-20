import "server-only";

import { contributionForContract, salaryDataToMonthly, salaryDataToWeekly } from "@/lib/statistics-calculations";
import { DataStandardizer } from "@/lib/statistics/data-standardizer";
import { PrivacyGuard, type PrivacyCell } from "@/lib/statistics/privacy-guard";
import { createServiceClient } from "@/lib/supabase/service";
import { experienceGroupAt, type ExperienceGroup } from "@/lib/experience-groups";
import {
  LOW_SAMPLE_MEMBER_THRESHOLD,
  distinctStatisticsMembers,
  normalizeStatisticsMinimumGroupSize,
  statisticsGroupIsVisible,
} from "@/lib/statistics-privacy";
import {
  statisticsBoolean,
  statisticsDataValue,
  statisticsNumber,
  statisticsTriState,
} from "@/lib/statistics-values";

export type StatisticsFilters = {
  years?: number[];
  gender?: string | null;
  genders?: string[];
  categories?: string[];
  contractType?: string | null;
  contractTypes?: string[];
  producerIds?: string[];
  producerTypeCodes?: string[];
  membershipTypes?: string[];
  professionType?: string | null;
  professionTypes?: string[];
  experienceGroup?: ExperienceGroup | null;
  experienceGroups?: ExperienceGroup[];
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

type SuppressionReason = NonNullable<PrivacyCell["suppressionReason"]>;
type DisclosureMeta = {
  suppressed: boolean;
  suppressionReason?: SuppressionReason;
  outlierExcludedCount: number;
};

function overlaps(left: string[], right?: string[]) {
  return !right?.length || right.some(value => left.includes(value));
}

function sampleMeta(items: ContractRow[], disclosure?: Partial<DisclosureMeta>) {
  const memberCount = distinctStatisticsMembers(items);
  return {
    contractCount: items.length,
    memberCount,
    validatedCount: items.filter(item => item.status === "valideret").length,
    draftCount: items.filter(item => item.status === "kladde").length,
    lowSample: memberCount < LOW_SAMPLE_MEMBER_THRESHOLD,
    suppressed: disclosure?.suppressed ?? false,
    suppressionReason: disclosure?.suppressionReason,
    outlierExcludedCount: disclosure?.outlierExcludedCount ?? 0,
  };
}

function groupRows<T extends ContractRow>(rows: T[], key: (row: T) => string | number) {
  const groups = new Map<string | number, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return [...groups.entries()];
}

function hourlySalary(row: ContractRow) {
  const weekly = salaryDataToWeekly(row.data);
  return Number.isFinite(weekly) && weekly > 0 ? weekly / 37 : null;
}

function salaryOutlierFilter(rows: ContractRow[]) {
  const salaryRows = rows.filter(row => {
    const monthly = salaryDataToMonthly(row.data);
    return Number.isFinite(monthly) && monthly > 0 && hourlySalary(row) != null;
  });
  return new DataStandardizer().filterHourlyOutliers(salaryRows, hourlySalary);
}

function outlierCountFor<T extends ContractRow>(items: T[], outlierIds: Set<string>) {
  return items.filter(item => outlierIds.has(item.id)).length;
}

function producerContributionValues<T extends ContractRow>(items: T[], value: (row: T) => number) {
  const byProducer = new Map<string, number>();
  for (const item of items) {
    const calculated = value(item);
    if (!Number.isFinite(calculated) || calculated <= 0 || !item.producerIds.length) continue;
    const share = calculated / item.producerIds.length;
    for (const producerId of item.producerIds) byProducer.set(producerId, (byProducer.get(producerId) ?? 0) + share);
  }
  return [...byProducer.values()];
}

function protectGroups<T extends ContractRow>(
  groups: Array<[string | number, T[]]>,
  minimumGroupSize: number,
  options: {
    additiveEconomicValues?: boolean;
    hasPublishedTotal?: boolean;
    contributions?: (items: T[]) => number[];
  } = {},
) {
  const guard = new PrivacyGuard({ minimumGroupSize, dominanceLimit: 0.8 });
  const cells = groups.map(([key, items]) => ({
    key: String(key),
    contributorIds: items.map(item => item.rightsHolderId),
    contributions: options.contributions?.(items),
  }));
  const protectedCells = guard.protectCells(cells, {
    additiveEconomicValues: options.additiveEconomicValues,
    hasPublishedTotal: options.hasPublishedTotal,
  });
  const byKey = new Map(protectedCells.map(cell => [cell.key, cell]));
  return groups.map(([key, items]) => [key, items, byKey.get(String(key))] as const);
}

function visibleNumber(value: number, cell: PrivacyCell | undefined) {
  return cell?.suppressed ? null : value;
}

function disclosure(cell: PrivacyCell | undefined, outlierExcludedCount = 0): DisclosureMeta {
  return {
    suppressed: Boolean(cell?.suppressed),
    suppressionReason: cell?.suppressionReason,
    outlierExcludedCount,
  };
}

function suppressionSummary(rows: Array<{ suppressed?: boolean; suppressionReason?: string | null }>) {
  const reasons: Record<string, number> = {};
  for (const row of rows) {
    if (!row.suppressed) continue;
    const reason = row.suppressionReason ?? "unknown";
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  return {
    suppressionCount: Object.values(reasons).reduce((sum, value) => sum + value, 0),
    suppressionReasons: reasons,
  };
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

function personWeightedSummary(items: ContractRow[], value: (row: ContractRow) => number, decimals = 1) {
  const byPerson = new Map<string, number[]>();
  for (const item of items) {
    const calculated = value(item);
    if (!Number.isFinite(calculated) || calculated < 0) continue;
    byPerson.set(item.rightsHolderId, [...(byPerson.get(item.rightsHolderId) ?? []), calculated]);
  }
  const values = [...byPerson.values()].map(personValues => personValues.reduce((sum, current) => sum + current, 0) / personValues.length);
  if (!values.length) return { median: 0, average: 0 };
  const factor = 10 ** decimals;
  return {
    median: Math.round(median(values) * factor) / factor,
    average: Math.round(values.reduce((sum, current) => sum + current, 0) / values.length * factor) / factor,
  };
}

function personWeightedAverage(items: ContractRow[], value: (row: ContractRow) => number, decimals = 1) {
  const byPerson = new Map<string, number[]>();
  for (const item of items) {
    const calculated = value(item);
    if (!Number.isFinite(calculated) || calculated < 0) continue;
    byPerson.set(item.rightsHolderId, [...(byPerson.get(item.rightsHolderId) ?? []), calculated]);
  }
  const personValues = [...byPerson.values()].map(values => values.reduce((sum, current) => sum + current, 0) / values.length);
  if (!personValues.length) return 0;
  const factor = 10 ** decimals;
  return Math.round(personValues.reduce((sum, current) => sum + current, 0) / personValues.length * factor) / factor;
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
  const state = statisticsTriState(statisticsDataValue(row.data, keys));
  if (state === "yes") return "explicit_yes";
  if (state === "no") return "explicit_no";
  if (state === "implicit") return "implicit_by_agreement";
  return "unknown";
}

function rightsDistribution(items: ContractRow[], keys: string[], agreementCanApply = false) {
  const statuses = items.map(item => {
    const explicit = rightsStatus(item, keys);
    if (explicit !== "unknown" || !agreementCanApply || item.type === "leverandør") return explicit;
    const agreement = statisticsTriState(statisticsDataValue(item.data, [
      "agreementReferenceStatus",
      "collectiveAgreementByReference",
      "collectiveAgreement",
      "rightsOverview.overenskomst",
    ]));
    return agreement === "yes" || agreement === "implicit" ? "implicit_by_agreement" : "unknown";
  });
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
    .select("statistics_contract_scope,statistics_minimum_group_size").eq("id", orgId).single();
  if (organisationError) throw new Error(organisationError.message);
  const includeDrafts = organisation.statistics_contract_scope === "validated_and_drafts";
  const minimumGroupSize = normalizeStatisticsMinimumGroupSize(organisation.statistics_minimum_group_size);
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
    const genders = filters.genders?.length ? filters.genders : filters.gender ? [filters.gender] : [];
    if (genders.length && (!row.gender || !genders.includes(row.gender))) return false;
    if (filters.categories?.length && (!row.category || !filters.categories.includes(row.category))) return false;
    const contractTypes = filters.contractTypes?.length ? filters.contractTypes : filters.contractType ? [filters.contractType] : [];
    if (contractTypes.length && !contractTypes.includes(row.type)) return false;
    if (!overlaps(row.producerIds, filters.producerIds)) return false;
    if (!overlaps(row.producerTypeCodes, filters.producerTypeCodes)) return false;
    if (filters.membershipTypes?.length) {
      const memberships = row.membershipTypes.length ? row.membershipTypes : ["none"];
      if (!overlaps(memberships, filters.membershipTypes)) return false;
    }
    const professionTypes = filters.professionTypes?.length ? filters.professionTypes : filters.professionType ? [filters.professionType] : [];
    if (professionTypes.length && !professionTypes.map(value => value.trim().toLocaleLowerCase("da")).includes(row.professionType)) return false;
    const experienceGroups = filters.experienceGroups?.length ? filters.experienceGroups : filters.experienceGroup ? [filters.experienceGroup] : [];
    const rowExperienceGroup = experienceGroupAt(row.professionalStartYear, row.year);
    if (experienceGroups.length && (!rowExperienceGroup || !experienceGroups.includes(rowExperienceGroup))) return false;
    return true;
  });

  if (!statisticsGroupIsVisible(rows, minimumGroupSize)) {
    return {
      suppressed: true,
      minimum: minimumGroupSize,
      lowSampleThreshold: LOW_SAMPLE_MEMBER_THRESHOLD,
      suppressionCount: 1,
      suppressionReasons: { minimum_count: 1 },
      memberCount: null,
      years,
      includeDrafts,
    };
  }

  const salaryOutliers = salaryOutlierFilter(rows);
  const salaryRows = salaryOutliers.included;
  const salaryOutlierIds = new Set(salaryOutliers.excluded.map(item => item.item.id));

  const salary = protectGroups(groupRows(salaryRows, row => row.year), minimumGroupSize, { hasPublishedTotal: true }).map(([year, items, cell]) => {
    const monthly = personWeighted(items, row => salaryDataToMonthly(row.data));
    const daily = personWeighted(items, row => salaryDataToWeekly(row.data) / 5);
    return {
      year: Number(year),
      monthlyRate: visibleNumber(monthly.median, cell),
      averageMonthlyRate: visibleNumber(monthly.average, cell),
      dailyRate: visibleNumber(daily.median, cell),
      ...sampleMeta(items, disclosure(cell, outlierCountFor(items, salaryOutlierIds))),
    };
  }).sort((left, right) => left.year - right.year);

  const salaryByCategory = protectGroups(
    groupRows(salaryRows.filter(row => row.category === "feature" || row.category === "documentary"), row => `${row.year}:${row.category}`),
    minimumGroupSize,
    { hasPublishedTotal: true },
  ).map(([key, items, cell]) => {
    const [year, category] = String(key).split(":");
    const values = personWeighted(items, row => salaryDataToMonthly(row.data));
    return {
      year: Number(year),
      category,
      monthlyRate: visibleNumber(values.median, cell),
      averageMonthlyRate: visibleNumber(values.average, cell),
      ...sampleMeta(items, disclosure(cell, outlierCountFor(items, salaryOutlierIds))),
    };
  }).sort((left, right) => left.year - right.year || left.category.localeCompare(right.category));

  const pensionValue = (row: ContractRow) => {
    const value = statisticsNumber(statisticsDataValue(row.data, ["pensionEmployerPercent", "pensionPercent"]));
    if (value != null && value >= 0) return value;
    return row.data.pensionStatus === "not_applicable" ? 0 : null;
  };
  const pension = protectGroups(
    groupRows(rows.filter(row => pensionValue(row) != null), row => row.year),
    minimumGroupSize,
    { hasPublishedTotal: true },
  ).map(([year, items, cell]) => ({
    year: Number(year),
    avgPensionPercent: visibleNumber(personWeightedAverage(items, row => pensionValue(row) ?? Number.NaN), cell),
    ...sampleMeta(items, disclosure(cell)),
  })).sort((left, right) => left.year - right.year);

  const workingWeeks = protectGroups(
    groupRows(rows.filter(row => (statisticsNumber(row.data.workingWeeks) ?? 0) > 0), row => row.year),
    minimumGroupSize,
    { hasPublishedTotal: true },
  ).map(([year, items, cell]) => {
    const values = personWeightedSummary(items, row => weeksInYear(
      typeof row.data.startDate === "string" ? row.data.startDate : row.startDate,
      typeof row.data.endDate === "string" ? row.data.endDate : null,
      statisticsNumber(row.data.workingWeeks) ?? 0,
      Number(year),
    ), 1);
    return {
      year: Number(year),
      avgWeeks: visibleNumber(values.average, cell),
      medianWeeks: visibleNumber(values.median, cell),
      ...sampleMeta(items, disclosure(cell)),
    };
  }).sort((left, right) => left.year - right.year);

  const contractCounts = protectGroups(groupRows(rows, row => row.year), minimumGroupSize, { hasPublishedTotal: true }).map(([year, items, cell]) => ({
    year: Number(year),
    total: visibleNumber(items.length, cell),
    aLoen: visibleNumber(items.filter(row => row.type === "a-løn").length, cell),
    leverandoer: visibleNumber(items.filter(row => row.type !== "a-løn").length, cell),
    ...sampleMeta(items, disclosure(cell)),
  })).sort((left, right) => left.year - right.year);

  const rights = protectGroups(groupRows(rows.filter(row => row.category), row => String(row.category)), minimumGroupSize, { hasPublishedTotal: true }).map(([category, items, cell]) => {
    const streaming = rightsDistribution(items, ["svod", "streamingReservation", "streaming", "rightsOverview.streamingforbehold"], true);
    const copydan = rightsDistribution(items, ["copydan", "copydanReservation", "rightsOverview.copydanforbehold"], true);
    const royalty = rightsDistribution(items, ["royalty", "royaltyClause"]);
    return {
      category: String(category),
      svodPercent: visibleNumber(streaming.yesPercent, cell),
      svodUnknown: visibleNumber(streaming.unknownCount, cell),
      copydanPercent: visibleNumber(copydan.yesPercent, cell),
      copydanUnknown: visibleNumber(copydan.unknownCount, cell),
      royaltyPercent: visibleNumber(royalty.yesPercent, cell),
      royaltyUnknown: visibleNumber(royalty.unknownCount, cell),
      ...sampleMeta(items, disclosure(cell)),
    };
  });

  const rightsByYear = protectGroups(groupRows(rows, row => row.year), minimumGroupSize, { hasPublishedTotal: true }).map(([year, items, cell]) => {
    const streaming = rightsDistribution(items, ["svod", "streamingReservation", "streaming", "rightsOverview.streamingforbehold"], true);
    const copydan = rightsDistribution(items, ["copydan", "copydanReservation", "rightsOverview.copydanforbehold"], true);
    const royalty = rightsDistribution(items, ["royalty", "royaltyClause"]);
    return {
      year: Number(year),
      streamingPercent: visibleNumber(streaming.yesPercent, cell),
      streamingUnknown: visibleNumber(streaming.unknownCount, cell),
      copydanPercent: visibleNumber(copydan.yesPercent, cell),
      copydanUnknown: visibleNumber(copydan.unknownCount, cell),
      royaltyPercent: visibleNumber(royalty.yesPercent, cell),
      royaltyUnknown: visibleNumber(royalty.unknownCount, cell),
      ...sampleMeta(items, disclosure(cell)),
    };
  }).sort((left, right) => left.year - right.year);

  const gender = protectGroups(groupRows(salaryRows.filter(row => row.gender), row => String(row.gender)), minimumGroupSize, { hasPublishedTotal: true }).map(([genderKey, items, cell]) => ({
    gender: String(genderKey),
    count: new Set(items.map(row => row.rightsHolderId)).size,
    avgSalary: visibleNumber(personWeighted(items, row => salaryDataToMonthly(row.data)).average, cell),
    ...sampleMeta(items, disclosure(cell, outlierCountFor(items, salaryOutlierIds))),
  }));

  const aiClauses = protectGroups(groupRows(rows, row => row.year), minimumGroupSize, { hasPublishedTotal: true }).map(([year, items, cell]) => ({
    year: Number(year),
    withClause: visibleNumber(items.filter(row => statisticsBoolean(row.data.aiDataMiningClause) === true).length, cell),
    withoutClause: visibleNumber(items.filter(row => statisticsBoolean(row.data.aiDataMiningClause) === false).length, cell),
    unknownCount: visibleNumber(items.filter(row => statisticsBoolean(row.data.aiDataMiningClause) == null).length, cell),
    pct: (() => {
      const known = items.filter(row => statisticsBoolean(row.data.aiDataMiningClause) != null);
      return visibleNumber(known.length ? Math.round(known.filter(row => statisticsBoolean(row.data.aiDataMiningClause) === true).length / known.length * 100) : 0, cell);
    })(),
    ...sampleMeta(items, disclosure(cell)),
  })).sort((left, right) => left.year - right.year);

  const contributionRows = salaryRows.filter(row => (statisticsNumber(row.data.salary) ?? 0) > 0);
  const contributions = protectGroups(
    groupRows(contributionRows, row => row.year),
    minimumGroupSize,
    {
      additiveEconomicValues: true,
      hasPublishedTotal: true,
      contributions: items => producerContributionValues(items, row => {
        const value = contributionForContract({ id: row.id, premiereYear: row.year, type: row.type, extractedData: row.data });
        return (value?.holidayPay ?? 0) + (value?.beta ?? 0);
      }),
    },
  ).map(([year, items, cell]) => {
    const values = items.map(row => contributionForContract({ id: row.id, premiereYear: row.year, type: row.type, extractedData: row.data })).filter(Boolean) as NonNullable<ReturnType<typeof contributionForContract>>[];
    const holidayPay = Math.round(values.reduce((sum, value) => sum + (value.holidayPay ?? 0), 0));
    const beta = Math.round(values.reduce((sum, value) => sum + (value.beta ?? 0), 0));
    return {
      year: Number(year),
      totalHolidayPayAmount: visibleNumber(holidayPay, cell),
      totalBetaAmount: visibleNumber(beta, cell),
      incompleteContributionCount: visibleNumber(values.filter(value => value.holidayPay == null || value.beta == null).length, cell),
      ...sampleMeta(items, disclosure(cell, outlierCountFor(items, salaryOutlierIds))),
    };
  }).sort((left, right) => left.year - right.year);

  const privacySummary = suppressionSummary([
    ...salary, ...salaryByCategory, ...pension, ...workingWeeks, ...contractCounts,
    ...rights, ...rightsByYear, ...gender, ...aiClauses, ...contributions,
  ]);

  return {
    minimum: minimumGroupSize,
    lowSampleThreshold: LOW_SAMPLE_MEMBER_THRESHOLD,
    includeDrafts,
    ...sampleMeta(rows),
    ...privacySummary,
    outlierExcludedCount: salaryOutliers.excluded.length,
    years,
    salary,
    salaryByCategory,
    pension,
    workingWeeks,
    contractCounts,
    rights,
    rightsByYear,
    gender,
    aiClauses,
    contributions,
  };
}
