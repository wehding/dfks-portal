import assert from "node:assert/strict";
import test from "node:test";
import { buildStatisticsQuerySegments, type ResolvedStatisticsProducer } from "../lib/statistics-query-execution";
import {
  predefinedStatisticsQueryPlan,
  STATISTICS_METRIC_META,
  StatisticsQueryPlanError,
  type StatisticsCategory,
  type StatisticsComparisonDimension,
  type StatisticsContractType,
  type StatisticsExperienceGroup,
  type StatisticsGender,
  type StatisticsMembershipType,
  type StatisticsMetric,
  type StatisticsQueryPlan,
} from "../lib/statistics-query-plan";
import { buildStatisticsVisualization, type VisualizationSeriesRow } from "../lib/statistics/visualization";

type ExpectedQuestionResult = {
  question: string;
  metrics?: StatisticsMetric[];
  compareBy?: StatisticsComparisonDimension[];
  categories?: StatisticsCategory[];
  contractTypes?: StatisticsContractType[];
  genders?: StatisticsGender[];
  experienceGroups?: StatisticsExperienceGroup[];
  membershipTypes?: StatisticsMembershipType[];
  professionTypes?: string[];
  producerTypeCodes?: string[];
  years?: number[];
  yearFrom?: number | null;
  yearTo?: number | null;
  chart?: "line" | "bar" | "table";
  adjustForInflation?: boolean;
  expectNull?: boolean;
  expectErrorCode?: string;
};

const currentYear = new Date().getFullYear();
const sampleProducers: ResolvedStatisticsProducer[] = [
  { id: "11111111-1111-1111-1111-111111111111", name: "Producent Alpha" },
  { id: "22222222-2222-2222-2222-222222222222", name: "Producent Beta" },
  { id: "33333333-3333-3333-3333-333333333333", name: "Producent Gamma" },
];

const questions: ExpectedQuestionResult[] = [];
const add = (entry: ExpectedQuestionResult) => questions.push(entry);

function pushUnique<T>(items: T[], item: T) {
  if (!items.includes(item)) items.push(item);
}

function metricsFromQuestion(question: string): StatisticsMetric[] {
  const value = question.toLocaleLowerCase("da");
  const withoutContractTypeNames = value.replace(/a[- ]?(?:løn|lon)\w*/g, "");
  const metrics: StatisticsMetric[] = [];
  if (withoutContractTypeNames.includes("løn") || withoutContractTypeNames.includes("lon") || value.includes("købekraft")) {
    pushUnique(metrics, value.includes("gennemsnit") || value.includes("middelværdi") || value.includes("middelvaerdi")
      ? "average_monthly_salary"
      : "median_monthly_salary");
  }
  if (value.includes("pension")) pushUnique(metrics, "average_pension");
  if (value.includes("arbejdsuger") || value.includes("antal uger")) pushUnique(metrics, value.includes("median") ? "median_working_weeks" : "average_working_weeks");
  if (value.includes("antal kontrakter") || value.includes("hvor mange kontrakter") || value.includes("kontraktantal") || value.includes("kontrakter findes") || value.includes("kontrakter er der")) pushUnique(metrics, "contract_count");
  if (value.includes("producentbidrag") || value.includes("feriepenge") || value.includes("beta-bidrag") || value.includes("beta bidrag")) pushUnique(metrics, "contributions");
  if (value.includes("copydan")) pushUnique(metrics, "copydan_share");
  if (value.includes("streaming") || value.includes("svod")) pushUnique(metrics, "streaming_share");
  if (value.includes("royalty")) pushUnique(metrics, "royalty_share");
  if (value.includes("ai-forbehold") || value.includes("ai forbehold") || value.includes("datamining")) pushUnique(metrics, "ai_clause_share");
  return metrics.length ? metrics : ["median_monthly_salary"];
}

