export type LinkedContractWorkData = {
  title?: string | null;
  type?: string | null;
  year?: number | null;
  duration_minutes?: number | null;
  season_count?: number | null;
  season_number?: number | null;
  episode_count?: number | null;
  episode_number?: number | null;
  genre?: string | null;
  director?: string | null;
  production_companies?: string[] | null;
  production_countries?: string[] | null;
  description?: string | null;
  dfi_id?: string | number | null;
  tmdb_id?: string | number | null;
  imdb_id?: string | null;
};

type ContractData = {
  type?: string | null;
  overenskomst?: string | null;
  contract_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  working_title?: string | null;
};

function isMissing(value: unknown) {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

/**
 * Fletter kontraktens AI/manuelle data med normaliserede værksdata.
 * Eksisterende kontraktdata vinder altid; værket udfylder kun tomme felter.
 */
export function mergeContractWorkData({
  extractedData,
  contract,
  work,
  employerName,
  rightsHolderName,
}: {
  extractedData?: Record<string, unknown> | null;
  contract?: ContractData | null;
  work?: LinkedContractWorkData | null;
  employerName?: string | null;
  rightsHolderName?: string | null;
}) {
  const merged = { ...(extractedData ?? {}) };
  const productionCompanies = work?.production_companies ?? [];
  const fallbacks: Record<string, unknown> = {
    workTitle: work?.title ?? contract?.working_title,
    director: work?.director,
    duration: work?.duration_minutes,
    premiereYear: work?.year,
    employerName: employerName ?? productionCompanies[0],
    rightsHolderName,
    productionType: work?.type,
    genre: work?.genre,
    productionCompanies,
    productionCountries: work?.production_countries ?? [],
    description: work?.description,
    seasonNumber: work?.season_number,
    episodeNumber: work?.episode_number,
    episodeCount: work?.episode_count,
    seasonCount: work?.season_count,
    dfiId: work?.dfi_id,
    tmdbId: work?.tmdb_id,
    imdbId: work?.imdb_id,
    contractType: contract?.type,
    overenskomst: contract?.overenskomst,
    contractDate: contract?.contract_date,
    startDate: contract?.start_date,
    endDate: contract?.end_date,
  };

  for (const [key, fallback] of Object.entries(fallbacks)) {
    if (isMissing(merged[key]) && !isMissing(fallback)) merged[key] = fallback;
  }

  return merged;
}
