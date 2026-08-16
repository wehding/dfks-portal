export const STATISTICS_METRICS = [
  "median_monthly_salary",
  "average_monthly_salary",
  "average_pension",
  "median_working_weeks",
  "average_working_weeks",
  "contract_count",
  "contributions",
  "copydan_share",
  "streaming_share",
  "royalty_share",
  "ai_clause_share",
] as const;

export const STATISTICS_COMPARISON_DIMENSIONS = [
  "category",
  "contract_type",
  "producer",
  "gender",
  "producer_type",
  "membership_type",
  "profession_type",
  "experience_group",
] as const;

export type StatisticsMetric = typeof STATISTICS_METRICS[number];
export type StatisticsComparisonDimension = typeof STATISTICS_COMPARISON_DIMENSIONS[number];
export type StatisticsCategory = "feature" | "tvSeries" | "documentary" | "docSeries" | "short" | "tvEntertainment" | "reality" | "other";
export type StatisticsContractType = "a-løn" | "leverandør";
export type StatisticsGender = "male" | "female" | "other";
export type StatisticsMembershipType = "member" | "associate" | "none" | "unknown";
export type StatisticsExperienceGroup = "new_graduate" | "early_career" | "experienced" | "veteran";

export type StatisticsQueryPlan = {
  metrics: StatisticsMetric[];
  groupBy: "year";
  compareBy: StatisticsComparisonDimension[];
  filters: {
    years: number[];
    yearFrom: number | null;
    yearTo: number | null;
    genders: StatisticsGender[];
    categories: StatisticsCategory[];
    contractTypes: StatisticsContractType[];
    producerNames: string[];
    producerTypeCodes: string[];
    membershipTypes: StatisticsMembershipType[];
    professionTypes: string[];
    experienceGroups: StatisticsExperienceGroup[];
  };
  chart: "line" | "bar" | "table";
  adjustForInflation: boolean;
};

export type StatisticsQueryPlanErrorCode =
  | "missing_plan"
  | "unsupported_metric"
  | "unsupported_grouping"
  | "person_query_not_allowed"
  | "missing_comparison_values"
  | "too_many_series";

export class StatisticsQueryPlanError extends Error {
  readonly code: StatisticsQueryPlanErrorCode;

  constructor(code: StatisticsQueryPlanErrorCode, message: string) {
    super(message);
    this.name = "StatisticsQueryPlanError";
    this.code = code;
  }
}

// Anthropic Structured Outputs accepterer denne lukkede form, men ikke alle
// JSON Schema-grænser. Længder og kombinationsgrænser håndhæves derfor igen i
// parseStatisticsQueryPlan og i den server-side forespørgselsmotor.
export const STATISTICS_QUERY_PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["metrics", "groupBy", "compareBy", "filters", "chart", "adjustForInflation"],
  properties: {
    metrics: { type: "array", items: { type: "string", enum: [...STATISTICS_METRICS] } },
    groupBy: { type: "string", enum: ["year"] },
    compareBy: { type: "array", items: { type: "string", enum: [...STATISTICS_COMPARISON_DIMENSIONS] } },
    chart: { type: "string", enum: ["line", "bar", "table"] },
    adjustForInflation: { type: "boolean" },
    filters: {
      type: "object",
      additionalProperties: false,
      required: ["years", "yearFrom", "yearTo", "genders", "categories", "contractTypes", "producerNames", "producerTypeCodes", "membershipTypes", "professionTypes", "experienceGroups"],
      properties: {
        years: { type: "array", items: { type: "integer" } },
        yearFrom: { anyOf: [{ type: "integer" }, { type: "null" }] },
        yearTo: { anyOf: [{ type: "integer" }, { type: "null" }] },
        genders: { type: "array", items: { type: "string", enum: ["male", "female", "other"] } },
        categories: { type: "array", items: { type: "string", enum: ["feature", "tvSeries", "documentary", "docSeries", "short", "tvEntertainment", "reality", "other"] } },
        contractTypes: { type: "array", items: { type: "string", enum: ["a-løn", "leverandør"] } },
        producerNames: { type: "array", items: { type: "string" } },
        producerTypeCodes: { type: "array", items: { type: "string" } },
        membershipTypes: { type: "array", items: { type: "string", enum: ["member", "associate", "none", "unknown"] } },
        professionTypes: { type: "array", items: { type: "string" } },
        experienceGroups: { type: "array", items: { type: "string", enum: ["new_graduate", "early_career", "experienced", "veteran"] } },
      },
    },
  },
};

