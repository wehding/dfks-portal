import { DataStandardizer } from "@/lib/statistics/data-standardizer";
import { PayEquityAnalyzer } from "@/lib/statistics/pay-equity-analyzer";
import { PrivacyGuard, type PrivacyPolicy } from "@/lib/statistics/privacy-guard";
import { StatsCalculator } from "@/lib/statistics/stats-calculator";

export class UnionStatsEngine {
  readonly standardizer: DataStandardizer;
  readonly privacy: PrivacyGuard;
  readonly stats: StatsCalculator;
  readonly payEquity: PayEquityAnalyzer;

  constructor(policy: Partial<PrivacyPolicy> = {}) {
    this.standardizer = new DataStandardizer();
    this.privacy = new PrivacyGuard(policy);
    this.stats = new StatsCalculator();
    this.payEquity = new PayEquityAnalyzer();
  }
}
