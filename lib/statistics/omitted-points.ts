import {
  STATISTICS_METRIC_META,
  type StatisticsMetric,
} from "../statistics-query-plan";

export type OmittedStatisticsPoint = {
  year: number | null;
  seriesLabel: string;
  metricLabel: string;
  reason: "minimum_count" | "dominance" | "secondary" | "suppressed_segment";
  memberCount: number | null;
  contractCount: number | null;
};

export function omittedStatisticsReasonText(reason: OmittedStatisticsPoint["reason"]) {
  if (reason === "minimum_count") return "for få forskellige personer i gruppen";
  if (reason === "dominance") return "få producenter fylder for meget i gruppens økonomiske grundlag";
  if (reason === "secondary") return "ekstra sløring for at forhindre bagudregning af skjulte tal";
  return "hele delgruppen blev skjult af diskretionsreglerne";
}

export function collectOmittedStatisticsPoints(input: {
  metrics: StatisticsMetric[];
  statistics: Record<string, unknown>;
  segmentLabel: string;
}) {
  const omitted: OmittedStatisticsPoint[] = [];
  for (const metric of input.metrics) {
    const meta = STATISTICS_METRIC_META[metric];
    const rows = Array.isArray(input.statistics[meta.sourceKey])
      ? input.statistics[meta.sourceKey] as Array<Record<string, unknown>>
      : [];
    for (const row of rows) {
      if (row.suppressed !== true) continue;
      omitted.push({
        year: Number.isFinite(Number(row.year)) ? Number(row.year) : null,
        seriesLabel: input.segmentLabel || meta.label,
        metricLabel: meta.label,
        reason: row.suppressionReason === "dominance" || row.suppressionReason === "secondary"
          ? row.suppressionReason
          : "minimum_count",
        memberCount: Number.isFinite(Number(row.memberCount)) ? Number(row.memberCount) : null,
        contractCount: Number.isFinite(Number(row.contractCount)) ? Number(row.contractCount) : null,
      });
    }
  }
  return omitted;
}

export function describeOmittedStatisticsPoints(points: OmittedStatisticsPoint[], limit = 8) {
  if (!points.length) return [];
  const sorted = [...points].sort((left, right) =>
    (left.year ?? 0) - (right.year ?? 0)
    || left.seriesLabel.localeCompare(right.seriesLabel, "da-DK")
    || left.metricLabel.localeCompare(right.metricLabel, "da-DK")
  );
  const visible = sorted.slice(0, limit).map(point => {
    const year = point.year == null ? "ukendt år" : String(point.year);
    const basis = point.memberCount == null
      ? ""
      : ` (${point.memberCount} ${point.memberCount === 1 ? "person" : "personer"}${point.contractCount == null ? "" : `, ${point.contractCount} kontrakter`})`;
    return `${year}: ${point.seriesLabel} / ${point.metricLabel} er udeladt, fordi ${omittedStatisticsReasonText(point.reason)}${basis}.`;
  });
  const rest = sorted.length - visible.length;
  return rest > 0 ? [...visible, `${rest} yderligere datapunkt(er) er udeladt af samme diskretionshensyn.`] : visible;
}
