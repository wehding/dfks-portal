import assert from "node:assert/strict";
import test from "node:test";
import { buildStatisticsQuerySegments, type ResolvedStatisticsProducer } from "../lib/statistics-query-execution";
import {
  predefinedStatisticsQueryPlan,
  StatisticsQueryPlanError,
  STATISTICS_METRIC_META,
  type StatisticsCategory,
  type StatisticsComparisonDimension,
  type StatisticsContractType,
  type StatisticsMetric,
  type StatisticsQueryPlan,
} from "../lib/statistics-query-plan";
import { buildStatisticsDirectAnswer, type StatisticsDirectAnswer } from "../lib/statistics/direct-answer";
import { buildStatisticsVisualization, type VisualizationSeriesRow } from "../lib/statistics/visualization";

type QuestionCase = {
  question: string;
  metrics?: StatisticsMetric[];
  categories?: StatisticsCategory[];
  contractTypes?: StatisticsContractType[];
  compareBy?: StatisticsComparisonDimension[];
  adjustForInflation?: boolean;
  chart?: "line" | "bar" | "table";
  answer?: StatisticsDirectAnswer["shortAnswer"];
  expectNull?: boolean;
  expectErrorCode?: string;
};

const currentYear = new Date().getFullYear();
const sampleProducers: ResolvedStatisticsProducer[] = [
  { id: "11111111-1111-1111-1111-111111111111", name: "Producent Alpha" },
  { id: "22222222-2222-2222-2222-222222222222", name: "Producent Beta" },
  { id: "33333333-3333-3333-3333-333333333333", name: "Producent Gamma" },
];

const cases: QuestionCase[] = [];
const add = (entry: QuestionCase) => cases.push(entry);

const realFallQuestions = [
  "Er reallønnen faldet?",
  "Har reallønnen faldet over den periode vi har data på?",
  "Er reallønnen reelt set faldet?",
  "Er købekraften faldet?",
  "Har købekraften mistet værdi?",
  "Er lønnens faktiske købekraft faldet?",
  "Har rettighedshavernes realløn været faldende?",
  "Er der reallønsfald i datasættet?",
  "Er der fald i købekraften for lønnen?",
  "Har lønnen rakt til færre varer?",
  "Er værdien af lønnen målt i købekraft faldet?",
  "Har inflationen betydet reallønsfald?",
  "Er lønnen faldet når prisudviklingen tælles med?",
  "Er reallønnen faldet for spillefilm?",
  "Er reallønnen faldet for dokumentarfilm?",
  "Er købekraften faldet for fiktion?",
  "Er købekraften faldet for dokumentar?",
  "Har reallønnen faldet for A-løn?",
  "Har reallønnen faldet for leverandørkontrakter?",
  "Er reallønnen faldet for kvinder?",
  "Er reallønnen faldet for mænd?",
  "Er den faktiske købekraft faldet siden 2020?",
  "Har reallønnen faldet siden 2021?",
  "Er reallønnen faldet mellem 2020 og 2024?",
  "Er købekraften faldet i spillefilm og dokumentarfilm?",
  "Har reallønnen faldet for A-løn og leverandør?",
  "Er reallønnen faldet for medlemmer?",
  "Er reallønnen faldet for ikke-medlemmer?",
  "Har købekraften faldet for nyuddannede?",
  "Har købekraften faldet for erfarne?",
  "Er reallønnen faldet for klippere?",
  "Er reallønnen faldet for medklippere?",
  "Har reallønnen faldet for filmproducenter?",
  "Har reallønnen faldet for dokumentarproducenter?",
  "Er reallønnen faldet når priserne stiger?",
  "Er købekraften faldet, selvom nominellønnen stiger?",
  "Har pengene rakt til færre varer og tjenester?",
  "Er der tilbagegang i lønnens købekraft?",
  "Er reallønnen faldende i organisationen?",
  "Ja eller nej: er reallønnen faldet?",
];
realFallQuestions.forEach(question => add({ question, metrics: ["median_monthly_salary"], adjustForInflation: true, answer: "Ja" }));