export function statisticsQuerySystemPrompt(currentYear = new Date().getFullYear()) {
  return `Du oversætter danske statistikspørgsmål til en lukket JSON-plan.
Returnér kun JSON med: metrics, groupBy, compareBy, filters, chart og adjustForInflation.
metrics er et array med 1–3 af: median_monthly_salary, average_monthly_salary, average_pension, median_working_weeks, average_working_weeks, contract_count, contributions, copydan_share, streaming_share, royalty_share, ai_clause_share.
Brug median_monthly_salary ved "medianløn" og average_monthly_salary ved "gennemsnitsløn". Ved løn uden præcisering bruges kun median_monthly_salary.
groupBy skal være year. chart må være line, bar eller table.
compareBy er et array med højst to af: category, contract_type, producer, gender, producer_type, membership_type, profession_type, experience_group.
Når spørgsmålet sammenligner flere produktionstyper, kontrakttyper, producenter eller andre grupper, skal den relevante dimension stå i compareBy, så grupperne bliver separate serier.
filters må kun indeholde years, yearFrom, yearTo, genders, categories, contractTypes, producerNames, producerTypeCodes, membershipTypes, professionTypes og experienceGroups.
Ved "siden 2022" sættes yearFrom til 2022 og yearTo til ${currentYear}. Ved et enkelt år bruges years. Brug null for en manglende periodegrænse.
Alle filterfelter undtagen yearFrom/yearTo er arrays. Brug tomme arrays eller null for værdier, der ikke fremgår.
Spillefilm er category feature, dokumentarfilm documentary, TV-serie tvSeries og dokumentarserie docSeries.
A-løn er contractType a-løn; faktura, freelance og leverandørkontrakt er leverandør.
experienceGroups: new_graduate (0–3 år), early_career (4–7 år), experienced (8–17 år), veteran (18+ år).
membershipTypes: member, associate, none eller unknown.
adjustForInflation er true ved spørgsmål om inflation, realløn eller købekraft; ellers false.
Forsøg aldrig at identificere personer og skriv aldrig SQL.`;
}

export const STATISTICS_METRIC_META: Record<StatisticsMetric, {
  label: string;
  unit: "dkk" | "percent" | "weeks" | "count";
  additive: boolean;
  sourceKey: string;
  valueKey: string;
}> = {
  median_monthly_salary: { label: "Median månedsløn", unit: "dkk", additive: false, sourceKey: "salary", valueKey: "monthlyRate" },
  average_monthly_salary: { label: "Gennemsnitlig månedsløn", unit: "dkk", additive: false, sourceKey: "salary", valueKey: "averageMonthlyRate" },
  average_pension: { label: "Gennemsnitlig pensionsprocent", unit: "percent", additive: false, sourceKey: "pension", valueKey: "avgPensionPercent" },
  median_working_weeks: { label: "Median arbejdsuger", unit: "weeks", additive: false, sourceKey: "workingWeeks", valueKey: "medianWeeks" },
  average_working_weeks: { label: "Gennemsnitlige arbejdsuger", unit: "weeks", additive: false, sourceKey: "workingWeeks", valueKey: "avgWeeks" },
  contract_count: { label: "Antal kontrakter", unit: "count", additive: true, sourceKey: "contractCounts", valueKey: "total" },
  contributions: { label: "Producentbidrag", unit: "dkk", additive: true, sourceKey: "contributions", valueKey: "totalContribution" },
  copydan_share: { label: "Andel med Copydan-forbehold", unit: "percent", additive: false, sourceKey: "rightsByYear", valueKey: "copydanPercent" },
  streaming_share: { label: "Andel med streamingforbehold", unit: "percent", additive: false, sourceKey: "rightsByYear", valueKey: "streamingPercent" },
  royalty_share: { label: "Andel med royalty", unit: "percent", additive: false, sourceKey: "rightsByYear", valueKey: "royaltyPercent" },
  ai_clause_share: { label: "Andel med AI/data-mining-forbehold", unit: "percent", additive: false, sourceKey: "aiClauses", valueKey: "pct" },
};

