import { parseDfiEpisodeTitleInfo } from "@/lib/dfi-metadata";

export type SeriesEpisodeOption = {
  number: number;
  title: string;
};

export type SeriesChildLike = {
  title?: string | null;
  season_number?: number | null;
  episode_number?: number | null;
};

export function isSeriesType(type: string | null | undefined) {
  const normalized = String(type ?? "").toLowerCase();
  return normalized.includes("serie") || normalized.includes("tv");
}

// Formatterer en kontrakts sæson/afsnit-afgrænsning som fx "S06 E01, E02".
// Returnerer "" hvis kontrakten hverken har sæson eller afsnit (spillefilm).
export function contractEpisodeTag(
  seasonNumber: number | null | undefined,
  episodeNumbers: number[] | null | undefined,
): string {
  const hasEpisodes = Array.isArray(episodeNumbers) && episodeNumbers.length > 0;
  if (!seasonNumber && !hasEpisodes) return "";
  const seasonPart = seasonNumber ? `S${String(seasonNumber).padStart(2, "0")}` : "";
  const episodePart = hasEpisodes ? episodeNumbers!.map(n => `E${String(n).padStart(2, "0")}`).join(", ") : "";
  return [seasonPart, episodePart].filter(Boolean).join(" ");
}

export function parseLocalEpisodeCode(title: string | null | undefined) {
  if (!title) return null;
  const match = title.match(/\bS(\d{1,2})E(\d{1,3})\b/i);
  if (!match) return null;
  return {
    seasonNumber: Number.parseInt(match[1], 10),
    episodeNumber: Number.parseInt(match[2], 10),
    baseTitle: title.replace(/\s*[-–—:]?\s*S\d{1,2}E\d{1,3}.*$/i, "").trim(),
  };
}

export function inferSeriesWorkFields({
  title,
  seasonCount,
  seasonNumber,
  episodeNumber,
  episodeCount,
  knownEpisodeCount,
}: {
  title?: string | null;
  seasonCount?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  episodeCount?: number | null;
  knownEpisodeCount?: number | null;
}) {
  const parsed = parseLocalEpisodeCode(title);
  const inferredSeasonNumber = seasonNumber ?? parsed?.seasonNumber ?? null;
  const inferredEpisodeNumber = episodeNumber ?? parsed?.episodeNumber ?? null;
  const inferredSeasonCount = Math.max(
    Number(seasonCount ?? 0) || 0,
    Number(inferredSeasonNumber ?? 0) || 0,
  ) || null;
  const inferredEpisodeCount = Math.max(
    Number(episodeCount ?? 0) || 0,
    Number(knownEpisodeCount ?? 0) || 0,
    Number(inferredEpisodeNumber ?? 0) || 0,
  ) || null;

  return {
    seasonCount: inferredSeasonCount,
    seasonNumber: inferredSeasonNumber,
    episodeNumber: inferredEpisodeNumber,
    episodeCount: inferredEpisodeCount,
  };
}

export function seriesLookupTitleVariants(title: string | null | undefined) {
  const raw = title?.trim();
  if (!raw) return [];
  const variants = [
    raw,
    raw.replace(/\s*[-–—:]\s*oversigt\s*$/i, "").trim(),
    raw.replace(/\s*\(\s*oversigt\s*\)\s*$/i, "").trim(),
    raw.replace(/\s*[-–—:]\s*sæson\s+\d+\s*$/i, "").trim(),
    raw.replace(/\s*[-–—:]\s*season\s+\d+\s*$/i, "").trim(),
    raw.replace(/\s+\b(?:I|II|III|IV|V|VI|VII|VIII|IX|X|\d+)\b\s*$/i, "").trim(),
  ].filter(Boolean);
  return Array.from(new Set(variants));
}

type EpisodeOptionInput = {
  number: number;
  title?: string | null;
};

function cleanOption(option: EpisodeOptionInput | null | undefined): SeriesEpisodeOption | null {
  const number = Number(option?.number);
  if (!Number.isFinite(number) || number <= 0) return null;
  const title = typeof option?.title === "string" && option.title.trim() ? option.title.trim() : `Afsnit ${number}`;
  return { number, title };
}

export function episodeOptionsFromLocalChildren(children: SeriesChildLike[] | null | undefined, seasonNumber = 1): SeriesEpisodeOption[] {
  return (children ?? [])
    .filter(child => Number(child.season_number ?? seasonNumber) === Number(seasonNumber))
    .map((child, index) => {
      const parsed = parseLocalEpisodeCode(child.title) ?? parseDfiEpisodeTitleInfo(child.title ?? "");
      return cleanOption({
        number: Number(child.episode_number ?? parsed?.episodeNumber ?? index + 1),
        title: child.title ?? `Afsnit ${index + 1}`,
      });
    })
    .filter((option): option is SeriesEpisodeOption => Boolean(option));
}

export function buildCompleteEpisodeOptions({
  episodeCount,
  externalOptions,
  localChildren,
  seasonNumber = 1,
  defaultMinCount = 0,
}: {
  episodeCount?: number | null;
  externalOptions?: EpisodeOptionInput[] | null;
  localChildren?: SeriesChildLike[] | null;
  seasonNumber?: number | null;
  defaultMinCount?: number;
}): SeriesEpisodeOption[] {
  const sourceOptions = (externalOptions ?? []).map(cleanOption).filter((option): option is SeriesEpisodeOption => Boolean(option));
  const localOptions = episodeOptionsFromLocalChildren(localChildren, seasonNumber ?? 1);
  const maxFromOptions = [...sourceOptions, ...localOptions].reduce((max, option) => Math.max(max, option.number), 0);
  const count = Math.max(Number(episodeCount ?? 0) || 0, maxFromOptions, defaultMinCount);

  const byNumber = new Map<number, SeriesEpisodeOption>();
  for (const option of sourceOptions) byNumber.set(option.number, option);
  for (const option of localOptions) {
    const current = byNumber.get(option.number);
    if (!current || current.title === `Afsnit ${option.number}`) byNumber.set(option.number, option);
  }

  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return byNumber.get(number) ?? { number, title: `Afsnit ${number}` };
  });
}