const realRiseQuestions = [
  "Er reallønnen steget?",
  "Har reallønnen haft fremgang?",
  "Er købekraften steget?",
  "Har rettighedshaverne fået råd til mere?",
  "Er lønnens faktiske købekraft forbedret?",
  "Er der reallønsfremgang?",
  "Stiger købekraften over perioden?",
  "Har lønnen rakt til flere varer?",
  "Er værdien af lønnen blevet højere efter inflation?",
  "Har reallønnen steget siden 2020?",
  "Er købekraften steget for spillefilm?",
  "Er købekraften steget for dokumentarfilm?",
  "Har reallønnen steget for A-løn?",
  "Har reallønnen steget for leverandør?",
  "Er reallønnen steget for medlemmer?",
  "Er reallønnen steget for klippere?",
  "Har reallønnen været stigende?",
  "Ja eller nej: er købekraften steget?",
  "Er reallønnen forbedret i datasættet?",
  "Har inflationen efterladt en højere realløn?",
];
realRiseQuestions.forEach(question => add({ question, metrics: ["median_monthly_salary"], adjustForInflation: true, answer: "Nej" }));

const unchangedQuestions = [
  "Er reallønnen uændret?",
  "Har købekraften været uændret?",
  "Matcher lønstigningen inflationen?",
  "Har lønnen fulgt prisudviklingen præcist?",
  "Er der samme købekraft i slutningen af perioden?",
  "Er reallønnen uændret for spillefilm?",
  "Er reallønnen uændret for dokumentarfilm?",
  "Har A-løn fulgt inflationen?",
  "Har leverandørløn fulgt prisudviklingen?",
  "Ja eller nej: er købekraften uændret?",
];
unchangedQuestions.forEach(question => add({ question, metrics: ["median_monthly_salary"], adjustForInflation: true, answer: "Nej" }));

const nominalRiseQuestions = [
  "Er nominel løn steget?",
  "Har nominel løn været stigende?",
  "Er nominellønnen steget over perioden?",
  "Er beløbet på lønsedlen steget?",
  "Er lønnen i kroner og ører steget?",
  "Har den nominelle månedsløn haft fremgang?",
  "Stiger lønnen før inflation?",
  "Er nominel løn steget for spillefilm?",
  "Er nominel løn steget for dokumentarfilm?",
  "Har nominel løn steget for A-løn?",
  "Har nominel løn steget for leverandør?",
  "Er beløbet på lønsedlen steget for medlemmer?",
  "Er nominellønnen steget siden 2020?",
  "Har nominel løn steget mellem 2020 og 2024?",
  "Er lønnen i kroner steget for kvinder?",
  "Er lønnen i kroner steget for mænd?",
  "Har nominellønnen steget for klippere?",
  "Er nominel løn steget for medklippere?",
  "Ja eller nej: er nominel løn steget?",
  "Er den nominelle værdi af lønnen blevet højere?",
];
nominalRiseQuestions.forEach(question => add({ question, metrics: ["median_monthly_salary"], adjustForInflation: false, answer: "Ja" }));

const nominalFallQuestions = [
  "Er nominel løn faldet?",
  "Har nominellønnen været faldende?",
  "Er beløbet på lønsedlen faldet?",
  "Er lønnen i kroner og ører faldet?",
  "Falder lønnen før inflation?",
  "Er nominel løn faldet for spillefilm?",
  "Er nominel løn faldet for dokumentarfilm?",
  "Har nominel løn faldet for A-løn?",
  "Har nominel løn faldet for leverandør?",
  "Ja eller nej: er nominel løn faldet?",
];
nominalFallQuestions.forEach(question => add({ question, metrics: ["median_monthly_salary"], adjustForInflation: false, answer: "Nej" }));

