export const STATISTICS_METRICS = [
  "average_monthly_salary",
  "average_pension",
  "average_working_weeks",
  "contract_count",
  "contributions",
] as const;

export type StatisticsMetric = typeof STATISTICS_METRICS[number];
export type StatisticsQueryPlan = {
  metric: StatisticsMetric;
  groupBy: "year";
  filters: {
    year: number | null;
    gender: "male" | "female" | "other" | null;
    category: "feature" | "tvSeries" | "documentary" | "docSeries" | "short" | "tvEntertainment" | "reality" | "other" | null;
    contractType: "a-løn" | "leverandør" | null;
    producerName: string | null;
    professionType: string | null;
  };
  chart: "line" | "bar" | "table";
};

const allowedMetrics = new Set<string>(STATISTICS_METRICS);
const allowedGenders = new Set(["male", "female", "other"]);
const allowedCategories = new Set(["feature", "tvSeries", "documentary", "docSeries", "short", "tvEntertainment", "reality", "other"]);
const allowedContractTypes = new Set(["a-løn", "leverandør"]);

export function parseStatisticsQueryPlan(value: unknown): StatisticsQueryPlan {
  if (!value || typeof value !== "object") throw new Error("AI-planen mangler.");
  const raw = value as Record<string, unknown>;
  if (!allowedMetrics.has(String(raw.metric))) throw new Error("Spørgsmålet bruger et mål, som statistikmotoren ikke tillader.");
  if (raw.groupBy !== "year") throw new Error("Kun gruppering pr. år er understøttet endnu.");
  const rawFilters = raw.filters && typeof raw.filters === "object" ? raw.filters as Record<string, unknown> : {};
  const year = Number(rawFilters.year);
  return {
    metric: raw.metric as StatisticsMetric,
    groupBy: "year",
    filters: {
      year: Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null,
      gender: allowedGenders.has(String(rawFilters.gender)) ? rawFilters.gender as StatisticsQueryPlan["filters"]["gender"] : null,
      category: allowedCategories.has(String(rawFilters.category)) ? rawFilters.category as StatisticsQueryPlan["filters"]["category"] : null,
      contractType: allowedContractTypes.has(String(rawFilters.contractType)) ? rawFilters.contractType as StatisticsQueryPlan["filters"]["contractType"] : null,
      producerName: typeof rawFilters.producerName === "string" ? rawFilters.producerName.trim().slice(0, 120) || null : null,
      professionType: typeof rawFilters.professionType === "string" ? rawFilters.professionType.trim().slice(0, 120) || null : null,
    },
    chart: raw.chart === "bar" || raw.chart === "table" ? raw.chart : "line",
  };
}

export function extractStatisticsSeries(plan: StatisticsQueryPlan, statistics: Record<string, unknown>) {
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
    value: Number(row[valueKey] ?? 0),
    memberCount: Number(row.memberCount ?? 0),
  }));
}
