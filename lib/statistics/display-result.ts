export type StatisticsResultSource = "production" | "demonstration";

export type StatisticsDisplayResult<T> = {
  source: StatisticsResultSource;
  rows: readonly T[];
  exportable: boolean;
};

type StatisticsDisplayResultInput<T> = {
  productionRows: readonly T[];
  demonstrationRows: readonly T[];
  useDemonstration: boolean;
};

/**
 * Selects exactly one data source for a statistics presentation.
 * Demonstration rows are never combined with calculated production rows.
 */
export function createStatisticsDisplayResult<T>({
  productionRows,
  demonstrationRows,
  useDemonstration,
}: StatisticsDisplayResultInput<T>): StatisticsDisplayResult<T> {
  if (useDemonstration) {
    return {
      source: "demonstration",
      rows: [...demonstrationRows],
      exportable: false,
    };
  }

  return {
    source: "production",
    rows: [...productionRows],
    exportable: true,
  };
}

export function getExportableStatisticsRows<T>(result: StatisticsDisplayResult<T>): readonly T[] {
  return result.source === "production" && result.exportable ? result.rows : [];
}
