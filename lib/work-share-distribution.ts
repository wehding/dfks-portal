export type ShareCaseStatus = "awaiting_members" | "awaiting_admin" | "resolved" | "reopened";
export type ShareScope = "work" | "season" | "episode";

export function normalizeSharePercent(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return Math.round(parsed * 1000) / 1000;
}

export function shareResolutionTotal(finalPercents: readonly unknown[], reservePercent: unknown) {
  const participantTotal = finalPercents.reduce<number>((sum, value) => sum + (normalizeSharePercent(value) ?? 0), 0);
  const reserve = normalizeSharePercent(reservePercent) ?? 0;
  return Math.round((participantTotal + reserve) * 1000) / 1000;
}

export function isCompleteShareResolution(finalPercents: readonly unknown[], reservePercent: unknown) {
  return Math.abs(shareResolutionTotal(finalPercents, reservePercent) - 100) < 0.001;
}

export function requiresOwnShare(input: { knownRightsHolderCount: number; addedCoEditorCount: number }) {
  return input.knownRightsHolderCount > 1 || input.addedCoEditorCount > 0;
}

export function expandSeasonShare(episodeNumbers: readonly number[], percent: unknown) {
  const normalized = normalizeSharePercent(percent);
  if (normalized === null) return [];
  return [...new Set(episodeNumbers.filter(number => Number.isInteger(number) && number > 0))]
    .sort((left, right) => left - right)
    .map(episodeNumber => ({ episodeNumber, percent: normalized }));
}
