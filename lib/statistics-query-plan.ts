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

const allowedMetrics = new Set<string>(STATISTICS_METRICS);
const allowedGenders = new Set(["male", "female", "other"]);
const allowedCategories = new Set<StatisticsCategory>(["feature", "tvSeries", "documentary", "docSeries", "short", "tvEntertainment", "reality", "other"]);
const allowedContractTypes = new Set(["a-løn", "leverandør"]);
const allowedMembershipTypes = new Set(["member", "associate", "none", "unknown"]);
const allowedExperienceGroups = new Set(["new_graduate", "early_career", "experienced", "veteran"]);

const metricAliases: Record<string, StatisticsMetric> = {
  average_salary: "average_monthly_salary",
  median_salary: "average_monthly_salary",
  monthly_salary: "average_monthly_salary",
  pension: "average_pension",
  working_weeks: "average_working_weeks",
  contracts: "contract_count",
  producer_contributions: "contributions",
};

function normalizedMetric(value: unknown) {
  const key = String(value ?? "").trim().toLocaleLowerCase("en");
  return allowedMetrics.has(key) ? key as StatisticsMetric : metricAliases[key] ?? null;
}

export function predefinedStatisticsQueryPlan(question: string): StatisticsQueryPlan | null {
  const normalized = question.trim().toLocaleLowerCase("da");
  const base = (metric: StatisticsMetric, chart: StatisticsQueryPlan["chart"] = "line"): StatisticsQueryPlan => ({
    metric, groupBy: "year", chart,
    filters: { years: [], gender: null, categories: [], contractType: null, producerNames: [], producerTypeCodes: [], membershipTypes: [], professionType: null, experienceGroup: null },
  });
  if (normalized.includes("medianlønnen") && normalized.includes("spillefilm") && normalized.includes("dokumentarfilm")) {
    const plan = base("average_monthly_salary");
    plan.filters.categories = ["feature", "documentary"];
    plan.filters.years = [2022, 2023, 2024, 2025, 2026];
    return plan;
  }
  if (normalized.includes("gennemsnitlige pension")) return base("average_pension");
  if (normalized.includes("hvor mange kontrakter") || normalized.includes("antal kontrakter")) return base("contract_count", "bar");
  if (normalized.includes("producentbidrag")) return base("contributions");
  if (normalized.includes("arbejdsuger")) return base("average_working_weeks");
  return null;
}

function stringArray(value: unknown, maximum: number, maxLength = 120) {
  const values = Array.isArray(value) ? value : typeof value === "string" && value.trim() ? [value] : [];
  return [...new Set(values.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean).map(item => item.slice(0, maxLength)))].slice(0, maximum);
}

export function parseStatisticsQueryPlan(value: unknown): StatisticsQueryPlan {
  if (!value || typeof value !== "object") throw new Error("AI-planen mangler.");
  const raw = value as Record<string, unknown>;
  const metric = normalizedMetric(raw.metric ?? raw.measure ?? raw.target);
  if (!metric) throw new Error("Spørgsmålet bruger et mål, som statistikmotoren ikke tillader.");
  const rawGroupBy = Array.isArray(raw.groupBy) ? raw.groupBy[0] : raw.groupBy ?? raw.group_by ?? "year";
  if (rawGroupBy !== "year" && rawGroupBy !== "år") throw new Error("Kun gruppering pr. år er understøttet endnu.");
  const rawFilters = raw.filters && typeof raw.filters === "object" ? raw.filters as Record<string, unknown> : {};
  const legacyYear = Number(rawFilters.year);
  const years = (Array.isArray(rawFilters.years) ? rawFilters.years : Number.isInteger(legacyYear) ? [legacyYear] : [])
    .map(Number).filter(year => Number.isInteger(year) && year >= 1900 && year <= 2200)
    .filter((year, index, all) => all.indexOf(year) === index).sort((a, b) => a - b).slice(0, 200);
  const legacyCategory = typeof rawFilters.category === "string" ? [rawFilters.category] : [];
  const categories = (Array.isArray(rawFilters.categories) ? rawFilters.categories : legacyCategory)
    .filter((category): category is StatisticsCategory => allowedCategories.has(category as StatisticsCategory))
    .filter((category, index, all) => all.indexOf(category) === index);
  const legacyProducer = typeof rawFilters.producerName === "string" ? [rawFilters.producerName] : [];
  return {
    metric,
    groupBy: "year",
    filters: {
      years,
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