const comparisonQuestions: QuestionCase[] = [
  { question: "Er reallønnen faldet for spillefilm og dokumentarfilm?", categories: ["feature", "documentary"], compareBy: ["category"], answer: "Ja" },
  { question: "Er reallønnen faldet for fiktion og dokumentar?", categories: ["feature", "documentary"], compareBy: ["category"], answer: "Ja" },
  { question: "Er købekraften faldet for dokumentarserie og tv-serie?", categories: ["docSeries", "tvSeries"], compareBy: ["category"], answer: "Ja" },
  { question: "Er reallønnen faldet for kortfilm og reality?", categories: ["short", "reality"], compareBy: ["category"], answer: "Ja" },
  { question: "Er købekraften faldet for tv-underholdning og spillefilm?", categories: ["feature", "tvEntertainment"], compareBy: ["category"], answer: "Ja" },
  { question: "Er reallønnen steget for spillefilm og dokumentarfilm?", categories: ["feature", "documentary"], compareBy: ["category"], answer: "Nej" },
  { question: "Er købekraften steget for fiktion og dokumentar?", categories: ["feature", "documentary"], compareBy: ["category"], answer: "Nej" },
  { question: "Er reallønnen uændret for dokumentarserie og tv-serie?", categories: ["docSeries", "tvSeries"], compareBy: ["category"], answer: "Nej" },
  { question: "Er nominel løn steget for spillefilm og dokumentarfilm?", categories: ["feature", "documentary"], compareBy: ["category"], adjustForInflation: false, answer: "Ja" },
  { question: "Er nominel løn faldet for fiktion og dokumentar?", categories: ["feature", "documentary"], compareBy: ["category"], adjustForInflation: false, answer: "Nej" },
  { question: "Har reallønnen faldet for A-løn og leverandør?", contractTypes: ["a-løn", "leverandør"], compareBy: ["contract_type"], answer: "Ja" },
  { question: "Er købekraften steget for A-løn og faktura?", contractTypes: ["a-løn", "leverandør"], compareBy: ["contract_type"], answer: "Nej" },
  { question: "Er nominel løn steget for A-løn og leverandør?", contractTypes: ["a-løn", "leverandør"], compareBy: ["contract_type"], adjustForInflation: false, answer: "Ja" },
  { question: "Er nominel løn faldet for freelance og A-løn?", contractTypes: ["a-løn", "leverandør"], compareBy: ["contract_type"], adjustForInflation: false, answer: "Nej" },
  { question: "Er reallønnen faldet for kvinder og mænd?", compareBy: ["gender"], answer: "Ja" },
  { question: "Er købekraften steget for mænd og kvinder?", compareBy: ["gender"], answer: "Nej" },
  { question: "Er nominel løn steget for kvinder og mænd?", compareBy: ["gender"], adjustForInflation: false, answer: "Ja" },
  { question: "Er reallønnen faldet for medlemmer og ikke-medlemmer?", compareBy: ["membership_type"], answer: "Ja" },
  { question: "Er reallønnen steget for medlemmer og uorganiserede?", compareBy: ["membership_type"], answer: "Nej" },
  { question: "Er nominel løn steget for medlemmer og uorganiserede?", compareBy: ["membership_type"], adjustForInflation: false, answer: "Ja" },
];
comparisonQuestions.forEach(entry => add({ metrics: ["median_monthly_salary"], adjustForInflation: true, ...entry }));