([
  ["Vis medianløn år for år", ["median_monthly_salary"]],
  ["Hvad er lønudviklingen?", ["median_monthly_salary"]],
  ["Vis løn gennem årene", ["median_monthly_salary"]],
  ["Vis månedsløn pr. år", ["median_monthly_salary"]],
  ["Vis manedslon over tid", ["median_monthly_salary"]],
  ["Hvordan udvikler ugelønnen sig?", ["median_monthly_salary"]],
  ["Giv mig gennemsnitsløn år for år", ["average_monthly_salary"]],
  ["Vis middelværdi for løn", ["average_monthly_salary"]],
  ["Vis middelvaerdi for lon", ["average_monthly_salary"]],
  ["Hvordan er den gennemsnitlige månedsløn?", ["average_monthly_salary"]],
  ["Pensionsprocent over tid", ["average_pension"]],
  ["Hvordan ændrer pension sig pr. år?", ["average_pension"]],
  ["Vis gennemsnitlig pension", ["average_pension"]],
  ["Arbejdsuger over tid", ["average_working_weeks"]],
  ["Vis gennemsnitlige arbejdsuger", ["average_working_weeks"]],
  ["Median arbejdsuger pr. år", ["median_working_weeks"]],
  ["Hvordan ændrer antal uger sig?", ["average_working_weeks"]],
  ["Antal kontrakter pr. år", ["contract_count"]],
  ["Hvor mange kontrakter findes der?", ["contract_count"]],
  ["Vis kontrakter er der over tid", ["contract_count"]],
  ["Producentbidrag pr. år", ["contributions"]],
  ["Feriepenge over tid", ["contributions"]],
  ["Beta-bidrag over tid", ["contributions"]],
  ["Copydan over tid", ["copydan_share"]],
  ["Streaming over tid", ["streaming_share"]],
  ["Svod-forbehold over tid", ["streaming_share"]],
  ["Royalty over tid", ["royalty_share"]],
  ["AI forbehold pr. år", ["ai_clause_share"]],
  ["Datamining klausuler over tid", ["ai_clause_share"]],
  ["Løn og pension over tid", ["median_monthly_salary", "average_pension"]],
] as Array<[string, StatisticsMetric[]]>).forEach(([question, metrics]) => add({ question, metrics, compareBy: [] }));

const categories: Array<{ phrase: string; category: StatisticsCategory }> = [
  { phrase: "spillefilm", category: "feature" },
  { phrase: "fiktion", category: "feature" },
  { phrase: "dokumentarfilm", category: "documentary" },
  { phrase: "dokumentarserie", category: "docSeries" },
  { phrase: "tv-serie", category: "tvSeries" },
  { phrase: "kortfilm", category: "short" },
  { phrase: "reality", category: "reality" },
  { phrase: "tv-underholdning", category: "tvEntertainment" },
];
const categoryMetricTemplates: Array<{ prefix: string; metrics: StatisticsMetric[] }> = [
  { prefix: "Vis lønnen for", metrics: ["median_monthly_salary"] },
  { prefix: "Vis gennemsnitsløn for", metrics: ["average_monthly_salary"] },
  { prefix: "Vis pension for", metrics: ["average_pension"] },
  { prefix: "Vis arbejdsuger for", metrics: ["average_working_weeks"] },
  { prefix: "Vis antal kontrakter for", metrics: ["contract_count"] },
];
for (const category of categories) {
  for (const template of categoryMetricTemplates) {
    add({ question: `${template.prefix} ${category.phrase}`, metrics: template.metrics, categories: [category.category], compareBy: [] });
  }
}

