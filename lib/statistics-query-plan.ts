export const STATISTICS_METRICS = [
  "average_monthly_salary",
  "average_pension",
  "average_working_weeks",
  "contract_count",
  "contributions",
] as const;

export type StatisticsMetric = typeof STATISTICS_METRICS[number];
export type StatisticsCategory = "feature" | "tvSeries" | "documentary" | "docSeries" | "short" | "tvEntertainment" | "reality" | "other";
export type StatisticsQueryPlan = {
  metric: StatisticsMetric;
  groupBy: "year";
  filters: {
    years: number[];
    yearFrom: number | null;
    yearTo: number | null;
    gender: "male" | "female" | "other" | null;
    categories: StatisticsCategory[];
    contractType: "a-løn" | "leverandør" | null;
    producerNames: string[];
    producerTypeCodes: string[];
    membershipTypes: Array<"member" | "associate" | "none" | "unknown">;
    professionType: string | null;
    experienceGroup: "new_graduate" | "early_career" | "experienced" | "veteran" | null;
  };
  chart: "line" | "bar" | "table";
};

export type StatisticsQueryPlanErrorCode = "missing_plan" | "unsupported_metric" | "unsupported_grouping";

export class StatisticsQueryPlanError extends Error {
  readonly code: StatisticsQueryPlanErrorCode;

  constructor(code: StatisticsQueryPlanErrorCode, message: string) {
    super(message);
    this.name = "StatisticsQueryPlanError";
    this.code = code;
  }
}

export const STATISTICS_QUERY_PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["metric", "groupBy", "filters", "chart"],
  properties: {
    metric: { type: "string", enum: [...STATISTICS_METRICS] },
    groupBy: { type: "string", enum: ["year"] },
    chart: { type: "string", enum: ["line", "bar", "table"] },
    filters: {
      type: "object",
      additionalProperties: false,
      required: ["years", "yearFrom", "yearTo", "gender", "categories", "contractType", "producerNames", "producerTypeCodes", "membershipTypes", "professionType", "experienceGroup"],
      properties: {
        years: { type: "array", maxItems: 200, items: { type: "integer", minimum: 1900, maximum: 2200 } },
        yearFrom: { anyOf: [{ type: "integer", minimum: 1900, maximum: 2200 }, { type: "null" }] },
        yearTo: { anyOf: [{ type: "integer", minimum: 1900, maximum: 2200 }, { type: "null" }] },
        gender: { anyOf: [{ type: "string", enum: ["male", "female", "other"] }, { type: "null" }] },
        categories: { type: "array", items: { type: "string", enum: ["feature", "tvSeries", "documentary", "docSeries", "short", "tvEntertainment", "reality", "other"] } },
        contractType: { anyOf: [{ type: "string", enum: ["a-løn", "leverandør"] }, { type: "null" }] },
        producerNames: { type: "array", maxItems: 5, items: { type: "string", maxLength: 120 } },
        producerTypeCodes: { type: "array", maxItems: 20, items: { type: "string", maxLength: 80 } },
        membershipTypes: { type: "array", maxItems: 4, items: { type: "string", enum: ["member", "associate", "none", "unknown"] } },
        professionType: { anyOf: [{ type: "string", maxLength: 120 }, { type: "null" }] },
        experienceGroup: { anyOf: [{ type: "string", enum: ["new_graduate", "early_career", "experienced", "veteran"] }, { type: "null" }] },
      },
    },
  },
};

const allowedMetrics = new Set<string>(STATISTICS_METRICS);
const allowedGenders = new Set(["male", "female", "other"]);
const allowedCategories = new Set<StatisticsCategory>(["feature", "tvSeries", "documentary", "docSeries", "short", "tvEntertainment", "reality", "other"]);
const allowedContractTypes = new Set(["a-løn", "leverandør"]);
const allowedMembershipTypes = new Set(["member", "associate", "none", "unknown"]);
const allowedExperienceGroups = new Set(["new_graduate", "early_career", "experienced", "veteran"]);

function stringArray(value: unknown, maximum: number, maxLength = 120) {
  const values = Array.isArray(value) ? value : typeof value === "string" && value.trim() ? [value] : [];
  return [...new Set(values.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean).map(item => item.slice(0, maxLength)))].slice(0, maximum);
}

