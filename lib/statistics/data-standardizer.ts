import { mean, quantile } from "simple-statistics";
import { z } from "zod";

const optionalMoney = z.number().finite().nonnegative().optional().default(0);

export const CompensationInputSchema = z.object({
  personKey: z.string().min(16).max(256),
  year: z.number().int().min(1900).max(2200),
  baseMonthlySalary: optionalMoney,
  employerPensionMonthly: optionalMoney,
  employeePensionMonthly: optionalMoney,
  recurringSupplementsMonthly: optionalMoney,
  annualBonus: optionalMoney,
  annualCommission: optionalMoney,
  annualOvertime: optionalMoney,
  annualBenefits: optionalMoney,
  annualShSavings: optionalMoney,
  shSavingsPercent: z.number().finite().min(0).max(100).optional(),
  agreedMonthlyHours: z.number().finite().positive().max(744).optional(),
  agreedAnnualHours: z.number().finite().positive().max(8_928).optional(),
  paidPersonalLeaveHours: z.number().finite().nonnegative().optional().default(0),
  paidPublicHolidayHours: z.number().finite().nonnegative().optional().default(0),
}).strict();

export type CompensationInput = z.input<typeof CompensationInputSchema>;
export type StandardizedCompensation = z.output<typeof CompensationInputSchema> & {
  fixedGrossMonthly: number;
  totalMonthlyEarnings: number;
  standardHourlyRate: number | null;
  effectiveHourlyRate: number | null;
};

export type OutlierResult<T> = {
  included: T[];
  excluded: Array<{ item: T; reason: "absolute_hourly_limit" | "tukey_iqr" }>;
  bounds: { lower: number; upper: number; method: "absolute" | "tukey_and_absolute" };
};

export class DataStandardizer {
  standardize(input: CompensationInput): StandardizedCompensation {
    const value = CompensationInputSchema.parse(input);
    const fixedGrossMonthly = value.baseMonthlySalary + value.employerPensionMonthly + value.employeePensionMonthly;
    const shMonthly = value.annualShSavings > 0
      ? value.annualShSavings / 12
      : value.baseMonthlySalary * (value.shSavingsPercent ?? 0) / 100;
    const variableMonthly = (
      value.annualBonus + value.annualCommission + value.annualOvertime + value.annualBenefits
    ) / 12;
    const totalMonthlyEarnings = fixedGrossMonthly + value.recurringSupplementsMonthly + variableMonthly + shMonthly;
    const standardHourlyRate = value.agreedMonthlyHours ? totalMonthlyEarnings / value.agreedMonthlyHours : null;
    const annualHours = value.agreedAnnualHours ?? (value.agreedMonthlyHours ? value.agreedMonthlyHours * 12 : null);
    const effectiveHours = annualHours == null
      ? null
      : annualHours - value.paidPersonalLeaveHours - value.paidPublicHolidayHours;
    const effectiveHourlyRate = effectiveHours != null && effectiveHours > 0
      ? totalMonthlyEarnings * 12 / effectiveHours
      : null;
    return { ...value, fixedGrossMonthly, totalMonthlyEarnings, standardHourlyRate, effectiveHourlyRate };
  }

  filterHourlyOutliers<T>(items: T[], getHourlyRate: (item: T) => number | null): OutlierResult<T> {
    const absoluteLower = 50;
    const absoluteUpper = 5_000;
    const validRates = items.map(getHourlyRate).filter((value): value is number => value != null && Number.isFinite(value));
    const useTukey = validRates.length >= 8;
    const q1 = useTukey ? quantile(validRates, 0.25) : absoluteLower;
    const q3 = useTukey ? quantile(validRates, 0.75) : absoluteUpper;
    const iqr = q3 - q1;
    const lower = useTukey ? Math.max(absoluteLower, q1 - 1.5 * iqr) : absoluteLower;
    const upper = useTukey ? Math.min(absoluteUpper, q3 + 1.5 * iqr) : absoluteUpper;
    const included: T[] = [];
    const excluded: OutlierResult<T>["excluded"] = [];
    for (const item of items) {
      const rate = getHourlyRate(item);
      if (rate == null || !Number.isFinite(rate)) continue;
      if (rate < absoluteLower || rate > absoluteUpper) excluded.push({ item, reason: "absolute_hourly_limit" });
      else if (rate < lower || rate > upper) excluded.push({ item, reason: "tukey_iqr" });
      else included.push(item);
    }
    return { included, excluded, bounds: { lower, upper, method: useTukey ? "tukey_and_absolute" : "absolute" } };
  }

  summarize(values: number[]) {
    if (!values.length) return null;
    return { average: mean(values), p25: quantile(values, 0.25), p50: quantile(values, 0.5), p75: quantile(values, 0.75), p90: quantile(values, 0.9) };
  }
}