([
  ["Sammenlign løn for spillefilm og dokumentarfilm", ["feature", "documentary"]],
  ["Sammenlign løn for fiktion og dokumentar", ["feature", "documentary"]],
  ["Sammenlign pension for spillefilm og tv-serie", ["feature", "tvSeries"]],
  ["Sammenlign arbejdsuger for dokumentarserie og dokumentarfilm", ["docSeries", "documentary"]],
  ["Sammenlign antal kontrakter for kortfilm og reality", ["short", "reality"]],
  ["Sammenlign gennemsnitsløn for tv-underholdning og spillefilm", ["feature", "tvEntertainment"]],
  ["Løn for dokumentarfilm og tv-serie over tid", ["documentary", "tvSeries"]],
  ["Pension for fiktion og dokumentarfilm over tid", ["feature", "documentary"]],
  ["Arbejdsuger for kortfilm og dokumentarserie", ["docSeries", "short"]],
  ["Antal kontrakter for reality og tv-underholdning", ["tvEntertainment", "reality"]],
  ["Søjle over løn for spillefilm og dokumentarfilm", ["feature", "documentary"], "bar"],
  ["Tabel over løn for fiktion og dokumentar", ["feature", "documentary"], "table"],
] as Array<[string, StatisticsCategory[], ("bar" | "table")?]>).forEach(([question, categoryValues, chart]) => add({
  question: question as string,
  metrics: metricsFromQuestion(question as string),
  categories: categoryValues as StatisticsCategory[],
  compareBy: ["category"],
  chart: chart as "bar" | "table" | undefined,
}));

[
  ["Løn for A-løn i spillefilm", ["a-løn"], ["feature"]],
  ["Pension for A løn i dokumentarfilm", ["a-løn"], ["documentary"]],
  ["Arbejdsuger for leverandør i tv-serie", ["leverandør"], ["tvSeries"]],
  ["Gennemsnitsløn for faktura i kortfilm", ["leverandør"], ["short"]],
  ["Antal kontrakter for freelance i reality", ["leverandør"], ["reality"]],
  ["Sammenlign løn for A-løn og leverandør", ["a-løn", "leverandør"], []],
  ["Sammenlign pension for A løn og faktura", ["a-løn", "leverandør"], []],
  ["Sammenlign arbejdsuger for freelance og A-løn", ["a-løn", "leverandør"], []],
  ["Vis antal kontrakter for A-løn og leverandør", ["a-løn", "leverandør"], []],
  ["Søjle med antal kontrakter for A-løn og leverandør", ["a-løn", "leverandør"], []],
  ["Tabel med løn for A-løn og leverandør", ["a-løn", "leverandør"], []],
  ["Løn for leverandørkontrakter siden 2022", ["leverandør"], []],
].forEach(([question, contractTypes, categoryValues]) => add({
  question: question as string,
  metrics: metricsFromQuestion(question as string),
  contractTypes: contractTypes as StatisticsContractType[],
  categories: categoryValues as StatisticsCategory[],
  compareBy: (contractTypes as string[]).length > 1 ? ["contract_type"] : [],
  chart: (question as string).includes("Søjle") || (question as string).includes("antal") ? "bar" : (question as string).includes("Tabel") ? "table" : undefined,
  yearFrom: (question as string).includes("siden 2022") ? 2022 : undefined,
  yearTo: (question as string).includes("siden 2022") ? currentYear : undefined,
}));

[
  ["Løn for kvinder", ["female"]],
  ["Løn for mænd", ["male"]],
  ["Pension for kvinder", ["female"]],
  ["Arbejdsuger for mænd", ["male"]],
  ["Sammenlign løn for kvinder og mænd", ["female", "male"]],
  ["Sammenlign gennemsnitsløn for mænd og kvinder", ["female", "male"]],
  ["Sammenlign pension for kvinder og mænd", ["female", "male"]],
  ["Sammenlign arbejdsuger for mænd og kvinder", ["female", "male"]],
  ["Vis løn fordelt på køn", ["male", "female", "other"]],
  ["Vis pension efter køn", ["male", "female", "other"]],
].forEach(([question, genders]) => add({
  question: question as string,
  metrics: metricsFromQuestion(question as string),
  genders: genders as StatisticsGender[],
  compareBy: (genders as string[]).length > 1 ? ["gender"] : [],
}));

