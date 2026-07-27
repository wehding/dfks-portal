import "server-only";

import { validImdbId, type WorkIdentityLevel } from "@/lib/work-identity";

type OmdbSearchItem = {
  Title?: string;
  Year?: string;
  imdbID?: string;
  Type?: "movie" | "series" | "episode";
};

type OmdbSearchResponse = {
  Search?: OmdbSearchItem[];
  Response?: "True" | "False";
  Error?: string;
};

type OmdbSeasonResponse = {
  Title?: string;
  Season?: string;
  Episodes?: Array<OmdbSearchItem & { Episode?: string }>;
  Response?: "True" | "False";
  Error?: string;
};

type OmdbErrorCode = "not_configured" | "invalid_key" | "quota" | "rate_limited" | "upstream" | "not_found";

export type OmdbResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: OmdbErrorCode };

function parseYear(value: string | undefined) {
  const match = value?.match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

function omdbType(level: WorkIdentityLevel) {
  return level === "series" ? "series" : level === "episode" ? "episode" : "movie";
}

function safeErrorCode(status: number, message?: string): OmdbErrorCode {
  if (status === 401 || /api key/i.test(message ?? "")) return "invalid_key";
  if (/limit|quota/i.test(message ?? "")) return "quota";
  if (status === 429) return "rate_limited";
  if (/not found/i.test(message ?? "")) return "not_found";
  return "upstream";
}

async function requestOmdb<T>(params: URLSearchParams): Promise<OmdbResult<T>> {
  const apiKey = process.env.OMDB_API_KEY?.trim();
  if (!apiKey) return { ok: false, code: "not_configured" };
  params.set("apikey", apiKey);
  params.set("r", "json");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`https://www.omdbapi.com/?${params.toString()}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({})) as T & { Response?: string; Error?: string };
      if (response.ok && data.Response !== "False") return { ok: true, data };
      const code = safeErrorCode(response.status, data.Error);
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
        continue;
      }
      return { ok: false, code };
    } catch {
      if (attempt === 2) return { ok: false, code: "upstream" };
      await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ok: false, code: "upstream" };
}

export async function searchOmdb(title: string, year: number | null | undefined, level: WorkIdentityLevel) {
  const params = new URLSearchParams({ s: title, type: omdbType(level), page: "1" });
  if (year) params.set("y", String(year));
  const result = await requestOmdb<OmdbSearchResponse>(params);
  if (!result.ok) return result;
  return {
    ok: true as const,
    data: (result.data.Search ?? []).filter(item => validImdbId(item.imdbID)).map(item => ({
      imdbId: item.imdbID!,
      title: item.Title?.trim() || title,
      year: parseYear(item.Year),
      type: item.Type === "series" ? "series" as const : item.Type === "episode" ? "episode" as const : "movie" as const,
    })),
  };
}

export async function getOmdbEpisode(seriesImdbId: string, seasonNumber: number, episodeNumber: number) {
  if (!validImdbId(seriesImdbId)) return { ok: false as const, code: "not_found" as const };
  const result = await requestOmdb<OmdbSeasonResponse>(new URLSearchParams({
    i: seriesImdbId,
    Season: String(seasonNumber),
  }));
  if (!result.ok) return result;
  const episode = (result.data.Episodes ?? []).find(item => Number(item.Episode) === episodeNumber);
  if (!episode || !validImdbId(episode.imdbID)) return { ok: false as const, code: "not_found" as const };
  return {
    ok: true as const,
    data: {
      imdbId: episode.imdbID,
      title: episode.Title?.trim() || `Afsnit ${episodeNumber}`,
      year: parseYear(episode.Year),
      type: "episode" as const,
    },
  };
}
