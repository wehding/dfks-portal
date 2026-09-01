import type { VisualizationSeriesRow } from "@/lib/statistics/visualization";

export type StatisticsDirectAnswer = {
  kind: "yes_no";
  shortAnswer: "Ja" | "Nej" | "Delvist" | "Kan ikke besvares";
  sentence: string;
  explanation: string;
  basis: Array<{
    seriesLabel: string;
    fromYear: number;
    toYear: number;
    fromValue: number;
    toValue: number;
    changePercent: number;
    matched: boolean;
  }>;
};

type TrendIntent = "fallen" | "risen" | "unchanged";

function normalizeQuestion(question: string) {
  return question.trim().toLocaleLowerCase("da").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function includesAny(value: string, needles: string[]) {
  return needles.some(needle => value.includes(needle));
}

function directTrendIntent(value: string): TrendIntent | null {
  if (includesAny(value, ["faldet", "falder", "faldende", "fald i", "reallonsfald", "reallønsfald", "tilbagegang", "mistet kobekraft", "mistet købekraft", "mistet vaerdi", "mistet værdi", "faerre varer", "færre varer", "rad til mindre", "råd til mindre"])) return "fallen";
  if (includesAny(value, ["steget", "stiger", "stigende", "fremgang", "reallonsfremgang", "reallønsfremgang", "forbedret", "højere", "hojere", "flere varer", "rad til mere", "råd til mere"])) return "risen";
  if (includesAny(value, ["uaendret", "uændret", "samme kobekraft", "samme købekraft", "fulgt inflation", "fulgt prisudvikling"]) || (value.includes("matcher") && value.includes("inflation"))) return "unchanged";
  return null;
}

function asksForDirectAnswer(value: string) {
  return /^(er|er der|har|falder|stiger|matcher|forbedres|forvaerres|forværres)\b/.test(value)
    || includesAny(value, ["ja eller nej", "ja/nej", "svar ja", "svar nej"]);
}

function usesNominalValue(value: string) {
  return includesAny(value, [
    "nominel", "nominelle", "nominellon", "nominelløn", "nominal", "for inflation", "før inflation",
    "lonseddel", "lønseddel", "kroner og orer", "kroner og ører", "lønnen i kroner", "lonnen i kroner",
  ]);
}

function usesRealValue(value: string) {
  if (usesNominalValue(value) && !includesAny(value, ["reallon", "realløn", "kobekraft", "købekraft", "varer og tjenester", "flere varer", "faerre varer", "færre varer", "rad til mere", "råd til mere"])) return false;
  return includesAny(value, [
    "inflation", "prisudvikling", "prisstigning", "reallon", "realløn", "kobekraft", "købekraft",
    "varer og tjenester", "flere varer", "raekker pengene", "rækker pengene", "rad til mere", "råd til mere",
    "faerre varer", "færre varer",
  ]);
}

function valueForRow(row: VisualizationSeriesRow, realValue: boolean) {
  return realValue ? row.realValue ?? row.value : row.value;
}

function changeMatches(changePercent: number, intent: TrendIntent) {
  if (intent === "fallen") return changePercent < -0.05;
  if (intent === "risen") return changePercent > 0.05;
  return Math.abs(changePercent) <= 0.05;
}

export function buildStatisticsDirectAnswer(
  question: string,
  rows: VisualizationSeriesRow[],
): StatisticsDirectAnswer | null {
  const value = normalizeQuestion(question);
  if (!asksForDirectAnswer(value)) return null;
  const intent = directTrendIntent(value);
  if (!intent) return null;

  const realValue = usesRealValue(value);
  const salaryRows = rows.filter(row => row.metric === "median_monthly_salary" || row.metric === "average_monthly_salary");
  const relevantRows = salaryRows.length ? salaryRows : rows;
  const bySeries = new Map<string, VisualizationSeriesRow[]>();
  for (const row of relevantRows) bySeries.set(row.seriesKey, [...(bySeries.get(row.seriesKey) ?? []), row]);

  const basis = [...bySeries.values()].flatMap(seriesRows => {
    const sorted = [...seriesRows]
      .filter(row => Number.isFinite(valueForRow(row, realValue)))
      .sort((left, right) => left.year - right.year);
    const first = sorted[0];
    const last = sorted.at(-1);
    if (!first || !last || first.year === last.year) return [];
    const fromValue = valueForRow(first, realValue);
    const toValue = valueForRow(last, realValue);
    if (!Number.isFinite(fromValue) || !Number.isFinite(toValue) || fromValue === 0) return [];
    const changePercent = Math.round((toValue / fromValue - 1) * 1000) / 10;
    return [{
      seriesLabel: first.seriesLabel,
      fromYear: first.year,
      toYear: last.year,
      fromValue,
      toValue,
      changePercent,
      matched: changeMatches(changePercent, intent),
    }];
  });

  if (!basis.length) {
    return {
      kind: "yes_no",
      shortAnswer: "Kan ikke besvares",
      sentence: "Kan ikke besvares ud fra de synlige datapunkter.",
      explanation: "Der skal være mindst to synlige år i samme serie for at afgøre, om udviklingen er faldet, steget eller uændret.",
      basis: [],
    };
  }

  const matchedCount = basis.filter(item => item.matched).length;
  const shortAnswer = matchedCount === basis.length ? "Ja" : matchedCount === 0 ? "Nej" : "Delvist";
  const targetText = intent === "fallen" ? "faldet" : intent === "risen" ? "steget" : "uændret";
  const metricText = realValue ? "reallønnen/købekraften" : "den nominelle værdi";
  const seriesText = basis.length === 1
    ? `${basis[0].fromYear}-${basis[0].toYear}`
    : `${basis.length} serier`;
  const changes = basis.map(item => `${item.seriesLabel}: ${item.changePercent}%`).join("; ");
  return {
    kind: "yes_no",
    shortAnswer,
    sentence: `${shortAnswer}, ${metricText} er ${shortAnswer === "Delvist" ? "kun i nogle serier " : ""}${targetText} over perioden ${seriesText}.`,
    explanation: `Vurderingen sammenligner første og sidste synlige datapunkt i perioden. Ændring: ${changes}.`,
    basis,
  };
}
