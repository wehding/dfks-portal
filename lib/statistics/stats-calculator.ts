import { mean, quantile } from "simple-statistics";

export class MissingStatisticsDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingStatisticsDataError";
  }
}

export class StatsCalculator {
  percentiles(values: number[]) {
    const clean = values.filter(Number.isFinite);
    if (!clean.length) throw new MissingStatisticsDataError("Der er ingen numeriske værdier til fraktilberegningen.");
    return { p25: quantile(clean, 0.25), p50: quantile(clean, 0.5), p75: quantile(clean, 0.75), p90: quantile(clean, 0.9) };
  }

  inflateByIndex(value: number, indexAtStart: number, indexAtEnd: number) {
    if (![value, indexAtStart, indexAtEnd].every(Number.isFinite) || indexAtStart <= 0 || indexAtEnd <= 0) {
      throw new MissingStatisticsDataError("Prisindeks og beløb skal være positive tal.");
    }
    return value * indexAtEnd / indexAtStart;
  }

  projectWage(value: number, annualRates: number[]) {
    return annualRates.reduce((projected, rate) => projected * (1 + rate), value);
  }

  regionalIndex(regionValues: number[], nationalValues: number[]) {
    const regionMedian = this.percentiles(regionValues).p50;
    const nationalMedian = this.percentiles(nationalValues).p50;
    if (nationalMedian === 0) throw new MissingStatisticsDataError("Det nationale sammenligningsniveau er nul.");
    return regionMedian / nationalMedian * 100;
  }

  companyIndex(companyAdjustedValues: number[], marketAdjustedValues: number[]) {
    if (!companyAdjustedValues.length || !marketAdjustedValues.length) throw new MissingStatisticsDataError("Virksomheds- og markedsgrundlag er påkrævet.");
    const marketMean = mean(marketAdjustedValues);
    if (marketMean === 0) throw new MissingStatisticsDataError("Markedsniveauet er nul.");
    return mean(companyAdjustedValues) / marketMean * 100;
  }

  commutingIndex(groupDistancesKm: number[], nationalDistancesKm: number[]) {
    return this.regionalIndex(groupDistancesKm, nationalDistancesKm);
  }
}