const dataQuestions: QuestionCase[] = [
  { question: "Hvordan har reallønnen udviklet sig siden 2016?", metrics: ["median_monthly_salary"], adjustForInflation: true },
  { question: "Vis realløn år for år", metrics: ["median_monthly_salary"], adjustForInflation: true },
  { question: "Vis købekraft for løn gennem årene", metrics: ["median_monthly_salary"], adjustForInflation: true },
  { question: "Hvordan har den faktiske købekraft udviklet sig?", metrics: ["median_monthly_salary"], adjustForInflation: true },
  { question: "Vis løn målt i købekraft", metrics: ["median_monthly_salary"], adjustForInflation: true },
  { question: "Hvordan har inflationen påvirket lønnen?", metrics: ["median_monthly_salary"], adjustForInflation: true },
  { question: "Vis prisudviklingens betydning for løn", metrics: ["median_monthly_salary"], adjustForInflation: true },
  { question: "Sammenlign realløn for spillefilm og dokumentarfilm siden 2020", metrics: ["median_monthly_salary"], categories: ["feature", "documentary"], compareBy: ["category"], adjustForInflation: true },
  { question: "Sammenlign købekraft for fiktion og dokumentar siden 2021", metrics: ["median_monthly_salary"], categories: ["feature", "documentary"], compareBy: ["category"], adjustForInflation: true },
  { question: "Søjle over realløn for spillefilm og dokumentarfilm", metrics: ["median_monthly_salary"], categories: ["feature", "documentary"], compareBy: ["category"], adjustForInflation: true, chart: "bar" },
  { question: "Tabel over realløn for A-løn og leverandør", metrics: ["median_monthly_salary"], contractTypes: ["a-løn", "leverandør"], compareBy: ["contract_type"], adjustForInflation: true, chart: "table" },
  { question: "Vis nominel løn år for år", metrics: ["median_monthly_salary"], adjustForInflation: false },
  { question: "Hvordan har nominel løn udviklet sig?", metrics: ["median_monthly_salary"], adjustForInflation: false },
  { question: "Vis beløbet på lønsedlen over tid", metrics: ["median_monthly_salary"], adjustForInflation: false },
  { question: "Sammenlign nominel løn for A-løn og leverandør", metrics: ["median_monthly_salary"], contractTypes: ["a-løn", "leverandør"], compareBy: ["contract_type"], adjustForInflation: false },
  { question: "Sammenlign pension for fiktion og dokumentar", metrics: ["average_pension"], categories: ["feature", "documentary"], compareBy: ["category"], adjustForInflation: false },
  { question: "Sammenlign arbejdsuger for spillefilm og dokumentarfilm", metrics: ["average_working_weeks"], categories: ["feature", "documentary"], compareBy: ["category"], adjustForInflation: false },
  { question: "Hvor mange kontrakter er der for A-løn og leverandør?", metrics: ["contract_count"], contractTypes: ["a-løn", "leverandør"], compareBy: ["contract_type"], adjustForInflation: false, chart: "bar" },
  { question: "Hvordan har Copydan-forbehold udviklet sig?", metrics: ["copydan_share"], adjustForInflation: false },
  { question: "Hvordan har streamingforbehold udviklet sig?", metrics: ["streaming_share"], adjustForInflation: false },
  { question: "Hvordan har royalty udviklet sig?", metrics: ["royalty_share"], adjustForInflation: false },
  { question: "Hvordan har AI-forbehold udviklet sig?", metrics: ["ai_clause_share"], adjustForInflation: false },
  { question: "Vis producentbidrag efter prisudvikling", metrics: ["contributions"], adjustForInflation: true },
  { question: "Vis feriepenge over tid", metrics: ["contributions"], adjustForInflation: false },
  { question: "Vis realløn for nyuddannede og meget erfarne", metrics: ["median_monthly_salary"], compareBy: ["experience_group"], adjustForInflation: true },
  { question: "Vis nominel løn for klippere og medklippere", metrics: ["median_monthly_salary"], compareBy: ["profession_type"], adjustForInflation: false },
  { question: "Hvilke producenter giver bedst realløn?", metrics: ["median_monthly_salary"], compareBy: ["producer"], adjustForInflation: true, chart: "bar" },
  { question: "Hvilke producenter giver bedst nominel løn?", metrics: ["median_monthly_salary"], compareBy: ["producer"], adjustForInflation: false, chart: "bar" },
  { question: "Vis realløn efter producenttype for filmproducenter og dokumentarproducenter", metrics: ["median_monthly_salary"], compareBy: ["producer_type"], adjustForInflation: true },
  { question: "Vis pension efter medlemsstatus", metrics: ["average_pension"], compareBy: ["membership_type"], adjustForInflation: false },
  { question: "Vis lønnen for reality", metrics: ["median_monthly_salary"], categories: ["reality"], adjustForInflation: true },
  { question: "Vis reallønnen for tv-underholdning", metrics: ["median_monthly_salary"], categories: ["tvEntertainment"], adjustForInflation: true },
  { question: "Vis nominellønnen for kortfilm", metrics: ["median_monthly_salary"], categories: ["short"], adjustForInflation: false },
  { question: "Vis købekraften for dokumentarserie", metrics: ["median_monthly_salary"], categories: ["docSeries"], adjustForInflation: true },
  { question: "Vis løn og pension over tid", metrics: ["median_monthly_salary", "average_pension"], adjustForInflation: true },
  { question: "Vis realløn og arbejdsuger for spillefilm", metrics: ["median_monthly_salary", "average_working_weeks"], categories: ["feature"], adjustForInflation: true },
  { question: "Vis nominel løn og Copydan for dokumentarfilm", metrics: ["median_monthly_salary", "copydan_share"], categories: ["documentary"], adjustForInflation: false },
  { question: "Vis købekraft og streamingforbehold for tv-serie", metrics: ["median_monthly_salary", "streaming_share"], categories: ["tvSeries"], adjustForInflation: true },
  { question: "Vis gennemsnitsløn målt i købekraft", metrics: ["average_monthly_salary"], adjustForInflation: true },
  { question: "Vis gennemsnitlig nominel løn", metrics: ["average_monthly_salary"], adjustForInflation: false },
  { question: "Hvordan har reallønnen udviklet sig fra 2020 til 2024?", metrics: ["median_monthly_salary"], adjustForInflation: true },
  { question: "Hvordan har nominel løn udviklet sig mellem 2020 og 2024?", metrics: ["median_monthly_salary"], adjustForInflation: false },
  { question: "Vis realløn i 2024", metrics: ["median_monthly_salary"], adjustForInflation: true },
  { question: "Vis nominel løn i 2024", metrics: ["median_monthly_salary"], adjustForInflation: false },
  { question: "Sammenlign realløn for kvinder og mænd i spillefilm", metrics: ["median_monthly_salary"], categories: ["feature"], compareBy: ["gender"], adjustForInflation: true },
  { question: "Sammenlign nominel løn for kvinder og mænd i dokumentarfilm", metrics: ["median_monthly_salary"], categories: ["documentary"], compareBy: ["gender"], adjustForInflation: false },
  { question: "Sammenlign realløn for medlemmer og ikke-medlemmer i spillefilm", metrics: ["median_monthly_salary"], categories: ["feature"], compareBy: ["membership_type"], adjustForInflation: true },
  { question: "Sammenlign nominel løn for nyuddannede og erfarne", metrics: ["median_monthly_salary"], compareBy: ["experience_group"], adjustForInflation: false },
  { question: "Hvordan har realløn og royalty udviklet sig?", metrics: ["median_monthly_salary", "royalty_share"], adjustForInflation: true },
  { question: "Hvordan har nominel løn og AI-forbehold udviklet sig?", metrics: ["median_monthly_salary", "ai_clause_share"], adjustForInflation: false },
  { question: "Vis reallønsfald for A-løn siden 2020", metrics: ["median_monthly_salary"], contractTypes: ["a-løn"], adjustForInflation: true },
  { question: "Vis reallønsfald for leverandør siden 2020", metrics: ["median_monthly_salary"], contractTypes: ["leverandør"], adjustForInflation: true },
  { question: "Vis nominelløn for A-løn siden 2020", metrics: ["median_monthly_salary"], contractTypes: ["a-løn"], adjustForInflation: false },
  { question: "Vis nominelløn for leverandør siden 2020", metrics: ["median_monthly_salary"], contractTypes: ["leverandør"], adjustForInflation: false },
  { question: "Vis købekraft efter køn", metrics: ["median_monthly_salary"], compareBy: ["gender"], adjustForInflation: true },
  { question: "Vis nominel løn efter køn", metrics: ["median_monthly_salary"], compareBy: ["gender"], adjustForInflation: false },
  { question: "Vis realløn efter medlemsstatus", metrics: ["median_monthly_salary"], compareBy: ["membership_type"], adjustForInflation: true },
  { question: "Vis nominel løn efter medlemsstatus", metrics: ["median_monthly_salary"], compareBy: ["membership_type"], adjustForInflation: false },
  { question: "Vis realløn efter erfaring", metrics: ["median_monthly_salary"], compareBy: ["experience_group"], adjustForInflation: true },
  { question: "Vis nominel løn efter erfaring", metrics: ["median_monthly_salary"], compareBy: ["experience_group"], adjustForInflation: false },
  { question: "Vis realløn efter faggruppe for klippere og medklippere", metrics: ["median_monthly_salary"], compareBy: ["profession_type"], adjustForInflation: true },
  { question: "Vis nominel løn efter faggruppe for klippere og medklippere", metrics: ["median_monthly_salary"], compareBy: ["profession_type"], adjustForInflation: false },
  { question: "Sammenlign realløn for streamere og broadcastere", metrics: ["median_monthly_salary"], compareBy: ["producer_type"], adjustForInflation: true },
  { question: "Sammenlign nominel løn for streamere og broadcastere", metrics: ["median_monthly_salary"], compareBy: ["producer_type"], adjustForInflation: false },
  { question: "Vis realløn som tabel", metrics: ["median_monthly_salary"], adjustForInflation: true, chart: "table" },
  { question: "Vis nominel løn som søjle", metrics: ["median_monthly_salary"], adjustForInflation: false, chart: "bar" },
  { question: "Vis købekraft for løn og pension", metrics: ["median_monthly_salary", "average_pension"], adjustForInflation: true },
  { question: "Vis nominel løn og pension", metrics: ["median_monthly_salary", "average_pension"], adjustForInflation: false },
  { question: "Hvordan har reallønnen påvirket råd til mere siden 2020?", metrics: ["median_monthly_salary"], adjustForInflation: true },
  { question: "Hvordan har lønnen i kroner og ører udviklet sig siden 2020?", metrics: ["median_monthly_salary"], adjustForInflation: false },
];
dataQuestions.forEach(add);

