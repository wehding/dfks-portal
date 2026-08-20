export class InsufficientDataError extends Error {
  constructor(readonly minimum: number, readonly actual: number) {
    super(`Statistikken kræver mindst ${minimum} forskellige personer; datagrundlaget indeholder ${actual}.`);
    this.name = "InsufficientDataError";
  }
}

export type PrivacyPolicy = {
  minimumGroupSize: number;
  dominanceLimit: number;
  lowSampleThreshold: number;
};

export type PrivacyCell = {
  key: string;
  contributorIds: string[];
  contributions?: number[];
  suppressed?: boolean;
  suppressionReason?: "minimum_count" | "dominance" | "secondary";
};

export const DEFAULT_PRIVACY_POLICY: PrivacyPolicy = {
  minimumGroupSize: 5,
  dominanceLimit: 0.8,
  lowSampleThreshold: 10,
};

export function normalizePrivacyPolicy(policy: Partial<PrivacyPolicy> = {}): PrivacyPolicy {
  const minimum = Number.isInteger(policy.minimumGroupSize) ? Number(policy.minimumGroupSize) : DEFAULT_PRIVACY_POLICY.minimumGroupSize;
  const dominance = Number(policy.dominanceLimit);
  const lowSample = Number(policy.lowSampleThreshold);
  return {
    minimumGroupSize: Math.min(100, Math.max(3, minimum)),
    dominanceLimit: Number.isFinite(dominance) ? Math.min(1, Math.max(0.5, dominance)) : DEFAULT_PRIVACY_POLICY.dominanceLimit,
    lowSampleThreshold: Number.isInteger(lowSample) ? Math.max(5, lowSample) : DEFAULT_PRIVACY_POLICY.lowSampleThreshold,
  };
}

export function sampleSizeBand(count: number) {
  if (count < 3) return "< 3";
  if (count < 5) return "3–4";
  if (count < 10) return "5–9";
  if (count < 20) return "10–19";
  return "20+";
}

export function dominanceRatio(contributions: number[]) {
  const positive = contributions.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => b - a);
  const total = positive.reduce((sum, value) => sum + value, 0);
  return total > 0 ? ((positive[0] ?? 0) + (positive[1] ?? 0)) / total : 0;
}

export class PrivacyGuard {
  readonly policy: PrivacyPolicy;

  constructor(policy: Partial<PrivacyPolicy> = {}) {
    this.policy = normalizePrivacyPolicy(policy);
  }

  distinctContributors(ids: string[]) {
    return new Set(ids.filter(Boolean)).size;
  }

  assertVisible(ids: string[]) {
    const actual = this.distinctContributors(ids);
    if (actual < this.policy.minimumGroupSize) throw new InsufficientDataError(this.policy.minimumGroupSize, actual);
    return actual;
  }

  protectCells(cells: PrivacyCell[], options: { additiveEconomicValues?: boolean; hasPublishedTotal?: boolean } = {}) {
    const protectedCells: PrivacyCell[] = cells.map(cell => {
      const count = this.distinctContributors(cell.contributorIds);
      if (count < this.policy.minimumGroupSize) return { ...cell, suppressed: true, suppressionReason: "minimum_count" as const };
      if (options.additiveEconomicValues && dominanceRatio(cell.contributions ?? []) > this.policy.dominanceLimit) {
        return { ...cell, suppressed: true, suppressionReason: "dominance" as const };
      }
      return { ...cell, suppressed: false, suppressionReason: undefined };
    });
    if (options.hasPublishedTotal && protectedCells.filter(cell => cell.suppressed).length === 1) {
      const secondary = protectedCells
        .map((cell, index) => ({ index, count: this.distinctContributors(cell.contributorIds), suppressed: cell.suppressed }))
        .filter(cell => !cell.suppressed)
        .sort((a, b) => a.count - b.count)[0];
      if (secondary) protectedCells[secondary.index] = { ...protectedCells[secondary.index], suppressed: true, suppressionReason: "secondary" };
    }
    return protectedCells;
  }

  mergeAdjacentYears<T extends { year: number; contributorId: string }>(rows: T[]) {
    const byYear = new Map<number, T[]>();
    for (const row of rows) byYear.set(row.year, [...(byYear.get(row.year) ?? []), row]);
    const years = [...byYear.keys()].sort((a, b) => a - b);
    const buckets: Array<{ from: number; to: number; rows: T[] }> = [];
    let pending: { from: number; to: number; rows: T[] } | null = null;
    for (const year of years) {
      const current = byYear.get(year) ?? [];
      pending = pending
        ? { from: pending.from, to: year, rows: [...pending.rows, ...current] }
        : { from: year, to: year, rows: current };
      if (this.distinctContributors(pending.rows.map(row => row.contributorId)) >= this.policy.minimumGroupSize) {
        buckets.push(pending);
        pending = null;
      }
    }
    if (pending && buckets.length) {
      const last = buckets.pop()!;
      buckets.push({ from: last.from, to: pending.to, rows: [...last.rows, ...pending.rows] });
    }
    return pending && !buckets.length ? [] : buckets;
  }
}