const allowedMetrics = new Set<string>(STATISTICS_METRICS);
const allowedDimensions = new Set<string>(STATISTICS_COMPARISON_DIMENSIONS);
const allowedGenders = new Set<StatisticsGender>(["male", "female", "other"]);
const allowedCategories = new Set<StatisticsCategory>(["feature", "tvSeries", "documentary", "docSeries", "short", "tvEntertainment", "reality", "other"]);
const allowedContractTypes = new Set<StatisticsContractType>(["a-løn", "leverandør"]);
const allowedMembershipTypes = new Set<StatisticsMembershipType>(["member", "associate", "none", "unknown"]);
const allowedExperienceGroups = new Set<StatisticsExperienceGroup>(["new_graduate", "early_career", "experienced", "veteran"]);

const metricAliases: Record<string, StatisticsMetric> = {
  average_salary: "average_monthly_salary",
  median_salary: "median_monthly_salary",
  monthly_salary: "median_monthly_salary",
  salary: "median_monthly_salary",
  pension: "average_pension",
  working_weeks: "average_working_weeks",
  contracts: "contract_count",
  producer_contributions: "contributions",
  copydan: "copydan_share",
  streaming: "streaming_share",
  royalty: "royalty_share",
  ai_clause: "ai_clause_share",
};

const dimensionAliases: Record<string, StatisticsComparisonDimension> = {
  production_type: "category",
  category: "category",
  contracttype: "contract_type",
  contract_type: "contract_type",
  producer: "producer",
  gender: "gender",
  producer_type: "producer_type",
  membership_type: "membership_type",
  profession: "profession_type",
  profession_type: "profession_type",
  experience: "experience_group",
  experience_group: "experience_group",
};

function normalizedMetric(value: unknown) {
  const key = String(value ?? "").trim().toLocaleLowerCase("en");
  return allowedMetrics.has(key) ? key as StatisticsMetric : metricAliases[key] ?? null;
}

function normalizedDimension(value: unknown) {
  const key = String(value ?? "").trim().toLocaleLowerCase("en");
  return allowedDimensions.has(key) ? key as StatisticsComparisonDimension : dimensionAliases[key] ?? null;
}

function stringArray(value: unknown, maximum: number, maxLength = 120) {
  const values = Array.isArray(value) ? value : typeof value === "string" && value.trim() ? [value] : [];
  return [...new Set(values.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean).map(item => item.slice(0, maxLength)))].slice(0, maximum);
}

function enumArray<T extends string>(value: unknown, allowed: Set<T>, maximum: number): T[] {
  return stringArray(value, maximum, 80).filter((item): item is T => allowed.has(item as T));
}

function emptyPlan(metrics: StatisticsMetric[]): StatisticsQueryPlan {
  return {
    metrics,
    groupBy: "year",
    compareBy: [],
    chart: "line",
    adjustForInflation: metrics.some(metric => metric === "median_monthly_salary" || metric === "average_monthly_salary"),
    filters: {
      years: [], yearFrom: null, yearTo: null, genders: [], categories: [], contractTypes: [],
      producerNames: [], producerTypeCodes: [], membershipTypes: [], professionTypes: [], experienceGroups: [],
    },
  };
}

