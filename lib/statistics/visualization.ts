export type StatisticsUnit = "dkk" | "percent" | "weeks" | "count" | "index";

export type VisualizationSeriesRow = {
  year: number;
  value: number;
  seriesKey: string;
  seriesLabel: string;
  metric: string;
  metricLabel: string;
  unit: Exclude<StatisticsUnit, "index">;
  contractCount: number;
  memberCount: number;
  lowSample: boolean;
  inflationIndex?: number | null;
  realValue?: number | null;
  realChangePercent?: number | null;
};

export type CombinedChartType = "line" | "grouped_bar" | "area" | "composed" | "indexed_line" | "table";

export type VisualizationDataset = {
  key: string;
  label: string;
  metric: string;
  unit: StatisticsUnit;
  sourceUnit: Exclude<StatisticsUnit, "index">;
  axis: "left" | "right";
};

export type StatisticsVisualization = {
  mode: "shared_axis" | "dual_axis" | "indexed" | "table";
  chart: CombinedChartType;
  compatibleCharts: CombinedChartType[];
  xDimension: "year";
  rows: Array<Record<string, number>>;
  datasets: VisualizationDataset[];
  basisYear: number | null;
  explanation: string;
};

function pivotRows(series: VisualizationSeriesRow[]) {
  const rows = new Map<number, Record<string, number>>();
  for (const item of series) {
    rows.set(item.year, { ...(rows.get(item.year) ?? { year: item.year }), [item.seriesKey]: item.value });
  }
  return [...rows.values()].sort((left, right) => Number(left.year) - Number(right.year));
}

function uniqueDatasets(series: VisualizationSeriesRow[]) {
  const datasets = new Map<string, VisualizationDataset>();
  for (const item of series) {
    if (!datasets.has(item.seriesKey)) {
      datasets.set(item.seriesKey, {
        key: item.seriesKey,
        label: item.seriesLabel,
        metric: item.metric,
        unit: item.unit,
        sourceUnit: item.unit,
        axis: "left",
      });
    }
  }
  return [...datasets.values()];
}

function commonYears(series: VisualizationSeriesRow[], datasets: VisualizationDataset[]) {
  const yearsByDataset = datasets.map(dataset => new Set(series.filter(row => row.seriesKey === dataset.key).map(row => row.year)));
  if (!yearsByDataset.length) return [];
  return [...yearsByDataset[0]].filter(year => yearsByDataset.every(years => years.has(year))).sort((a, b) => a - b);
}

export function buildStatisticsVisualization(
  series: VisualizationSeriesRow[],
  requestedChart: "line" | "bar" | "table" = "line",
): StatisticsVisualization {
  const datasets = uniqueDatasets(series);
  const rows = pivotRows(series);
  const units = [...new Set(datasets.map(dataset => dataset.unit))];
  const timePointCount = new Set(series.map(row => row.year)).size;

  if (!series.length || requestedChart === "table" || timePointCount < 2) {
    return {
      mode: "table", chart: "table", compatibleCharts: ["table"], xDimension: "year", rows, datasets,
      basisYear: null,
      explanation: timePointCount < 2
        ? "Resultatet har ikke mindst to fælles tidspunkter og vises derfor som én samlet tabel."
        : "Spørgsmålet bad om en samlet tabel.",
    };
  }

  if (units.length === 1) {
    const chart = requestedChart === "bar" ? "grouped_bar" : "line";
    return {
      mode: "shared_axis", chart, compatibleCharts: ["line", "grouped_bar", "area", "table"],
      xDimension: "year", rows, datasets, basisYear: null,
      explanation: "Alle datasæt bruger samme enhed og vises på én fælles akse.",
    };
  }

  if (units.length === 2) {
    const leftUnit = units[0];
    const axisDatasets = datasets.map(dataset => ({ ...dataset, axis: dataset.unit === leftUnit ? "left" as const : "right" as const }));
    return {
      mode: "dual_axis", chart: "composed", compatibleCharts: ["composed", "table"],
      xDimension: "year", rows, datasets: axisDatasets, basisYear: null,
      explanation: "Datasættene deler årsakse og vises samlet med hver sin tydeligt mærkede værdiakse.",
    };
  }

  const sharedYears = commonYears(series, datasets);
  if (sharedYears.length >= 2) {
    const basisYear = sharedYears[0];
    const baselines = new Map(series.filter(row => row.year === basisYear).map(row => [row.seriesKey, row.value]));
    const indexedRows = rows.map(row => {
      const indexed: Record<string, number> = { year: Number(row.year) };
      for (const dataset of datasets) {
        const value = row[dataset.key];
        const baseline = baselines.get(dataset.key);
        if (Number.isFinite(value) && baseline != null && baseline !== 0) indexed[dataset.key] = Math.round(value / baseline * 1000) / 10;
      }
      return indexed;
    });
    return {
      mode: "indexed", chart: "indexed_line", compatibleCharts: ["indexed_line", "table"],
      xDimension: "year", rows: indexedRows,
      datasets: datasets.map(dataset => ({ ...dataset, unit: "index", axis: "left" })),
      basisYear,
      explanation: `Datasættene har forskellige enheder og er derfor sammenlignet som udviklingsindeks med ${basisYear} = 100.`,
    };
  }

  return {
    mode: "table", chart: "table", compatibleCharts: ["table"], xDimension: "year", rows, datasets,
    basisYear: null,
    explanation: "Datasættene har ikke mindst to fælles år og kan derfor ikke kombineres forsvarligt i én graf.",
  };
}
