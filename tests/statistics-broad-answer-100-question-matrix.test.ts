import assert from "node:assert/strict";
import test from "node:test";
import { buildStatisticsQuerySegments, type ResolvedStatisticsProducer } from "../lib/statistics-query-execution";
import {
  predefinedStatisticsQueryPlan,
  STATISTICS_METRIC_META,
  type StatisticsComparisonDimension,
  type StatisticsMetric,
  type StatisticsQueryPlan,
} from "../lib/statistics-query-plan";
import { buildStatisticsDirectAnswer, type StatisticsDirectAnswer } from "../lib/statistics/direct-answer";
import { buildStatisticsVisualization, type VisualizationSeriesRow } from "../lib/statistics/visualization";

type BroadQuestionCase = {
  question: string;
  metrics?: StatisticsMetric[];
  compareBy?: StatisticsComparisonDimension[];
  producerNames?: string[];
  chart?: "line" | "bar" | "table";
  answer?: StatisticsDirectAnswer["shortAnswer"];
};

const currentYear = new Date().getFullYear();
const questions: BroadQuestionCase[] = [
  { question: "Får en klipper mere end 10.000 om ugen i normal løn?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Får klippere over 10000 kr pr uge?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Tjener klippere mindst 10.000 kr. om ugen?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Ligger normal løn for klippere over 10.000 kroner per uge?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Er ugelønnen for klippere over 10k?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Er medianlønnen mere end 10.000 kr./uge?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Er gennemsnitslønnen mere end 10.000 kr. om ugen?", metrics: ["average_monthly_salary"], answer: "Ja" },
  { question: "Får en klipper under 10.000 om ugen?", metrics: ["median_monthly_salary"], answer: "Nej" },
  { question: "Ligger lønnen højst 10.000 kr. pr uge?", metrics: ["median_monthly_salary"], answer: "Nej" },
  { question: "Er normal betaling mindre end 10.000 kroner om ugen?", metrics: ["median_monthly_salary"], answer: "Nej" },
  { question: "Får klippere mere end 15.000 om ugen?", metrics: ["median_monthly_salary"], answer: "Nej" },
  { question: "Er ugelønnen mindst 15.000 kr.?", metrics: ["median_monthly_salary"], answer: "Nej" },
  { question: "Ligger ugelønnen under 15.000 kr.?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Er lønnen højst 15.000 kr. om ugen?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Er månedslønnen over 50.000 kr.?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Får klippere mere end 50.000 kr. om måneden?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Er gennemsnitlig månedsløn over 50.000 kr.?", metrics: ["average_monthly_salary"], answer: "Ja" },
  { question: "Er månedslønnen under 50.000 kr.?", metrics: ["median_monthly_salary"], answer: "Nej" },
  { question: "Ligger lønnen over 3.000 kr. om dagen?", metrics: ["median_monthly_salary"], answer: "Nej" },
  { question: "Er dagslønnen under 3.000 kr.?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Får A-lønnede klippere mere end 10.000 om ugen?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Får freelanceklippere over 10.000 kr. pr uge?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Får klippere på spillefilm over 10.000 kr. om ugen?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Får dokumentarklippere mere end 10.000 kr. om ugen?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Er ugelønnen for kvinder over 10.000 kr.?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Er ugelønnen for mænd over 10.000 kr.?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Er ugelønnen for medlemmer over 10.000 kr.?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Er ugelønnen for ikke-medlemmer over 10.000 kr.?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Er honoraret for klippeassistenter over 10.000 kr. om ugen?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Ligger snitlønnen for medklippere over 10.000 kr. om ugen?", metrics: ["average_monthly_salary"], answer: "Ja" },

  { question: "Hvilket produktionsselskab giver mest i løn i snit?", metrics: ["average_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Hvilke produktionsselskaber giver bedst gennemsnitsløn?", metrics: ["average_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Hvilke producenter betaler mest i snit?", metrics: ["average_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Top producenter efter gennemsnitlig løn", metrics: ["average_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Hvilke producenter giver bedst løn?", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Hvilket produktionsselskab betaler bedst?", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Top produktionsselskaber efter løn", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Bedste producenter efter løn for spillefilm", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Hvilke producenter giver bedst løn i dokumentarfilm?", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Producenter betaler bedst for A-løn", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Hvilke producenter giver mest honorar for leverandørkontrakter?", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Hvilke produktionsselskaber har højeste gennemsnit siden 2022?", metrics: ["average_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Hvilke producenter giver højeste løn i spillefilm siden 2020?", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Hvilke producenter giver bedst realløn?", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Hvilke produktionsselskaber giver bedst nominel løn?", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Vis løn efter producent", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Vis gennemsnitsløn efter producent", metrics: ["average_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Søjle med producenter efter løn", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Oversigt over producenter efter snitløn", metrics: ["average_monthly_salary"], compareBy: ["producer"], chart: "table" },
  { question: "Tabel over produktionsselskaber efter løn", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "table" },

  { question: "Vis lønkurve for producent Alpha Film", metrics: ["median_monthly_salary"], producerNames: ["Alpha Film"], chart: "line" },
  { question: "Vis løngraf for producent Beta TV", metrics: ["median_monthly_salary"], producerNames: ["Beta TV"], chart: "line" },
  { question: "Hvordan har lønnen udviklet sig for produktionsselskab Gamma Dokumentar?", metrics: ["median_monthly_salary"], producerNames: ["Gamma Dokumentar"], chart: "line" },
  { question: "Vis gennemsnitsløn for producent Alpha Film over tid", metrics: ["average_monthly_salary"], producerNames: ["Alpha Film"], chart: "line" },
  { question: "Vis snitløn for produktionsselskab Beta TV siden 2022", metrics: ["average_monthly_salary"], producerNames: ["Beta TV"], chart: "line" },
  { question: "Vis realløn for producent Gamma Dokumentar siden 2020", metrics: ["median_monthly_salary"], producerNames: ["Gamma Dokumentar"], chart: "line" },
  { question: "Vis nominel løn for producent Alpha Film", metrics: ["median_monthly_salary"], producerNames: ["Alpha Film"], chart: "line" },
  { question: "Er ugelønnen for producent Alpha Film over 10.000 kr.?", metrics: ["median_monthly_salary"], producerNames: ["Alpha Film"], answer: "Ja" },
  { question: "Er snitlønnen for producent Beta TV over 10.000 kr. om ugen?", metrics: ["average_monthly_salary"], producerNames: ["Beta TV"], answer: "Ja" },
  { question: "Er lønnen for produktionsselskab Gamma Dokumentar under 10.000 kr. pr uge?", metrics: ["median_monthly_salary"], producerNames: ["Gamma Dokumentar"], answer: "Nej" },
  { question: "Sammenlign lønkurve for producent Alpha Film og producent Beta TV", metrics: ["median_monthly_salary"], compareBy: ["producer"], producerNames: ["Alpha Film", "Beta TV"], chart: "line" },
  { question: "Sammenlign gennemsnitsløn for producent Alpha Film og producent Gamma Dokumentar", metrics: ["average_monthly_salary"], compareBy: ["producer"], producerNames: ["Alpha Film", "Gamma Dokumentar"], chart: "line" },
  { question: "Vis løngraf for produktionsselskab Alpha Film og produktionsselskab Beta TV", metrics: ["median_monthly_salary"], compareBy: ["producer"], producerNames: ["Alpha Film", "Beta TV"], chart: "line" },
  { question: "Vis løn for producent Alpha Film i spillefilm", metrics: ["median_monthly_salary"], producerNames: ["Alpha Film"], chart: "line" },
  { question: "Vis løn for producent Beta TV i tv-serie", metrics: ["median_monthly_salary"], producerNames: ["Beta TV"], chart: "line" },
  { question: "Vis løn for producent Gamma Dokumentar i dokumentarfilm", metrics: ["median_monthly_salary"], producerNames: ["Gamma Dokumentar"], chart: "line" },
  { question: "Vis pension for producent Alpha Film", metrics: ["average_pension"], producerNames: ["Alpha Film"], chart: "line" },
  { question: "Vis arbejdsuger for producent Beta TV", metrics: ["average_working_weeks"], producerNames: ["Beta TV"], chart: "line" },
  { question: "Vis antal kontrakter for producent Gamma Dokumentar", metrics: ["contract_count"], producerNames: ["Gamma Dokumentar"], chart: "line" },
  { question: "Tabel over løn for producent Alpha Film", metrics: ["median_monthly_salary"], producerNames: ["Alpha Film"], chart: "table" },

  { question: "Lønkurve for A-løn og leverandør siden 2016", metrics: ["median_monthly_salary"], compareBy: ["contract_type"], chart: "line" },
  { question: "Sammenlign ugeløn for spillefilm og dokumentarfilm siden 2016", metrics: ["median_monthly_salary"], compareBy: ["category"], chart: "line" },
  { question: "Sammenlign snitløn for fiktion og dokumentar over tid", metrics: ["average_monthly_salary"], compareBy: ["category"], chart: "line" },
  { question: "Vis pension for fiktion og dokumentar over tid", metrics: ["average_pension"], compareBy: ["category"], chart: "line" },
  { question: "Vis arbejdsuger for spillefilm og dokumentarfilm over tid", metrics: ["average_working_weeks"], compareBy: ["category"], chart: "line" },
  { question: "Hvor mange kontrakter er der for A-løn og leverandør pr. år?", metrics: ["contract_count"], compareBy: ["contract_type"], chart: "bar" },
  { question: "Sammenlign løn for medlemmer og ikke-medlemmer over tid", metrics: ["median_monthly_salary"], compareBy: ["membership_type"], chart: "line" },
  { question: "Sammenlign løn for kvinder og mænd over tid", metrics: ["median_monthly_salary"], compareBy: ["gender"], chart: "line" },
  { question: "Sammenlign løn for klippere og medklippere over tid", metrics: ["median_monthly_salary"], compareBy: ["profession_type"], chart: "line" },
  { question: "Sammenlign løn for nyuddannede og meget erfarne over tid", metrics: ["median_monthly_salary"], compareBy: ["experience_group"], chart: "line" },
  { question: "Vis realløn for A-løn og leverandør siden 2020", metrics: ["median_monthly_salary"], compareBy: ["contract_type"], chart: "line" },
  { question: "Vis nominel løn for A-løn og leverandør siden 2020", metrics: ["median_monthly_salary"], compareBy: ["contract_type"], chart: "line" },
  { question: "Vis Copydan og streaming over tid", metrics: ["copydan_share", "streaming_share"], chart: "line" },
  { question: "Vis løn og pension for spillefilm over tid", metrics: ["median_monthly_salary", "average_pension"], chart: "line" },
  { question: "Vis løn og arbejdsuger for dokumentarfilm over tid", metrics: ["median_monthly_salary", "average_working_weeks"], chart: "line" },
  { question: "Tabel med løn og pension for klippere", metrics: ["median_monthly_salary", "average_pension"], chart: "table" },
  { question: "Søjle med løn for kvinder og mænd", metrics: ["median_monthly_salary"], compareBy: ["gender"], chart: "bar" },
  { question: "Søjle med gennemsnitsløn for A-løn og leverandør", metrics: ["average_monthly_salary"], compareBy: ["contract_type"], chart: "bar" },
  { question: "Vis producentbidrag fra 2020 til 2025", metrics: ["contributions"], chart: "line" },
  { question: "Vis royalty og AI-forbehold gennem årene", metrics: ["royalty_share", "ai_clause_share"], chart: "line" },
  { question: "Vis løn for streamere og broadcastere over tid", metrics: ["median_monthly_salary"], compareBy: ["producer_type"], chart: "line" },
  { question: "Vis pension for tv-producenter og dokumentarproducenter", metrics: ["average_pension"], compareBy: ["producer_type"], chart: "line" },
  { question: "Vis arbejdsuger for filmproducenter og reklameproducenter", metrics: ["average_working_weeks"], compareBy: ["producer_type"], chart: "line" },
  { question: "Vis løn for 0-3 år og 4-7 år over tid", metrics: ["median_monthly_salary"], compareBy: ["experience_group"], chart: "line" },
  { question: "Vis løn for 8-17 år og 18+ over tid", metrics: ["median_monthly_salary"], compareBy: ["experience_group"], chart: "line" },
  { question: "Vis snitløn for klippeassistenter over tid", metrics: ["average_monthly_salary"], chart: "line" },
  { question: "Er reallønnen faldet for klippere?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Er nominel løn steget for klippere?", metrics: ["median_monthly_salary"], answer: "Ja" },
  { question: "Er købekraften steget for A-løn og leverandør?", metrics: ["median_monthly_salary"], compareBy: ["contract_type"], answer: "Nej" },
  { question: "Er gennemsnitslønnen over 50.000 kr. om måneden for spillefilm?", metrics: ["average_monthly_salary"], answer: "Ja" },
];

assert.equal(questions.length, 100, "Testmatricen skal indeholde præcis 100 brede statistikspørgsmål.");

function producersFor(plan: StatisticsQueryPlan): ResolvedStatisticsProducer[] {
  if (plan.filters.producerNames.length) {
    return plan.filters.producerNames.map((name, index) => ({
      id: `${index + 1}`.repeat(8).slice(0, 8) + "-1111-4111-8111-111111111111",
      name,
    }));
  }
  return [
    { id: "11111111-1111-4111-8111-111111111111", name: "Alpha Film" },
    { id: "22222222-2222-4222-8222-222222222222", name: "Beta TV" },
    { id: "33333333-3333-4333-8333-333333333333", name: "Gamma Dokumentar" },
  ];
}

function syntheticRows(plan: StatisticsQueryPlan): VisualizationSeriesRow[] {
  const segments = buildStatisticsQuerySegments(plan, producersFor(plan));
  const years = plan.filters.years.length === 1 ? plan.filters.years : [2020, currentYear];
  return segments.flatMap((segment, segmentIndex) => plan.metrics.flatMap((metric, metricIndex) => {
    const meta = STATISTICS_METRIC_META[metric];
    return years.map((year, yearIndex) => {
      const salaryValue = metric === "average_monthly_salary" ? 58_000 : 56_000;
      return {
        year,
        value: meta.unit === "dkk" ? salaryValue + segmentIndex * 1_000 + yearIndex * 400
          : meta.unit === "percent" ? 7 + segmentIndex + yearIndex
            : meta.unit === "weeks" ? 18 + segmentIndex + yearIndex
              : 6 + segmentIndex + metricIndex + yearIndex,
        realValue: meta.unit === "dkk" ? salaryValue - 4_000 + segmentIndex * 1_000 - yearIndex * 500 : null,
        seriesKey: `${metric}__${segment.key}`,
        seriesLabel: plan.metrics.length > 1 ? `${meta.label} · ${segment.label}` : segment.label,
        metric,
        metricLabel: meta.label,
        unit: meta.unit,
        contractCount: 8,
        memberCount: 5,
        lowSample: false,
      };
    });
  }));
}

for (const [index, entry] of questions.entries()) {
  test(`bredt statistikspørgsmål ${index + 1}: ${entry.question}`, () => {
    const plan = predefinedStatisticsQueryPlan(entry.question);
    assert.ok(plan, "Spørgsmålet skal kunne fortolkes deterministisk.");
    if (entry.metrics) assert.deepEqual(plan.metrics, entry.metrics, "metrics");
    if (entry.compareBy) assert.deepEqual(plan.compareBy, entry.compareBy, "compareBy");
    if (entry.producerNames) assert.deepEqual(plan.filters.producerNames, entry.producerNames, "producerNames");
    if (entry.chart) assert.equal(plan.chart, entry.chart, "chart");

    const segments = buildStatisticsQuerySegments(plan, producersFor(plan));
    assert.ok(segments.length > 0, "Spørgsmålet skal kunne blive til mindst ét sikkert serversegment.");
    const rows = syntheticRows(plan);
    assert.ok(rows.length > 0, "Spørgsmålet skal give aggregerede syntetiske resultatrækker.");
    const visualization = buildStatisticsVisualization(rows, plan.chart);
    assert.ok(visualization.rows.length > 0, "Resultatet skal kunne visualiseres.");
    if (entry.chart === "table") assert.equal(visualization.chart, "table");
    if (entry.answer) {
      const directAnswer = buildStatisticsDirectAnswer(entry.question, rows);
      assert.ok(directAnswer, "Spørgsmålet skal give et direkte ja/nej-svar.");
      assert.equal(directAnswer.shortAnswer, entry.answer);
      assert.match(directAnswer.sentence, /^(Ja|Nej|Delvist|Kan ikke besvares)/);
    }
  });
}