[
  ["Løn siden 2016", 2016, currentYear],
  ["Pension siden 2017", 2017, currentYear],
  ["Arbejdsuger siden 2018", 2018, currentYear],
  ["Copydan siden 2019", 2019, currentYear],
  ["Streaming siden 2020", 2020, currentYear],
  ["Royalty siden 2021", 2021, currentYear],
  ["AI-forbehold siden 2022", 2022, currentYear],
  ["Antal kontrakter siden 2023", 2023, currentYear],
  ["Løn mellem 2016 og 2020", 2016, 2020],
  ["Pension mellem 2018 og 2024", 2018, 2024],
  ["Arbejdsuger fra 2019 til 2023", 2019, 2023],
  ["Producentbidrag fra 2020 til 2025", 2020, 2025],
  ["Løn i 2020", null, null, [2020]],
  ["Pension i 2021", null, null, [2021]],
  ["Arbejdsuger i 2022", null, null, [2022]],
  ["Copydan i 2023", null, null, [2023]],
].forEach(([question, yearFrom, yearTo, years]) => add({
  question: question as string,
  metrics: metricsFromQuestion(question as string),
  yearFrom: yearFrom as number | null,
  yearTo: yearTo as number | null,
  years: years as number[] | undefined,
  compareBy: [],
}));

[
  ["Løn for medlemmer", ["member"]],
  ["Løn for ikke-medlemmer", ["none"]],
  ["Løn for uorganiserede", ["none"]],
  ["Pension for medlemmer", ["member"]],
  ["Arbejdsuger for ikke medlemmer", ["none"]],
  ["Sammenlign løn for medlemmer og uorganiserede", ["member", "none"]],
  ["Sammenlign pension for medlemmer og ikke-medlemmer", ["member", "none"]],
  ["Sammenlign arbejdsuger for associerede og medlemmer", ["member", "associate"]],
  ["Antal kontrakter for tilknyttede medlemmer og medlemmer", ["member", "associate"]],
  ["Løn for ukendt medlemsstatus og medlemmer", ["member", "unknown"]],
  ["Vis løn fordelt på medlemsstatus", ["member", "associate", "none", "unknown"]],
  ["Vis pension efter medlemsstatus", ["member", "associate", "none", "unknown"]],
].forEach(([question, membershipTypes]) => add({
  question: question as string,
  metrics: metricsFromQuestion(question as string),
  membershipTypes: membershipTypes as StatisticsMembershipType[],
  compareBy: (membershipTypes as string[]).length > 1 ? ["membership_type"] : [],
  chart: (question as string).includes("Antal") ? "bar" : undefined,
}));

[
  ["Løn for nyuddannede", ["new_graduate"]],
  ["Løn for nye klippere", ["new_graduate"]],
  ["Pension for 0-3 år", ["new_graduate"]],
  ["Arbejdsuger for 4-7 år", ["early_career"]],
  ["Løn for tidlig karriere", ["early_career"]],
  ["Pension for 8-17 år", ["experienced"]],
  ["Løn for erfarne", ["experienced"]],
  ["Arbejdsuger for 18+", ["veteran"]],
  ["Løn for meget erfarne", ["veteran"]],
  ["Sammenlign løn for nyuddannede og erfarne", ["new_graduate", "experienced"]],
  ["Sammenlign pension for 0-3 år og 18+", ["new_graduate", "veteran"]],
  ["Vis løn fordelt på erfaring", ["new_graduate", "early_career", "experienced", "veteran"]],
].forEach(([question, experienceGroups]) => add({
  question: question as string,
  metrics: metricsFromQuestion(question as string),
  experienceGroups: experienceGroups as StatisticsExperienceGroup[],
  compareBy: (experienceGroups as string[]).length > 1 ? ["experience_group"] : [],
}));

[
  ["Løn for klippere", ["Klipper"]],
  ["Løn for medklippere", ["Medklipper"]],
  ["Pension for klippeassistenter", ["Klippeassistent"]],
  ["Arbejdsuger for klippere", ["Klipper"]],
  ["Sammenlign løn for klippere og medklippere", ["Medklipper", "Klipper"]],
  ["Sammenlign pension for klippere og klippeassistenter", ["Klipper", "Klippeassistent"]],
  ["Sammenlign arbejdsuger for medklippere og klippere", ["Medklipper", "Klipper"]],
  ["Vis løn fordelt på faggruppe for klippere og medklippere", ["Medklipper", "Klipper"]],
].forEach(([question, professionTypes]) => add({
  question: question as string,
  metrics: metricsFromQuestion(question as string),
  professionTypes: professionTypes as string[],
  compareBy: (professionTypes as string[]).length > 1 ? ["profession_type"] : [],
}));

