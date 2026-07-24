import type { ProductionCompanySelection } from "@/lib/production-companies";

export type ManualWorkFormValue = {
  title: string;
  type: string;
  year: string;
  duration_minutes: string;
  episode_count: string;
  season_number: string;
  episode_number: string;
  selected_episodes: number[];
  director: string;
  production_company: string;
  production_companies: ProductionCompanySelection[];
  contract_id: string;
};

export type ManualWorkFormSeed = Partial<ManualWorkFormValue>;

export const CONTRACT_CATEGORY_TO_WORK_TYPE: Record<string, string> = {
  feature: "spillefilm",
  short: "kortfilm",
  tvSeries: "tv-serie",
  documentary: "dokumentarfilm",
  docSeries: "dokumentar-serie",
  tvEntertainment: "tv-serie",
  reality: "tv-serie",
  sport: "tv-serie",
};

export function contractWorkTypeFilter(
  category: string | null | undefined,
  results: Array<{ type: string }>,
) {
  const preferredType = category ? CONTRACT_CATEGORY_TO_WORK_TYPE[category] : null;
  return preferredType && results.some(result => result.type === preferredType) ? preferredType : "all";
}

export function emptyManualWorkForm(seed: ManualWorkFormSeed = {}): ManualWorkFormValue {
  const { selected_episodes: selectedEpisodes = [], ...rest } = seed;
  return {
    title: "",
    type: "spillefilm",
    year: "",
    duration_minutes: "",
    episode_count: "",
    season_number: "",
    episode_number: "",
    director: "",
    production_company: "",
    production_companies: [],
    contract_id: "",
    ...rest,
    selected_episodes: [...selectedEpisodes],
  };
}

export function isManualSeries(value: Pick<ManualWorkFormValue, "type">) {
  return value.type === "tv-serie" || value.type === "dokumentar-serie";
}

export function normalizeManualWorkTitle(title: string) {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(the|en|et|den|det)\b/g, " ")
    .replace(/[^a-z0-9æøå\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isExactManualWorkMatch(
  candidate: { title: string; year: number | null },
  manual: { title: string; year: number | null },
) {
  return Boolean(
    manual.year
    && candidate.year === manual.year
    && normalizeManualWorkTitle(candidate.title) === normalizeManualWorkTitle(manual.title),
  );
}

export function manualWorkDuplicateDecision(hasExactMatch: boolean, forceCreateDuplicate: boolean) {
  if (!hasExactMatch) return "create" as const;
  return forceCreateDuplicate ? "create_pending" as const : "block" as const;
}

export function validateManualWork(value: ManualWorkFormValue, locale = "da"): string | null {
  const da = locale === "da";
  if (!value.title.trim()) return da ? "Angiv værkets titel." : "Enter the work title.";
  const premiereYear = Number.parseInt(value.year, 10);
  if (!/^\d{4}$/.test(value.year.trim()) || !Number.isFinite(premiereYear)) {
    return da ? "Angiv et gyldigt premiereår med fire cifre." : "Enter a valid four-digit premiere year.";
  }
  if (!isManualSeries(value)) return null;

  const episodeCount = Number.parseInt(value.episode_count, 10);
  if (Number.isFinite(episodeCount) && episodeCount > 0) {
    if (value.selected_episodes.length === 0) {
      return da ? "Vælg mindst ét afsnit." : "Select at least one episode.";
    }
    return null;
  }

  const episodeNumber = Number.parseInt(value.episode_number, 10);
  if (!Number.isFinite(episodeNumber) || episodeNumber < 1) {
    return da ? "Angiv mindst ét afsnit." : "Enter at least one episode.";
  }
  return null;
}

export function contractDataToManualWorkSeed(input: {
  title?: string | null;
  category?: string | null;
  duration?: string | number | null;
  premiereDate?: string | null;
  productionCompany?: string | null;
  director?: string | null;
  seasonNumber?: string | number | null;
  episodes?: Array<{ number?: number | null }> | null;
  contractId?: string | null;
}): ManualWorkFormSeed {
  const episodes = [...new Set((input.episodes ?? [])
    .map(episode => Number(episode.number))
    .filter(number => Number.isInteger(number) && number > 0))]
    .sort((a, b) => a - b);
  const maxEpisode = episodes.length > 0 ? Math.max(...episodes) : null;
  const yearMatch = input.premiereDate?.match(/^\d{4}/)?.[0] ?? "";

  return {
    title: input.title?.trim() ?? "",
    type: input.category ? CONTRACT_CATEGORY_TO_WORK_TYPE[input.category] ?? "spillefilm" : "spillefilm",
    year: yearMatch,
    duration_minutes: input.duration ? String(input.duration) : "",
    episode_count: maxEpisode ? String(maxEpisode) : "",
    season_number: input.seasonNumber ? String(input.seasonNumber) : "",
    episode_number: episodes.length === 1 ? String(episodes[0]) : "",
    selected_episodes: episodes,
    production_company: input.productionCompany?.trim() ?? "",
    production_companies: [],
    director: input.director?.trim() ?? "",
    contract_id: input.contractId?.trim() ?? "",
  };
}
