export function normalizeSeasonNumber(value: number | string | null | undefined, fallback = 1) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return Math.max(1, Math.trunc(fallback) || 1);
  return Math.max(1, Math.trunc(parsed));
}

export function stepSeasonNumber(current: number, direction: "up" | "down") {
  const normalized = normalizeSeasonNumber(current);
  return direction === "up" ? normalized + 1 : Math.max(1, normalized - 1);
}

export function seasonNumberForKey(current: number, key: string) {
  if (key === "ArrowUp") return stepSeasonNumber(current, "up");
  if (key === "ArrowDown") return stepSeasonNumber(current, "down");
  if (key === "Enter") return normalizeSeasonNumber(current);
  return null;
}

export function seasonLookupMessage(locale: "da" | "en", status: "not_found" | "error", season: number) {
  const normalizedSeason = normalizeSeasonNumber(season);
  if (locale === "en") {
    return status === "error"
      ? `Could not load season ${normalizedSeason}. Try again.`
      : `Season ${normalizedSeason} was not found.`;
  }
  return status === "error"
    ? `Kunne ikke hente sæson ${normalizedSeason}. Prøv igen.`
    : `Sæson ${normalizedSeason} blev ikke fundet.`;
}

export type SeasonEpisodeLookupResult<T> =
  | { status: "found"; season: number; options: T[] }
  | { status: "not_found"; season: number; options: [] }
  | { status: "error"; season: number; options: []; error: string };

export function seasonEpisodeLookupResult<T>({
  season,
  options,
  confirmed,
  error,
}: {
  season: number;
  options: T[];
  confirmed: boolean;
  error?: string | null;
}): SeasonEpisodeLookupResult<T> {
  const normalizedSeason = normalizeSeasonNumber(season);
  if (error) return { status: "error", season: normalizedSeason, options: [], error };
  if (!confirmed || options.length === 0) return { status: "not_found", season: normalizedSeason, options: [] };
  return { status: "found", season: normalizedSeason, options };
}

export function createLatestRequestGuard() {
  let latestRequest = 0;
  return {
    begin() {
      latestRequest += 1;
      return latestRequest;
    },
    isLatest(request: number) {
      return request === latestRequest;
    },
  };
}