export function parseStatisticsQueryPlan(value: unknown): StatisticsQueryPlan {
  if (!value || typeof value !== "object") throw new StatisticsQueryPlanError("missing_plan", "AI-planen mangler.");
  const raw = value as Record<string, unknown>;
  if (!allowedMetrics.has(String(raw.metric))) throw new StatisticsQueryPlanError("unsupported_metric", "Spørgsmålet bruger et mål, som statistikmotoren ikke tillader.");
  if (raw.groupBy !== "year") throw new StatisticsQueryPlanError("unsupported_grouping", "Kun gruppering pr. år er understøttet endnu.");
  const rawFilters = raw.filters && typeof raw.filters === "object" ? raw.filters as Record<string, unknown> : {};
  const legacyYear = Number(rawFilters.year);
  const explicitYears = (Array.isArray(rawFilters.years) ? rawFilters.years : Number.isInteger(legacyYear) ? [legacyYear] : [])
    .map(Number).filter(year => Number.isInteger(year) && year >= 1900 && year <= 2200)
    .filter((year, index, all) => all.indexOf(year) === index).sort((a, b) => a - b).slice(0, 200);
  const currentYear = new Date().getFullYear();
  const parsedYearFrom = Number(rawFilters.yearFrom);
  const parsedYearTo = Number(rawFilters.yearTo);
  const yearFrom = Number.isInteger(parsedYearFrom) && parsedYearFrom >= 1900 && parsedYearFrom <= currentYear ? parsedYearFrom : null;
  const yearTo = Number.isInteger(parsedYearTo) && parsedYearTo >= 1900
    ? Math.min(parsedYearTo, currentYear)
    : yearFrom != null ? currentYear : null;
  const rangeYears = yearFrom != null && yearTo != null && yearTo >= yearFrom
    ? Array.from({ length: Math.min(200, yearTo - yearFrom + 1) }, (_, index) => yearFrom + index)
    : [];
  const years = [...new Set([...explicitYears, ...rangeYears])].sort((a, b) => a - b).slice(0, 200);
  const legacyCategory = typeof rawFilters.category === "string" ? [rawFilters.category] : [];
  const categories = (Array.isArray(rawFilters.categories) ? rawFilters.categories : legacyCategory)
    .filter((category): category is StatisticsCategory => allowedCategories.has(category as StatisticsCategory))
    .filter((category, index, all) => all.indexOf(category) === index);
  const legacyProducer = typeof rawFilters.producerName === "string" ? [rawFilters.producerName] : [];
  return {
    metric: raw.metric as StatisticsMetric,
    groupBy: "year",
    filters: {
      years,
      yearFrom,
      yearTo,
      gender: allowedGenders.has(String(rawFilters.gender)) ? rawFilters.gender as StatisticsQueryPlan["filters"]["gender"] : null,
      categories,
      contractType: allowedContractTypes.has(String(rawFilters.contractType)) ? rawFilters.contractType as StatisticsQueryPlan["filters"]["contractType"] : null,
      producerNames: stringArray(Array.isArray(rawFilters.producerNames) ? rawFilters.producerNames : legacyProducer, 5),
      producerTypeCodes: stringArray(rawFilters.producerTypeCodes, 20, 80).filter(code => /^[a-z0-9_]+$/.test(code)),
      membershipTypes: stringArray(rawFilters.membershipTypes, 4, 20).filter((type): type is StatisticsQueryPlan["filters"]["membershipTypes"][number] => allowedMembershipTypes.has(type)),
      professionType: typeof rawFilters.professionType === "string" ? rawFilters.professionType.trim().slice(0, 120) || null : null,
      experienceGroup: allowedExperienceGroups.has(String(rawFilters.experienceGroup))
        ? rawFilters.experienceGroup as StatisticsQueryPlan["filters"]["experienceGroup"]
        : null,
    },
    chart: raw.chart === "bar" || raw.chart === "table" ? raw.chart : "line",
  };
}

export function extractStatisticsSeries(plan: StatisticsQueryPlan, statistics: Record<string, unknown>, seriesKey = "result", seriesLabel = "Resultat") {
  const sourceKey = {
    average_monthly_salary: "salary",
    average_pension: "pension",
    average_working_weeks: "workingWeeks",
    contract_count: "contractCounts",
    contributions: "contributions",
  }[plan.metric];
  const valueKey = {
    average_monthly_salary: "monthlyRate",
    average_pension: "avgPensionPercent",
    average_working_weeks: "avgWeeks",
    contract_count: "total",
    contributions: "totalHolidayPayAmount",
  }[plan.metric];
  const rows = Array.isArray(statistics[sourceKey]) ? statistics[sourceKey] as Array<Record<string, unknown>> : [];
  return rows.map(row => ({
    year: Number(row.year),
    value: plan.metric === "contributions"
      ? Number(row.totalHolidayPayAmount ?? 0) + Number(row.totalBetaAmount ?? 0)
      : Number(row[valueKey] ?? 0),
    contractCount: Number(row.contractCount ?? 0),
    memberCount: Number(row.memberCount ?? 0),
    validatedCount: Number(row.validatedCount ?? 0),
    draftCount: Number(row.draftCount ?? 0),
    lowSample: Boolean(row.lowSample),
    seriesKey,
    seriesLabel,
  }));
}
