import assert from "node:assert/strict";
import test from "node:test";
import {
  extractStatisticsSeries,
  parseStatisticsQueryPlan,
  predefinedStatisticsQueryPlan,
  STATISTICS_QUERY_PLAN_SCHEMA,
} from "../lib/statistics-query-plan";

function collectSchemaKeys(value: unknown, result = new Set<string>()) {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaKeys(item, result);
    return result;
  }
  for (const [key, child] of Object.entries(value)) {
    result.add(key);
    collectSchemaKeys(child, result);
  }
  return result;
}

test("queryplanschemaet kan sendes direkte til Anthropic Structured Outputs", () => {
  const keys = collectSchemaKeys(STATISTICS_QUERY_PLAN_SCHEMA);
  for (const unsupported of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"]) {
    assert.equal(keys.has(unsupported), false, `${unsupported} må ikke sendes til Anthropic`);
  }
});

test("queryplan accepterer flere mål, sammenligninger og renser fritekstfiltre", () => {
  const plan = parseStatisticsQueryPlan({
    metrics: ["median_monthly_salary", "average_pension"],
    groupBy: "year",
    compareBy: ["producer"],
    chart: "line",
    adjustForInflation: true,
    filters: { producerNames: ["  Nordisk Film  "], professionTypes: [" Klipper "], experienceGroups: ["experienced"], years: [2025] },
  });
  assert.deepEqual(plan.metrics, ["median_monthly_salary", "average_pension"]);
  assert.deepEqual(plan.compareBy, ["producer"]);
  assert.deepEqual(plan.filters.producerNames, ["Nordisk Film"]);
  assert.deepEqual(plan.filters.professionTypes, ["Klipper"]);
  assert.deepEqual(plan.filters.years, [2025]);
  assert.deepEqual(plan.filters.experienceGroups, ["experienced"]);
  assert.equal(plan.adjustForInflation, true);
});

test("queryplan afviser ukendte mål og fri SQL", () => {
  assert.throws(() => parseStatisticsQueryPlan({ metrics: ["select * from contracts"], groupBy: "year", filters: {} }));
});

test("serien indeholder kun aggregerede værdier og korrekt måleenhed", () => {
  assert.deepEqual(extractStatisticsSeries("contract_count", { contractCounts: [{ year: 2025, total: 12, contractCount: 12, memberCount: 10, validatedCount: 9, draftCount: 3, lowSample: false, secret: "nej" }] }), [
    { year: 2025, value: 12, contractCount: 12, memberCount: 10, validatedCount: 9, draftCount: 3, lowSample: false, seriesKey: "result", seriesLabel: "Resultat", metric: "contract_count", metricLabel: "Antal kontrakter", unit: "count", suppressed: false, suppressionReason: undefined, outlierExcludedCount: 0 },
  ]);
});

