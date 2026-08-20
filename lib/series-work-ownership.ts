export type SeriesWorkOwnerResult =
  | { success: true; orgId: string }
  | { success: false; error: string };

export const MEMBER_SERIES_PARENT_SELECT = "id, org_id, title, type, year, parent_work_id, season_number, episode_number, status, duration_minutes, episode_count, season_count, genre, director, description, poster_url, dfi_id, tmdb_id, imdb_id, wikidata_id, dfi_metadata" as const;

export function resolveSeriesWorkOwnerOrgId(value: unknown): SeriesWorkOwnerResult {
  if (typeof value === "string" && value.trim()) {
    return { success: true, orgId: value.trim() };
  }

  return {
    success: false,
    error: "Serieværket mangler organisationstilknytning. Kontakt administrator.",
  };
}