[
  ["Løn for filmproducenter", ["feature_fiction"]],
  ["Løn for dokumentarproducenter", ["documentary"]],
  ["Pension for tv-producenter", ["tv"]],
  ["Arbejdsuger for streamere", ["streamer"]],
  ["Løn for broadcastere", ["broadcaster"]],
  ["Løn for animation", ["animation"]],
  ["Løn for reklameproducenter", ["advertising"]],
  ["Sammenlign løn for filmproducenter og dokumentarproducenter", ["feature_fiction", "documentary"]],
  ["Sammenlign pension for tv-producenter og broadcastere", ["tv", "broadcaster"]],
  ["Sammenlign arbejdsuger for streamere og broadcastere", ["streamer", "broadcaster"]],
].forEach(([question, producerTypeCodes]) => add({
  question: question as string,
  metrics: metricsFromQuestion(question as string),
  producerTypeCodes: producerTypeCodes as string[],
  compareBy: (producerTypeCodes as string[]).length > 1 ? ["producer_type"] : [],
}));

([
  { question: "Løn for spillefilm og dokumentarfilm for A-løn og leverandør", metrics: ["median_monthly_salary"], categories: ["feature", "documentary"], contractTypes: ["a-løn", "leverandør"], compareBy: ["category", "contract_type"] },
  { question: "Pension for fiktion og dokumentar for A-løn og faktura", metrics: ["average_pension"], categories: ["feature", "documentary"], contractTypes: ["a-løn", "leverandør"], compareBy: ["category", "contract_type"] },
  { question: "Løn for kvinder og mænd i spillefilm og dokumentarfilm", metrics: ["median_monthly_salary"], categories: ["feature", "documentary"], genders: ["female", "male"], compareBy: ["category", "gender"] },
  { question: "Pension for kvinder og mænd i dokumentarfilm og tv-serie", metrics: ["average_pension"], categories: ["documentary", "tvSeries"], genders: ["female", "male"], compareBy: ["category", "gender"] },
  { question: "Løn for medlemmer og ikke-medlemmer i spillefilm og dokumentarfilm", metrics: ["median_monthly_salary"], categories: ["feature", "documentary"], membershipTypes: ["member", "none"], compareBy: ["category", "membership_type"] },
  { question: "Arbejdsuger for nyuddannede og veteraner i dokumentarfilm", metrics: ["average_working_weeks"], categories: ["documentary"], experienceGroups: ["new_graduate", "veteran"], compareBy: ["experience_group"] },
  { question: "Løn for klippere og medklippere i spillefilm", metrics: ["median_monthly_salary"], categories: ["feature"], professionTypes: ["Medklipper", "Klipper"], compareBy: ["profession_type"] },
  { question: "Løn for streamere og broadcastere i tv-serie", metrics: ["median_monthly_salary"], categories: ["tvSeries"], producerTypeCodes: ["streamer", "broadcaster"], compareBy: ["producer_type"] },
  { question: "Søjle med løn for A-løn og leverandør i dokumentarfilm", metrics: ["median_monthly_salary"], categories: ["documentary"], contractTypes: ["a-løn", "leverandør"], compareBy: ["contract_type"], chart: "bar" },
  { question: "Tabel over pension for kvinder og mænd i spillefilm", metrics: ["average_pension"], categories: ["feature"], genders: ["female", "male"], compareBy: ["gender"], chart: "table" },
  { question: "Realløn for spillefilm og dokumentarfilm siden 2020", metrics: ["median_monthly_salary"], categories: ["feature", "documentary"], compareBy: ["category"], yearFrom: 2020, yearTo: currentYear, adjustForInflation: true },
  { question: "Købekraft for A-løn og leverandør siden 2021", metrics: ["median_monthly_salary"], contractTypes: ["a-løn", "leverandør"], compareBy: ["contract_type"], yearFrom: 2021, yearTo: currentYear, adjustForInflation: true },
 ] satisfies ExpectedQuestionResult[]).forEach(add);

