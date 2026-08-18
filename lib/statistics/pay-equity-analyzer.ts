import { Matrix, pseudoInverse } from "ml-matrix";
import { mean, median } from "simple-statistics";

export type PayEquityObservation = {
  personKey: string;
  gender: "male" | "female" | "other";
  grossPay: number;
  educationLevel: string;
  educationDirection: string;
  experienceYears: number;
  disco08: string;
  jobLevel: string;
  managementResponsibility: boolean;
  nuts3: string;
};

export type PayEquityResult = {
  label: "DFKS medlemsanalyse af lønforskelle";
  coverageDisclaimer: string;
  sampleSize: number;
  femaleCount: number;
  maleCount: number;
  unadjustedMeanGapPercent: number;
  unadjustedMedianGapPercent: number;
  adjustedGapPercent: number;
  confidenceInterval95: [number, number];
  pValue: number;
  adjustedRSquared: number;
  coefficientCount: number;
  warnings: string[];
};

export class PayEquitySampleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayEquitySampleError";
  }
}

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

function categoricalColumns(rows: PayEquityObservation[], selector: (row: PayEquityObservation) => string) {
  const levels = [...new Set(rows.map(selector))].sort();
  return levels.slice(1).map(level => ({ name: level, values: rows.map(row => selector(row) === level ? 1 : 0) }));
}

export class PayEquityAnalyzer {
  analyze(rows: PayEquityObservation[]): PayEquityResult {
    const complete = rows.filter(row => Number.isFinite(row.grossPay) && row.grossPay > 0 && Number.isFinite(row.experienceYears));
    const binary = complete.filter((row): row is PayEquityObservation & { gender: "male" | "female" } => row.gender === "male" || row.gender === "female");
    const female = binary.filter(row => row.gender === "female");
    const male = binary.filter(row => row.gender === "male");
    if (binary.length < 30 || female.length < 10 || male.length < 10) {
      throw new PayEquitySampleError("Regression kræver mindst 30 komplette observationer samt mindst 10 kvinder og 10 mænd.");
    }

    const columns = [
      { name: "intercept", values: binary.map(() => 1) },
      { name: "female", values: binary.map(row => row.gender === "female" ? 1 : 0) },
      { name: "experience", values: binary.map(row => row.experienceYears) },
      { name: "experience_squared", values: binary.map(row => row.experienceYears ** 2) },
      { name: "management", values: binary.map(row => row.managementResponsibility ? 1 : 0) },
      ...categoricalColumns(binary, row => row.educationLevel),
      ...categoricalColumns(binary, row => row.educationDirection),
      ...categoricalColumns(binary, row => row.disco08),
      ...categoricalColumns(binary, row => row.jobLevel),
      ...categoricalColumns(binary, row => row.nuts3),
    ];
    if (binary.length < columns.length * 5) throw new PayEquitySampleError("Datagrundlaget er for lille i forhold til antallet af regressionsparametre. Bred kategorierne ud.");

    const x = new Matrix(binary.map((_, rowIndex) => columns.map(column => column.values[rowIndex])));
    const y = Matrix.columnVector(binary.map(row => Math.log(row.grossPay)));
    const xtxInverse = pseudoInverse(x.transpose().mmul(x));
    const beta = xtxInverse.mmul(x.transpose()).mmul(y);
    const fitted = x.mmul(beta);
    const residuals = y.clone().sub(fitted);
    const hat = x.mmul(xtxInverse).mmul(x.transpose());
    let meat = Matrix.zeros(columns.length, columns.length);
    for (let i = 0; i < binary.length; i += 1) {
      const row = Matrix.rowVector(x.getRow(i));
      const leverage = Math.min(0.999999, hat.get(i, i));
      const adjustedResidualSquared = residuals.get(i, 0) ** 2 / (1 - leverage) ** 2;
      meat = meat.add(row.transpose().mmul(row).mul(adjustedResidualSquared));
    }
    const covariance = xtxInverse.mmul(meat).mmul(xtxInverse);
    const femaleCoefficient = beta.get(1, 0);
    const standardError = Math.sqrt(Math.max(0, covariance.get(1, 1)));
    const zScore = standardError > 0 ? femaleCoefficient / standardError : 0;
    const pValue = Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(zScore)))));
    const interval: [number, number] = [femaleCoefficient - 1.96 * standardError, femaleCoefficient + 1.96 * standardError];
    const yValues = binary.map(row => Math.log(row.grossPay));
    const yMean = mean(yValues);
    const sse = residuals.to1DArray().reduce((sum, value) => sum + value ** 2, 0);
    const sst = yValues.reduce((sum, value) => sum + (value - yMean) ** 2, 0);
    const rSquared = sst > 0 ? 1 - sse / sst : 0;
    const adjustedRSquared = 1 - (1 - rSquared) * (binary.length - 1) / (binary.length - columns.length);
    const maleMean = mean(male.map(row => row.grossPay));
    const maleMedian = median(male.map(row => row.grossPay));

    return {
      label: "DFKS medlemsanalyse af lønforskelle",
      coverageDisclaimer: "Analysen omfatter kun validerede DFKS-medlemsdata og er ikke virksomhedens fulde lovpligtige lønrapport.",
      sampleSize: binary.length,
      femaleCount: female.length,
      maleCount: male.length,
      unadjustedMeanGapPercent: (maleMean - mean(female.map(row => row.grossPay))) / maleMean * 100,
      unadjustedMedianGapPercent: (maleMedian - median(female.map(row => row.grossPay))) / maleMedian * 100,
      adjustedGapPercent: (Math.exp(femaleCoefficient) - 1) * 100,
      confidenceInterval95: [(Math.exp(interval[0]) - 1) * 100, (Math.exp(interval[1]) - 1) * 100],
      pValue,
      adjustedRSquared,
      coefficientCount: columns.length,
      warnings: complete.length !== rows.length ? [`${rows.length - complete.length} observationer blev udeladt på grund af manglende eller ugyldige data.`] : [],
    };
  }
}