test("slørede statistikceller bliver ikke til AI-serier", () => {
  const rows = extractStatisticsSeries("median_monthly_salary", {
    salary: [
      { year: 2025, monthlyRate: null, contractCount: 2, memberCount: 2, suppressed: true, suppressionReason: "minimum_count" },
      { year: 2026, monthlyRate: 45_000, contractCount: 5, memberCount: 5, suppressed: false },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].year, 2026);
});

test("median og gennemsnitlig løn bruger forskellige aggregerede værdier", () => {
  const statistics = { salary: [{ year: 2025, monthlyRate: 44_000, averageMonthlyRate: 49_000, contractCount: 8, memberCount: 6 }] };
  assert.equal(extractStatisticsSeries("median_monthly_salary", statistics)[0].value, 44_000);
  assert.equal(extractStatisticsSeries("average_monthly_salary", statistics)[0].value, 49_000);
});

test("queryplan understøtter flere år, kategorier, kontrakttyper og producenter med faste grænser", () => {
  const plan = parseStatisticsQueryPlan({
    metrics: ["median_monthly_salary"], groupBy: "year", compareBy: ["category"], chart: "line", adjustForInflation: false,
    filters: {
      years: [2025, 2023, 2025], categories: ["feature", "documentary", "ukendt"],
      contractTypes: ["a-løn", "leverandør"], producerNames: ["A", "B", "C", "D", "E", "F"], membershipTypes: ["member", "none"],
    },
  });
  assert.deepEqual(plan.filters.years, [2023, 2025]);
  assert.deepEqual(plan.filters.categories, ["feature", "documentary"]);
  assert.deepEqual(plan.filters.contractTypes, ["a-løn", "leverandør"]);
  assert.deepEqual(plan.filters.producerNames, ["A", "B", "C", "D", "E"]);
});

test("siden et år udvides til alle år frem til indeværende år", () => {
  const currentYear = new Date().getFullYear();
  const plan = parseStatisticsQueryPlan({
    metrics: ["median_monthly_salary"], groupBy: "year", compareBy: [], chart: "line", adjustForInflation: true,
    filters: { years: [], yearFrom: 2022, yearTo: null },
  });
  assert.equal(plan.filters.yearFrom, 2022);
  assert.equal(plan.filters.yearTo, currentYear);
  assert.deepEqual(plan.filters.years, Array.from({ length: currentYear - 2022 + 1 }, (_, index) => 2022 + index));
});

test("spillefilm og dokumentarfilm giver separate serier", () => {
  const plan = predefinedStatisticsQueryPlan("Hvordan har medianlønnen for spillefilm og dokumentarfilm udviklet sig siden 2022?");
  assert.deepEqual(plan?.metrics, ["median_monthly_salary"]);
  assert.deepEqual(plan?.filters.categories, ["feature", "documentary"]);
  assert.deepEqual(plan?.compareBy, ["category"]);
});

test("A-løn og leverandør giver separate kurver", () => {
  const plan = predefinedStatisticsQueryPlan("Sammenlign gennemsnitslønnen for A-løn og leverandørkontrakter over alle år.");
  assert.deepEqual(plan?.metrics, ["average_monthly_salary"]);
  assert.deepEqual(plan?.filters.contractTypes, ["a-løn", "leverandør"]);
  assert.deepEqual(plan?.compareBy, ["contract_type"]);
});

test("antal A-løns- og leverandørkontrakter forveksles ikke med lønstatistik", () => {
  const plan = predefinedStatisticsQueryPlan("Hvor mange A-løns- og leverandørkontrakter er der registreret pr. år?");
  assert.deepEqual(plan?.metrics, ["contract_count"]);
  assert.deepEqual(plan?.compareBy, ["contract_type"]);
  assert.equal(plan?.chart, "bar");
});

test("flere produktive mål kan forespørges sammen", () => {
  const plan = predefinedStatisticsQueryPlan("Sammenlign pension og arbejdsuger for spillefilm og dokumentarfilm siden 2022.");
  assert.deepEqual(plan?.metrics, ["average_pension", "average_working_weeks"]);
  assert.deepEqual(plan?.compareBy, ["category"]);
});

test("rettighedsforbehold bliver selvstændige procentmål", () => {
  const plan = predefinedStatisticsQueryPlan("Hvordan har Copydan- og streamingforbehold udviklet sig over alle år?");
  assert.deepEqual(plan?.metrics, ["copydan_share", "streaming_share"]);
});

test("løn, Copydan og streaming bevares som tre mål i ét spørgsmål", () => {
  const plan = predefinedStatisticsQueryPlan("Hvordan har andelen med Copydan- og streamingforbehold udviklet sig over alle år sammenholdt med løn?");
  assert.deepEqual(plan?.metrics, ["median_monthly_salary", "copydan_share", "streaming_share"]);
});

test("queryplan kan bevare fire målepunkter", () => {
  const plan = parseStatisticsQueryPlan({
    metrics: ["median_monthly_salary", "average_pension", "copydan_share", "streaming_share"],
    groupBy: "year", compareBy: [], chart: "line", adjustForInflation: false, filters: {},
  });
  assert.equal(plan.metrics.length, 4);
});

test("fordeling uden konkrete faste værdier får sikre standardgrupper", () => {
  const plan = parseStatisticsQueryPlan({
    metrics: ["contract_count"], groupBy: "year", compareBy: ["contract_type"], chart: "bar", adjustForInflation: false, filters: {},
  });
  assert.deepEqual(plan.filters.contractTypes, ["a-løn", "leverandør"]);
});

test("queryplan accepterer ufarlige ældre modelvariationer", () => {
  const plan = parseStatisticsQueryPlan({ metric: "pension", group_by: "år", filters: {}, chart: "line" });
  assert.deepEqual(plan.metrics, ["average_pension"]);
  assert.equal(plan.groupBy, "year");
});

test("navngivne producentspørgsmål overlades til registermatch via AI", () => {
  assert.equal(predefinedStatisticsQueryPlan("Hvordan er lønnen hos producent Nordisk Film?"), null);
});

test("producentrangering bliver forstået som producentsammenligning", () => {
  const plan = predefinedStatisticsQueryPlan("Hvilke producenter giver bedst løn?");
  assert.deepEqual(plan?.metrics, ["median_monthly_salary"]);
  assert.deepEqual(plan?.compareBy, ["producer"]);
  assert.deepEqual(plan?.filters.producerNames, []);
  assert.equal(plan?.chart, "bar");
});

test("almindelige danske formuleringer giver forventede sikre mål", () => {
  const cases: Array<[string, string[], string[]]> = [
    ["Hvordan har medianlønnen udviklet sig?", ["median_monthly_salary"], []],
    ["Vis den gennemsnitlige løn over tid", ["average_monthly_salary"], []],
    ["Hvordan har pensionsprocenten udviklet sig?", ["average_pension"], []],
    ["Vis medianen for arbejdsuger", ["median_working_weeks"], []],
    ["Vis producentbidragene pr. år", ["contributions"], []],
    ["Sammenlign løn for kvinder og mænd", ["median_monthly_salary"], ["gender"]],
    ["Vis pension efter kontrakttype", ["average_pension"], ["contract_type"]],
    ["Sammenlign løn for spillefilm og dokumentarfilm for A-løn og leverandør", ["median_monthly_salary"], ["category", "contract_type"]],
  ];
  for (const [question, expectedMetrics, expectedDimensions] of cases) {
    const plan = predefinedStatisticsQueryPlan(question);
    assert.ok(plan, question);
    if (expectedMetrics.length) assert.deepEqual(plan.metrics, expectedMetrics, question);
    assert.deepEqual(plan.compareBy, expectedDimensions, question);
  }
});

test("fri SQL og personforespørgsler bliver aldrig fortolket som en sikker standardplan", () => {
  assert.equal(predefinedStatisticsQueryPlan("SELECT salary FROM contracts"), null);
  assert.throws(() => predefinedStatisticsQueryPlan("Hvad tjener Steen Johannessen?"), /identificerbare personer/);
});