([
  { question: "Vis løn efter producent", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Hvilke producenter giver bedst løn i dokumentarfilm?", metrics: ["median_monthly_salary"], categories: ["documentary"], compareBy: ["producer"], chart: "bar" },
  { question: "Top producenter efter løn siden 2022", metrics: ["median_monthly_salary"], compareBy: ["producer"], yearFrom: 2022, yearTo: currentYear, chart: "bar" },
  { question: "Bedste producenter efter løn for spillefilm", metrics: ["median_monthly_salary"], categories: ["feature"], compareBy: ["producer"], chart: "bar" },
  { question: "Producenter betaler bedst for A-løn", metrics: ["median_monthly_salary"], contractTypes: ["a-løn"], compareBy: ["producer"], chart: "bar" },
  { question: "Hvilke producenter giver bedst gennemsnitsløn?", metrics: ["average_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Hvordan er lønnen fra producenten Zentropa?", expectNull: true },
  { question: "Hvordan er lønnen for producent Nordisk Film?", expectNull: true },
 ] satisfies ExpectedQuestionResult[]).forEach(add);

([
  { question: "Vis løn efter producenttype", expectErrorCode: "missing_comparison_values" },
  { question: "Vis pension efter faggruppe", expectErrorCode: "missing_comparison_values" },
  { question: "Vis arbejdsuger efter producenttype", expectErrorCode: "missing_comparison_values" },
  { question: "Vis løn efter produktionsland", expectNull: true },
  { question: "Hvad er budgetterne pr. år?", expectNull: true },
  { question: "DROP TABLE contracts", expectNull: true },
  { question: "Hvem tjener mest?", expectErrorCode: "person_query_not_allowed" },
  { question: "Højest lønnede klipper", expectErrorCode: "person_query_not_allowed" },
  { question: "Lavest lønnede medlem", expectErrorCode: "person_query_not_allowed" },
  { question: "Hvad tjener Anna Andersen?", expectErrorCode: "person_query_not_allowed" },
 ] satisfies ExpectedQuestionResult[]).forEach(add);

([
  { question: "Løn og arbejdsuger for spillefilm siden 2020", metrics: ["median_monthly_salary", "average_working_weeks"], categories: ["feature"], compareBy: [], yearFrom: 2020, yearTo: currentYear },
  { question: "Pension og Copydan for dokumentarfilm siden 2021", metrics: ["average_pension", "copydan_share"], categories: ["documentary"], compareBy: [], yearFrom: 2021, yearTo: currentYear },
  { question: "Løn og royalty for tv-serie", metrics: ["median_monthly_salary", "royalty_share"], categories: ["tvSeries"], compareBy: [] },
  { question: "Gennemsnitsløn og streaming for kortfilm", metrics: ["average_monthly_salary", "streaming_share"], categories: ["short"], compareBy: [] },
  { question: "Pension og AI-forbehold for reality", metrics: ["average_pension", "ai_clause_share"], categories: ["reality"], compareBy: [] },
  { question: "Arbejdsuger og Copydan for tv-underholdning", metrics: ["average_working_weeks", "copydan_share"], categories: ["tvEntertainment"], compareBy: [] },
  { question: "Tabel over løn og pension for medlemmer", metrics: ["median_monthly_salary", "average_pension"], membershipTypes: ["member"], compareBy: [], chart: "table" },
  { question: "Søjle med løn og pension for A-løn og leverandør", metrics: ["median_monthly_salary", "average_pension"], contractTypes: ["a-løn", "leverandør"], compareBy: ["contract_type"], chart: "bar" },
 ] satisfies ExpectedQuestionResult[]).forEach(add);

assert.equal(questions.length, 200, "Testmatricen skal indeholde præcis 200 nye statistikspørgsmål.");

function assertOptionalDeepEqual<T>(actual: T, expected: T | undefined, label: string) {
  if (expected !== undefined) assert.deepEqual(actual, expected, label);
}

function syntheticRows(plan: StatisticsQueryPlan): VisualizationSeriesRow[] {
  const producers = plan.compareBy.includes("producer") ? sampleProducers : [];
  const segments = buildStatisticsQuerySegments(plan, producers);
  const years = plan.filters.years.length === 1 ? plan.filters.years : [2024, 2025];
  return segments.flatMap((segment, segmentIndex) => plan.metrics.flatMap((metric, metricIndex) => {
    const meta = STATISTICS_METRIC_META[metric];
    return years.map((year, yearIndex) => ({
      year,
      value: meta.unit === "dkk" ? 40_000 + segmentIndex * 1_000 + metricIndex * 250 + yearIndex * 100
        : meta.unit === "percent" ? 10 + segmentIndex + metricIndex + yearIndex
          : meta.unit === "weeks" ? 20 + segmentIndex + yearIndex
            : 5 + segmentIndex + yearIndex,
      seriesKey: `${metric}__${segment.key}`,
      seriesLabel: plan.metrics.length > 1 ? `${meta.label} · ${segment.label}` : segment.label,
      metric,
      metricLabel: meta.label,
      unit: meta.unit,
      contractCount: 6,
      memberCount: 4,
      lowSample: false,
    }));
  }));
}

for (const [index, entry] of questions.entries()) {
  test(`nyt statistikspørgsmål ${index + 1}: ${entry.question}`, () => {
    if (entry.expectErrorCode) {
      assert.throws(
        () => predefinedStatisticsQueryPlan(entry.question),
        (error: unknown) => error instanceof StatisticsQueryPlanError && error.code === entry.expectErrorCode,
      );
      return;
    }

    const plan = predefinedStatisticsQueryPlan(entry.question);
    if (entry.expectNull) {
      assert.equal(plan, null);
      return;
    }

    assert.ok(plan, "Spørgsmålet skal kunne fortolkes deterministisk.");
    assertOptionalDeepEqual(plan.metrics, entry.metrics, "metrics");
    assertOptionalDeepEqual(plan.compareBy, entry.compareBy, "compareBy");
    assertOptionalDeepEqual(plan.filters.categories, entry.categories, "categories");
    assertOptionalDeepEqual(plan.filters.contractTypes, entry.contractTypes, "contractTypes");
    assertOptionalDeepEqual(plan.filters.genders, entry.genders, "genders");
    assertOptionalDeepEqual(plan.filters.experienceGroups, entry.experienceGroups, "experienceGroups");
    assertOptionalDeepEqual(plan.filters.membershipTypes, entry.membershipTypes, "membershipTypes");
    assertOptionalDeepEqual(plan.filters.professionTypes, entry.professionTypes, "professionTypes");
    assertOptionalDeepEqual(plan.filters.producerTypeCodes, entry.producerTypeCodes, "producerTypeCodes");
    assertOptionalDeepEqual(plan.filters.years, entry.years, "years");
    if (entry.yearFrom !== undefined) assert.equal(plan.filters.yearFrom, entry.yearFrom, "yearFrom");
    if (entry.yearTo !== undefined) assert.equal(plan.filters.yearTo, entry.yearTo, "yearTo");
    if (entry.chart) assert.equal(plan.chart, entry.chart, "chart");
    if (entry.adjustForInflation !== undefined) assert.equal(plan.adjustForInflation, entry.adjustForInflation, "adjustForInflation");

    const rows = syntheticRows(plan);
    assert.ok(rows.length > 0, "Spørgsmålet skal give syntetiske aggregerede resultatrækker.");
    const visualization = buildStatisticsVisualization(rows, plan.chart === "bar" ? "bar" : plan.chart);
    assert.ok(visualization.rows.length > 0, "Spørgsmålet skal kunne vises som statistikresultat.");
    if (plan.chart === "table") assert.equal(visualization.chart, "table");
    if (plan.chart === "bar" && new Set(rows.map(row => row.unit)).size === 1 && new Set(rows.map(row => row.year)).size > 1) {
      assert.equal(visualization.chart, "grouped_bar");
    }
  });
}
