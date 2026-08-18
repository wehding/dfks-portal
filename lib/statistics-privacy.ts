export const DEFAULT_STATISTICS_MINIMUM_GROUP_SIZE = 5;
export const MIN_STATISTICS_MINIMUM_GROUP_SIZE = 3;
export const MAX_STATISTICS_MINIMUM_GROUP_SIZE = 100;
export const LOW_SAMPLE_MEMBER_THRESHOLD = 5;

export function normalizeStatisticsMinimumGroupSize(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return DEFAULT_STATISTICS_MINIMUM_GROUP_SIZE;
  return Math.min(
    MAX_STATISTICS_MINIMUM_GROUP_SIZE,
    Math.max(MIN_STATISTICS_MINIMUM_GROUP_SIZE, parsed),
  );
}

export { sampleSizeBand } from "@/lib/statistics/privacy-guard";

export function distinctStatisticsMembers<T extends { rightsHolderId: string }>(items: T[]) {
  return new Set(items.map(item => item.rightsHolderId).filter(Boolean)).size;
}

export function statisticsGroupIsVisible<T extends { rightsHolderId: string }>(
  items: T[],
  minimumGroupSize: number,
) {
  return distinctStatisticsMembers(items) >= normalizeStatisticsMinimumGroupSize(minimumGroupSize);
}