const safeRejections: QuestionCase[] = [
  { question: "Er reallønnen faldet for Steen Johannessen?", expectErrorCode: "person_query_not_allowed" },
  { question: "Hvem har haft størst reallønsfald?", expectErrorCode: "person_query_not_allowed" },
  { question: "Hvad tjener Anna Andersen nominelt?", expectErrorCode: "person_query_not_allowed" },
  { question: "Højest lønnede klipper i realløn", expectErrorCode: "person_query_not_allowed" },
  { question: "Lavest lønnede medlem efter inflation", expectErrorCode: "person_query_not_allowed" },
  { question: "SELECT real_salary FROM contracts", expectNull: true },
  { question: "DROP TABLE statistics", expectNull: true },
  { question: "Vis realløn efter produktionsland", expectNull: true },
  { question: "Vis budgetter korrigeret for inflation", expectNull: true },
  { question: "Hvor mange varer kan Steen købe for sin løn?", expectErrorCode: "person_query_not_allowed" },
];
safeRejections.forEach(add);

assert.equal(cases.length, 200, "Testmatricen skal indeholde præcis 200 nye realløns- og datasætspørgsmål.");

function syntheticRows(plan: StatisticsQueryPlan): VisualizationSeriesRow[] {
  const producers = plan.compareBy.includes("producer") ? sampleProducers : [];
  const segments = buildStatisticsQuerySegments(plan, producers);
  const years = plan.filters.years.length === 1 ? plan.filters.years : [2020, 2024];
  return segments.flatMap((segment, segmentIndex) => plan.metrics.flatMap((metric, metricIndex) => {
    const meta = STATISTICS_METRIC_META[metric];
    return years.map((year, yearIndex) => {
      const nominalSalary = yearIndex === 0 ? 50_000 + segmentIndex * 1_000 : 52_000 + segmentIndex * 1_000;
      const value = meta.unit === "dkk" ? nominalSalary + metricIndex * 500
        : meta.unit === "percent" ? 10 + segmentIndex + metricIndex + yearIndex
          : meta.unit === "weeks" ? 20 + segmentIndex + yearIndex
            : 5 + segmentIndex + yearIndex;
      return {
        year,
        value,
        seriesKey: `${metric}__${segment.key}`,
        seriesLabel: plan.metrics.length > 1
          ? `${meta.label} · ${segment.label}`
          : segment.label === "Samlet resultat" ? meta.label : segment.label,
        metric,
        metricLabel: meta.label,
        unit: meta.unit,
        contractCount: 8 + yearIndex,
        memberCount: 5 + segmentIndex,
        lowSample: false,
        inflationIndex: yearIndex === 0 ? 100 : 112,
        realValue: meta.unit === "dkk" ? (yearIndex === 0 ? 50_000 + segmentIndex * 1_000 : 47_000 + segmentIndex * 1_000) : null,
        realChangePercent: meta.unit === "dkk" && yearIndex === 1 ? -6 : null,
      };
    });
  }));
}