function normalizedQuestion(question: string) {
  return question.trim().toLocaleLowerCase("da").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function includesAny(value: string, needles: string[]) {
  return needles.some(needle => value.includes(needle));
}

/**
 * Sikker, deterministisk fortolkning af almindelige danske statistikspørgsmål.
 * Den gør kernefunktionerne uafhængige af AI-udbyderens tilgængelighed. Mere
 * frie spørgsmål sendes fortsat til den lukkede AI-planlægger.
 */
export function predefinedStatisticsQueryPlan(question: string): StatisticsQueryPlan | null {
  const value = normalizedQuestion(question);
  if (includesAny(value, ["hvad tjener", "hvem tjener", "højest lønnede", "hojest lonnede", "lavest lønnede", "lavest lonnede"])) {
    throw new StatisticsQueryPlanError("person_query_not_allowed", "Statistikmotoren må ikke besvare spørgsmål om identificerbare personer.");
  }
  const metrics: StatisticsMetric[] = [];
  const addMetric = (metric: StatisticsMetric) => { if (!metrics.includes(metric)) metrics.push(metric); };

  const withoutContractTypeNames = value.replace(/a[- ]?(?:løn|lon)\w*/g, "");
  const salaryMentioned = includesAny(withoutContractTypeNames, ["lon", "løn", "ugeløn", "ugelon", "manedslon", "månedsløn"]);
  const contractCountMentioned = includesAny(value, ["antal kontrakter", "hvor mange kontrakter", "kontraktantal", "kontrakter er der"])
    || /hvor mange.*kontrakt/.test(value);
  if (salaryMentioned) addMetric(includesAny(value, ["gennemsnit", "middelværdi", "middelvaerdi"]) ? "average_monthly_salary" : "median_monthly_salary");
  if (value.includes("pension")) addMetric("average_pension");
  if (includesAny(value, ["arbejdsuger", "arbejdsuge", "antal uger"])) addMetric(value.includes("median") ? "median_working_weeks" : "average_working_weeks");
  if (contractCountMentioned) addMetric("contract_count");
  if (includesAny(value, ["producentbidrag", "producentbidragene", "feriepenge", "beta-bidrag", "beta bidrag"])) addMetric("contributions");
  if (value.includes("copydan")) addMetric("copydan_share");
  if (includesAny(value, ["streamingforbehold", "streaming-forbehold", "svod-forbehold", "svod forbehold"])) addMetric("streaming_share");
  if (value.includes("royalty")) addMetric("royalty_share");
  if (includesAny(value, ["ai-forbehold", "ai forbehold", "data-mining", "datamining"])) addMetric("ai_clause_share");
  if (!metrics.length) return null;

  const plan = emptyPlan(metrics.slice(0, 3));
  if (value.includes("spillefilm")) plan.filters.categories.push("feature");
  if (includesAny(value, ["dokumentarserie", "dokumentar-serie", "dok-serie", "dok serie"])) plan.filters.categories.push("docSeries");
  if (value.includes("dokumentarfilm") || (value.includes("dokumentar") && !plan.filters.categories.includes("docSeries"))) plan.filters.categories.push("documentary");
  if (includesAny(value, ["tv-serie", "tv serie", "tvserier", "tv-serier"])) plan.filters.categories.push("tvSeries");
  if (value.includes("kortfilm")) plan.filters.categories.push("short");
  if (includesAny(value, ["tv-underholdning", "tv underholdning"])) plan.filters.categories.push("tvEntertainment");
  if (value.includes("reality")) plan.filters.categories.push("reality");

  if (includesAny(value, ["a-lon", "a lon", "a-løn", "a løn"])) plan.filters.contractTypes.push("a-løn");
  if (includesAny(value, ["leverandor", "leverandør", "faktura", "freelance"])) plan.filters.contractTypes.push("leverandør");
  if (includesAny(value, ["kvinder", "kvinde"])) plan.filters.genders.push("female");
  if (includesAny(value, ["mænd", "maend", "mand"])) plan.filters.genders.push("male");

  const yearMatches = [...value.matchAll(/\b((?:19|20)\d{2})\b/g)].map(match => Number(match[1]));
  const uniqueYears = [...new Set(yearMatches)].sort((left, right) => left - right);
  const currentYear = new Date().getFullYear();
  if (value.includes("siden") && uniqueYears.length) {
    plan.filters.yearFrom = uniqueYears[0];
    plan.filters.yearTo = currentYear;
    plan.filters.years = Array.from({ length: currentYear - uniqueYears[0] + 1 }, (_, index) => uniqueYears[0] + index);
  } else if (uniqueYears.length >= 2 && includesAny(value, [" til ", "fra ", "mellem", "-"])) {
    plan.filters.yearFrom = uniqueYears[0];
    plan.filters.yearTo = uniqueYears.at(-1) ?? uniqueYears[0];
    plan.filters.years = Array.from({ length: plan.filters.yearTo - plan.filters.yearFrom + 1 }, (_, index) => plan.filters.yearFrom! + index);
  } else if (uniqueYears.length) {
    plan.filters.years = uniqueYears;
  }

  if (plan.filters.categories.length > 1 || includesAny(value, ["efter produktionstype", "fordelt pa produktionstype", "fordelt på produktionstype"])) plan.compareBy.push("category");
  if (plan.filters.contractTypes.length > 1 || includesAny(value, ["efter kontrakttype", "fordelt pa kontrakttype", "fordelt på kontrakttype"])) plan.compareBy.push("contract_type");
  if (plan.filters.genders.length > 1 || /\b(?:efter|fordelt (?:pa|på)) (?:kon|køn)\b/.test(value)) plan.compareBy.push("gender");
  if (includesAny(value, ["efter erfaringsgruppe", "fordelt pa erfaring", "fordelt på erfaring"])) plan.compareBy.push("experience_group");
  if (includesAny(value, ["efter faggruppe", "fordelt pa faggruppe", "fordelt på faggruppe"])) plan.compareBy.push("profession_type");
  if (includesAny(value, ["inflation", "reallon", "realløn", "købekraft", "kobekraft"])) plan.adjustForInflation = true;
  plan.chart = includesAny(value, ["tabel", "oversigt"]) ? "table" : includesAny(value, ["søjle", "sojle"]) ? "bar" : "line";

  // Producentnavne og andre fritekstværdier skal stadig løses af AI og det
  // kanoniske register. Undgå at gætte, når spørgsmålet tydeligt nævner en
  // navngiven producent.
  if (value.includes("producent") && /\b(?:hos|fra|for)\b/.test(value)) return null;
  return parseStatisticsQueryPlan(plan);
}

export function parseStatisticsQueryPlan(value: unknown): StatisticsQueryPlan {
  if (!value || typeof value !== "object") throw new StatisticsQueryPlanError("missing_plan", "AI-planen mangler.");
  const raw = value as Record<string, unknown>;
  const rawMetrics = Array.isArray(raw.metrics) ? raw.metrics : [raw.metric ?? raw.measure ?? raw.target];
  const metrics = [...new Set(rawMetrics.map(normalizedMetric).filter((metric): metric is StatisticsMetric => Boolean(metric)))].slice(0, 3);
  if (!metrics.length) throw new StatisticsQueryPlanError("unsupported_metric", "Spørgsmålet bruger et mål, som statistikmotoren ikke tillader.");
  const rawGroupBy = Array.isArray(raw.groupBy) ? raw.groupBy[0] : raw.groupBy ?? raw.group_by ?? "year";
  if (rawGroupBy !== "year" && rawGroupBy !== "år") throw new StatisticsQueryPlanError("unsupported_grouping", "Kun gruppering pr. år er understøttet endnu.");
  const compareValues = Array.isArray(raw.compareBy) ? raw.compareBy : raw.compareBy ? [raw.compareBy] : [];
  const compareBy = [...new Set(compareValues.map(normalizedDimension).filter((dimension): dimension is StatisticsComparisonDimension => Boolean(dimension)))].slice(0, 2);
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
  const legacyProducer = typeof rawFilters.producerName === "string" ? [rawFilters.producerName] : [];
  const legacyGender = typeof rawFilters.gender === "string" ? [rawFilters.gender] : [];
  const legacyContractType = typeof rawFilters.contractType === "string" ? [rawFilters.contractType] : [];
  const legacyProfession = typeof rawFilters.professionType === "string" ? [rawFilters.professionType] : [];
  const legacyExperience = typeof rawFilters.experienceGroup === "string" ? [rawFilters.experienceGroup] : [];

  const plan: StatisticsQueryPlan = {
    metrics,
    groupBy: "year",
    compareBy,
    filters: {
      years,
      yearFrom,
      yearTo,
      genders: enumArray(Array.isArray(rawFilters.genders) ? rawFilters.genders : legacyGender, allowedGenders, 3),
      categories: enumArray(Array.isArray(rawFilters.categories) ? rawFilters.categories : legacyCategory, allowedCategories, 8),
      contractTypes: enumArray(Array.isArray(rawFilters.contractTypes) ? rawFilters.contractTypes : legacyContractType, allowedContractTypes, 2),
      producerNames: stringArray(Array.isArray(rawFilters.producerNames) ? rawFilters.producerNames : legacyProducer, 5),
      producerTypeCodes: stringArray(rawFilters.producerTypeCodes, 20, 80).filter(code => /^[a-z0-9_]+$/.test(code)),
      membershipTypes: enumArray(rawFilters.membershipTypes, allowedMembershipTypes, 4),
      professionTypes: stringArray(Array.isArray(rawFilters.professionTypes) ? rawFilters.professionTypes : legacyProfession, 8),
      experienceGroups: enumArray(Array.isArray(rawFilters.experienceGroups) ? rawFilters.experienceGroups : legacyExperience, allowedExperienceGroups, 4),
    },
    chart: raw.chart === "bar" || raw.chart === "table" ? raw.chart : "line",
    adjustForInflation: raw.adjustForInflation === true,
  };

  if (plan.compareBy.includes("category") && !plan.filters.categories.length) plan.filters.categories = [...allowedCategories];
  if (plan.compareBy.includes("contract_type") && !plan.filters.contractTypes.length) plan.filters.contractTypes = [...allowedContractTypes];
  if (plan.compareBy.includes("gender") && !plan.filters.genders.length) plan.filters.genders = [...allowedGenders];
  if (plan.compareBy.includes("membership_type") && !plan.filters.membershipTypes.length) plan.filters.membershipTypes = [...allowedMembershipTypes];
  if (plan.compareBy.includes("experience_group") && !plan.filters.experienceGroups.length) plan.filters.experienceGroups = [...allowedExperienceGroups];
  for (const dimension of plan.compareBy) {
    const values = dimension === "producer" ? plan.filters.producerNames
      : dimension === "producer_type" ? plan.filters.producerTypeCodes
        : dimension === "profession_type" ? plan.filters.professionTypes
          : ["category", "contract_type", "gender", "membership_type", "experience_group"].includes(dimension) ? ["known"] : [];
    if (!values.length) throw new StatisticsQueryPlanError("missing_comparison_values", `Sammenligning efter ${dimension} mangler konkrete værdier.`);
  }
  return plan;
}

export type StatisticsSeriesRow = {
  year: number;
  value: number;
  contractCount: number;
  memberCount: number;
  validatedCount: number;
  draftCount: number;
  lowSample: boolean;
  seriesKey: string;
  seriesLabel: string;
  metric: StatisticsMetric;
  metricLabel: string;
  unit: "dkk" | "percent" | "weeks" | "count";
};

export function extractStatisticsSeries(
  metric: StatisticsMetric,
  statistics: Record<string, unknown>,
  seriesKey = "result",
  seriesLabel = "Resultat",
): StatisticsSeriesRow[] {
  const meta = STATISTICS_METRIC_META[metric];
  const rows = Array.isArray(statistics[meta.sourceKey]) ? statistics[meta.sourceKey] as Array<Record<string, unknown>> : [];
  return rows.flatMap(row => {
    const value = metric === "contributions"
      ? Number(row.totalHolidayPayAmount ?? 0) + Number(row.totalBetaAmount ?? 0)
      : Number(row[meta.valueKey] ?? Number.NaN);
    if (!Number.isFinite(value)) return [];
    return [{
      year: Number(row.year), value,
      contractCount: Number(row.contractCount ?? 0), memberCount: Number(row.memberCount ?? 0),
      validatedCount: Number(row.validatedCount ?? 0), draftCount: Number(row.draftCount ?? 0),
      lowSample: Boolean(row.lowSample), seriesKey, seriesLabel, metric,
      metricLabel: meta.label, unit: meta.unit,
    }];
  });
}
