import assert from "node:assert/strict";
import test from "node:test";
import {
  predefinedStatisticsQueryPlan,
  StatisticsQueryPlanError,
  type StatisticsCategory,
  type StatisticsComparisonDimension,
  type StatisticsContractType,
  type StatisticsExperienceGroup,
  type StatisticsGender,
  type StatisticsMetric,
  type StatisticsMembershipType,
} from "../lib/statistics-query-plan";

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

const questions: ExpectedQuestionResult[] = [
  { question: "Hvordan har medianlønnen udviklet sig?", metrics: ["median_monthly_salary"], compareBy: [], chart: "line", adjustForInflation: true },
  { question: "Vis den gennemsnitlige løn over tid", metrics: ["average_monthly_salary"], compareBy: [], chart: "line", adjustForInflation: true },
  { question: "Hvordan ligger lønnen år for år?", metrics: ["median_monthly_salary"], compareBy: [], chart: "line" },
  { question: "Vis ugeløn over tid", metrics: ["median_monthly_salary"], compareBy: [], chart: "line" },
  { question: "Hvordan har månedslønnen ændret sig?", metrics: ["median_monthly_salary"], compareBy: [], chart: "line" },
  { question: "Hvordan har pensionsprocenten udviklet sig?", metrics: ["average_pension"], compareBy: [], chart: "line", adjustForInflation: false },
  { question: "Vis pension over tid", metrics: ["average_pension"], compareBy: [], chart: "line" },
  { question: "Vis medianen for arbejdsuger", metrics: ["median_working_weeks"], compareBy: [], chart: "line" },
  { question: "Hvordan har arbejdsuger udviklet sig?", metrics: ["average_working_weeks"], compareBy: [], chart: "line" },
  { question: "Vis antal uger pr. år", metrics: ["average_working_weeks"], compareBy: [], chart: "line" },
  { question: "Hvor mange kontrakter er der pr. år?", metrics: ["contract_count"], compareBy: [], chart: "line" },
  { question: "Vis antal kontrakter siden 2022", metrics: ["contract_count"], yearFrom: 2022, yearTo: currentYear },
  { question: "Vis kontraktantal i 2024", metrics: ["contract_count"], years: [2024] },
  { question: "Vis producentbidragene pr. år", metrics: ["contributions"], compareBy: [] },
  { question: "Hvordan har feriepenge udviklet sig?", metrics: ["contributions"], compareBy: [] },
  { question: "Vis beta bidrag siden 2020", metrics: ["contributions"], yearFrom: 2020, yearTo: currentYear },
  { question: "Hvordan har Copydan-forbehold udviklet sig?", metrics: ["copydan_share"], compareBy: [] },
  { question: "Hvordan har streamingforbehold udviklet sig?", metrics: ["streaming_share"], compareBy: [] },
  { question: "Hvordan har royalty udviklet sig?", metrics: ["royalty_share"], compareBy: [] },
  { question: "Hvordan har AI-forbehold udviklet sig?", metrics: ["ai_clause_share"], compareBy: [] },
  { question: "Hvordan har data-mining forbehold udviklet sig?", metrics: ["ai_clause_share"], compareBy: [] },
  { question: "Vis Copydan og streaming over alle år", metrics: ["copydan_share", "streaming_share"], compareBy: [] },
  { question: "Vis Copydan, streaming og royalty", metrics: ["copydan_share", "streaming_share", "royalty_share"], compareBy: [] },
  { question: "Hvordan hænger løn, Copydan og streaming sammen?", metrics: ["median_monthly_salary", "copydan_share", "streaming_share"], compareBy: [] },
  { question: "Sammenlign gennemsnitsløn, pension, arbejdsuger og Copydan", metrics: ["average_monthly_salary", "average_pension", "average_working_weeks", "copydan_share"], compareBy: [] },
  { question: "Hvordan er lønnen for spillefilm?", metrics: ["median_monthly_salary"], categories: ["feature"], compareBy: [] },
  { question: "Hvordan er lønnen for fiktion?", metrics: ["median_monthly_salary"], categories: ["feature"], compareBy: [] },
  { question: "Hvordan er lønnen for fiktionsfilm?", metrics: ["median_monthly_salary"], categories: ["feature"], compareBy: [] },
  { question: "Hvordan er lønnen for fiction?", metrics: ["median_monthly_salary"], categories: ["feature"], compareBy: [] },
  { question: "Hvordan er lønnen for dokumentarfilm?", metrics: ["median_monthly_salary"], categories: ["documentary"], compareBy: [] },
  { question: "Hvordan er lønnen for dokumentar?", metrics: ["median_monthly_salary"], categories: ["documentary"], compareBy: [] },
  { question: "Hvordan er lønnen for dokumentarserie?", metrics: ["median_monthly_salary"], categories: ["docSeries"], compareBy: [] },
  { question: "Hvordan er lønnen for tv-serie?", metrics: ["median_monthly_salary"], categories: ["tvSeries"], compareBy: [] },
  { question: "Hvordan er lønnen for tv serie?", metrics: ["median_monthly_salary"], categories: ["tvSeries"], compareBy: [] },
  { question: "Hvordan er lønnen for kortfilm?", metrics: ["median_monthly_salary"], categories: ["short"], compareBy: [] },
  { question: "Hvordan er lønnen for reality?", metrics: ["median_monthly_salary"], categories: ["reality"], compareBy: [] },
  { question: "Hvordan er lønnen for tv-underholdning?", metrics: ["median_monthly_salary"], categories: ["tvEntertainment"], compareBy: [] },
  { question: "Hvordan er lønnen for tv underholdning?", metrics: ["median_monthly_salary"], categories: ["tvEntertainment"], compareBy: [] },
  { question: "Sammenlign løn for spillefilm og dokumentarfilm", metrics: ["median_monthly_salary"], categories: ["feature", "documentary"], compareBy: ["category"] },
  { question: "Løn forskel på fiktion og dokumentar over tid", metrics: ["median_monthly_salary"], categories: ["feature", "documentary"], compareBy: ["category"], chart: "line" },
  { question: "Sammenlign pension for dokumentarserie og tv-serie", metrics: ["average_pension"], categories: ["docSeries", "tvSeries"], compareBy: ["category"] },
  { question: "Sammenlign løn for kortfilm og reality", metrics: ["median_monthly_salary"], categories: ["short", "reality"], compareBy: ["category"] },
  { question: "Sammenlign arbejdsuger for tv-underholdning og spillefilm", metrics: ["average_working_weeks"], categories: ["feature", "tvEntertainment"], compareBy: ["category"] },
  { question: "Medianløn for spillefilm og dokumentarfilm siden 2016", metrics: ["median_monthly_salary"], categories: ["feature", "documentary"], compareBy: ["category"], yearFrom: 2016, yearTo: currentYear },
  { question: "Pension for fiktion og dokumentar siden 2022", metrics: ["average_pension"], categories: ["feature", "documentary"], compareBy: ["category"], yearFrom: 2022, yearTo: currentYear },
  { question: "Hvordan er lønnen for A-løn?", metrics: ["median_monthly_salary"], contractTypes: ["a-løn"], compareBy: [] },
  { question: "Hvordan er lønnen for leverandørkontrakter?", metrics: ["median_monthly_salary"], contractTypes: ["leverandør"], compareBy: [] },
  { question: "Hvordan er lønnen for faktura?", metrics: ["median_monthly_salary"], contractTypes: ["leverandør"], compareBy: [] },
  { question: "Hvordan er lønnen for freelance?", metrics: ["median_monthly_salary"], contractTypes: ["leverandør"], compareBy: [] },
  { question: "Sammenlign gennemsnitslønnen for A-løn og leverandørkontrakter", metrics: ["average_monthly_salary"], contractTypes: ["a-løn", "leverandør"], compareBy: ["contract_type"] },
  { question: "Sammenlign pension for faktura og A-løn", metrics: ["average_pension"], contractTypes: ["a-løn", "leverandør"], compareBy: ["contract_type"] },
  { question: "Vis antal kontrakter efter kontrakttype", metrics: ["contract_count"], contractTypes: ["a-løn", "leverandør"], compareBy: ["contract_type"], chart: "bar" },
  { question: "Sammenlign løn for kvinder og mænd", metrics: ["median_monthly_salary"], genders: ["female", "male"], compareBy: ["gender"] },
  { question: "Sammenlign pension for mænd og kvinder", metrics: ["average_pension"], genders: ["female", "male"], compareBy: ["gender"] },
  { question: "Vis løn efter køn", metrics: ["median_monthly_salary"], genders: ["male", "female", "other"], compareBy: ["gender"] },
  { question: "Vis antal kontrakter fordelt på køn", metrics: ["contract_count"], genders: ["male", "female", "other"], compareBy: ["gender"], chart: "bar" },
  { question: "Hvordan har lønnen udviklet sig siden 2016?", metrics: ["median_monthly_salary"], yearFrom: 2016, yearTo: currentYear },
  { question: "Hvordan har gennemsnitslønnen udviklet sig siden 2022?", metrics: ["average_monthly_salary"], yearFrom: 2022, yearTo: currentYear },
  { question: "Vis pension i 2024", metrics: ["average_pension"], years: [2024] },
  { question: "Vis løn i 2023 og 2025", metrics: ["median_monthly_salary"], years: [2023, 2025] },
  { question: "Vis løn mellem 2020 og 2024", metrics: ["median_monthly_salary"], yearFrom: 2020, yearTo: 2024 },
  { question: "Vis pension fra 2018 til 2021", metrics: ["average_pension"], yearFrom: 2018, yearTo: 2021 },
  { question: "Vis arbejdsuger 2019-2022", metrics: ["average_working_weeks"], yearFrom: 2019, yearTo: 2022 },
  { question: "Hvordan har reallønnen udviklet sig siden 2020?", metrics: ["median_monthly_salary"], yearFrom: 2020, yearTo: currentYear, adjustForInflation: true },
  { question: "Hvordan har købekraften i lønnen ændret sig?", metrics: ["median_monthly_salary"], adjustForInflation: true },
  { question: "Vis lønnen som tabel", metrics: ["median_monthly_salary"], chart: "table" },
  { question: "Lav en oversigt over pension", metrics: ["average_pension"], chart: "table" },
  { question: "Vis lønnen som søjle", metrics: ["median_monthly_salary"], chart: "bar" },
  { question: "Vis lønnen som sojle for spillefilm og dokumentarfilm", metrics: ["median_monthly_salary"], categories: ["feature", "documentary"], compareBy: ["category"], chart: "bar" },
  { question: "Hvor mange A-løns- og leverandørkontrakter er der registreret pr. år?", metrics: ["contract_count"], contractTypes: ["a-løn", "leverandør"], compareBy: ["contract_type"], chart: "bar" },
  { question: "Hvilke producenter giver bedst løn?", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Top producenter efter løn", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Hvilke producenter betaler bedst?", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Vis løn efter producent", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Vis løn fordelt på producent", metrics: ["median_monthly_salary"], compareBy: ["producer"], chart: "bar" },
  { question: "Hvordan er lønnen hos producent Nordisk Film?", expectNull: true },
  { question: "Vis løn efter erfaringsgruppe", metrics: ["median_monthly_salary"], experienceGroups: ["new_graduate", "early_career", "experienced", "veteran"], compareBy: ["experience_group"] },
  { question: "Vis pension fordelt på erfaring", metrics: ["average_pension"], experienceGroups: ["new_graduate", "early_career", "experienced", "veteran"], compareBy: ["experience_group"] },
  { question: "Sammenlign løn for 0-3 år og 4-7 år", metrics: ["median_monthly_salary"], experienceGroups: ["new_graduate", "early_career"], compareBy: ["experience_group"] },
  { question: "Sammenlign løn for 8-17 år og 18+", metrics: ["median_monthly_salary"], experienceGroups: ["experienced", "veteran"], compareBy: ["experience_group"] },
  { question: "Hvordan er lønnen for nyuddannede?", metrics: ["median_monthly_salary"], experienceGroups: ["new_graduate"], compareBy: [] },
  { question: "Hvordan er lønnen for erfarne?", metrics: ["median_monthly_salary"], experienceGroups: ["experienced"], compareBy: [] },
  { question: "Hvordan er lønnen for veteraner?", metrics: ["median_monthly_salary"], experienceGroups: ["veteran"], compareBy: [] },
  { question: "Vis løn efter medlemsstatus", metrics: ["median_monthly_salary"], membershipTypes: ["member", "associate", "none", "unknown"], compareBy: ["membership_type"] },
  { question: "Sammenlign løn for medlemmer og ikke-medlemmer", metrics: ["median_monthly_salary"], membershipTypes: ["member", "none"], compareBy: ["membership_type"] },
  { question: "Sammenlign pension for uorganiserede og medlemmer", metrics: ["average_pension"], membershipTypes: ["member", "none"], compareBy: ["membership_type"] },
  { question: "Vis antal kontrakter for associerede og medlemmer", metrics: ["contract_count"], membershipTypes: ["member", "associate"], compareBy: ["membership_type"], chart: "bar" },
  { question: "Sammenlign arbejdsuger for tilknyttede medlemmer og medlemmer", metrics: ["average_working_weeks"], membershipTypes: ["member", "associate"], compareBy: ["membership_type"] },
  { question: "Vis løn for ukendt medlemsstatus og medlemmer", metrics: ["median_monthly_salary"], membershipTypes: ["member", "unknown"], compareBy: ["membership_type"] },
  { question: "Vis pension fordelt på medlemsstatus", metrics: ["average_pension"], membershipTypes: ["member", "associate", "none", "unknown"], compareBy: ["membership_type"] },
  { question: "Sammenlign løn for klippere og medklippere", metrics: ["median_monthly_salary"], professionTypes: ["Medklipper", "Klipper"], compareBy: ["profession_type"] },
  { question: "Vis pension for klippeassistenter og klippere", metrics: ["average_pension"], professionTypes: ["Klipper", "Klippeassistent"], compareBy: ["profession_type"] },
  { question: "Hvordan er lønnen for medklippere?", metrics: ["median_monthly_salary"], professionTypes: ["Medklipper"], compareBy: [] },
  { question: "Hvordan er arbejdsuger for klippere?", metrics: ["average_working_weeks"], professionTypes: ["Klipper"], compareBy: [] },
  { question: "Vis løn efter faggruppe", expectErrorCode: "missing_comparison_values" },
  { question: "Sammenlign løn for streamere og broadcastere", metrics: ["median_monthly_salary"], producerTypeCodes: ["streamer", "broadcaster"], compareBy: ["producer_type"] },
  { question: "Sammenlign pension for dokumentarproducenter og broadcastere", metrics: ["average_pension"], producerTypeCodes: ["documentary", "broadcaster"], compareBy: ["producer_type"] },
  { question: "Vis løn efter producenttype", expectErrorCode: "missing_comparison_values" },
  { question: "SELECT salary FROM contracts", expectNull: true },
  { question: "Hvad tjener Steen Johannessen?", expectErrorCode: "person_query_not_allowed" },
];

assert.equal(questions.length, 100, "Testmatricen skal indeholde præcis 100 statistikspørgsmål.");

function assertOptionalDeepEqual<T>(actual: T, expected: T | undefined, label: string) {
  if (expected !== undefined) assert.deepEqual(actual, expected, label);
}

for (const [index, entry] of questions.entries()) {
  test(`statistikspørgsmål ${index + 1}: ${entry.question}`, () => {
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
  });
}