function assertOptionalDeepEqual<T>(actual: T, expected: T | undefined, label: string) {
  if (expected !== undefined) assert.deepEqual(actual, expected, label);
}

for (const [index, entry] of cases.entries()) {
  test(`realløns- og datasætspørgsmål ${index + 1}: ${entry.question}`, () => {
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
    assertOptionalDeepEqual(plan.filters.categories, entry.categories, "categories");
    assertOptionalDeepEqual(plan.filters.contractTypes, entry.contractTypes, "contractTypes");
    assertOptionalDeepEqual(plan.compareBy, entry.compareBy, "compareBy");
    if (entry.adjustForInflation !== undefined) assert.equal(plan.adjustForInflation, entry.adjustForInflation, "adjustForInflation");
    if (entry.chart) assert.equal(plan.chart, entry.chart, "chart");
    if (entry.question.includes("siden 2020")) {
      assert.equal(plan.filters.yearFrom, 2020);
      assert.equal(plan.filters.yearTo, currentYear);
    }

    const rows = syntheticRows(plan);
    assert.ok(rows.length > 0, "Testdatasættet skal give synlige aggregerede rækker.");
    const visualization = buildStatisticsVisualization(rows, plan.chart);
    assert.ok(visualization.datasets.length > 0, "Resultatet skal kunne visualiseres eller vises som tabel.");

    if (entry.answer) {
      const answer = buildStatisticsDirectAnswer(entry.question, rows);
      assert.ok(answer, "Ja/nej-spørgsmålet skal give et direkte tekstsvar.");
      assert.equal(answer.shortAnswer, entry.answer);
      assert.match(answer.sentence, /^(Ja|Nej|Delvist|Kan ikke besvares)/);
      assert.ok(answer.basis.length > 0, "Svaret skal dokumentere sammenligningsgrundlaget.");
    }
  });
}
