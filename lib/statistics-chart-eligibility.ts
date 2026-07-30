export const STATISTICS_CHART_TYPES = [
  "table", "bar", "horizontal_bar", "grouped_bar", "stacked_bar", "pie", "donut",
  "stacked_100", "line", "area", "histogram", "box_plot", "scatter", "bubble",
] as const;

export type StatisticsChartType = typeof STATISTICS_CHART_TYPES[number];

export type ChartResultShape = {
  pointCount: number;
  seriesCount: number;
  timePointCount: number;
  categoryCount: number;
  observationCount: number;
  numericDimensions: number;
  additive: boolean;
  overlappingCategories?: boolean;
};

export function evaluateChartEligibility(chart: StatisticsChartType, shape: ChartResultShape) {
  if (shape.pointCount < 1) return { eligible: false, score: 0, reason: "Resultatet indeholder ingen datapunkter." };
  if (chart === "table") return { eligible: true, score: 70 };
  if (chart === "line") return shape.timePointCount >= 2 ? { eligible: true, score: 100 } : { eligible: false, score: 0, reason: "Linjediagram kræver mindst to tidspunkter." };
  if (chart === "area") return shape.timePointCount >= 2 && shape.additive ? { eligible: true, score: 75 } : { eligible: false, score: 0, reason: "Arealdiagram kræver en tidsserie med værdier, der kan summeres meningsfuldt." };
  if (chart === "bar" || chart === "horizontal_bar") return shape.categoryCount <= 20 ? { eligible: true, score: chart === "horizontal_bar" && shape.categoryCount > 6 ? 90 : 80 } : { eligible: false, score: 0, reason: "Søjlediagrammet har for mange kategorier." };
  if (chart === "grouped_bar") return shape.seriesCount >= 2 && shape.seriesCount <= 6 ? { eligible: true, score: 85 } : { eligible: false, score: 0, reason: "Grupperet søjlediagram kræver 2–6 sammenlignelige serier." };
  if (chart === "stacked_bar") return shape.seriesCount >= 2 && shape.additive ? { eligible: true, score: 80 } : { eligible: false, score: 0, reason: "Stablede søjler kræver additive delserier." };
  if (chart === "stacked_100") return shape.seriesCount >= 2 && shape.additive && !shape.overlappingCategories ? { eligible: true, score: 80 } : { eligible: false, score: 0, reason: "100 %-visning kræver ikke-overlappende dele med fælles total." };
  if (chart === "pie" || chart === "donut") return shape.timePointCount <= 1 && shape.categoryCount >= 2 && shape.categoryCount <= 8 && !shape.overlappingCategories ? { eligible: true, score: 75 } : { eligible: false, score: 0, reason: "Cirkel- og ringdiagram kræver 2–8 ikke-overlappende kategorier i én periode." };
  if (chart === "histogram") return shape.observationCount >= 10 && shape.numericDimensions >= 1 ? { eligible: true, score: 90 } : { eligible: false, score: 0, reason: "Histogram kræver mindst 10 numeriske observationer." };
  if (chart === "box_plot") return shape.observationCount >= 10 && shape.numericDimensions >= 1 ? { eligible: true, score: 85 } : { eligible: false, score: 0, reason: "Boksplot kræver mindst 10 observationer pr. gruppe." };
  if (chart === "scatter") return shape.observationCount >= 10 && shape.numericDimensions >= 2 ? { eligible: true, score: 85 } : { eligible: false, score: 0, reason: "Prikdiagram kræver mindst 10 observationer og to numeriske mål." };
  return shape.categoryCount >= 5 && shape.numericDimensions >= 3 ? { eligible: true, score: 80 } : { eligible: false, score: 0, reason: "Boblediagram kræver mindst fem grupper og tre numeriske mål." };
}

export function recommendCharts(shape: ChartResultShape): StatisticsChartType[] {
  return STATISTICS_CHART_TYPES
    .map(chart => ({ chart, ...evaluateChartEligibility(chart, shape) }))
    .filter(result => result.eligible)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map(result => result.chart);
}
