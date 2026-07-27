import "server-only";

import {
  getTMDBEpisodeExternalIds,
  getTMDBExternalIds,
  getTMDBSeasonEpisodes,
  getTMDBWorkDetails,
  findTMDBMatch,
} from "@/app/actions/tmdb";
import { enrichFromWikidata, getWikidataExternalIds, imdbFromWikidataByTmdb } from "@/app/actions/wikidata";
import { getOmdbEpisode, searchOmdb } from "@/lib/server/omdb";
import {
  classifyIdentityCandidates,
  identityLevel,
  identityTitleVariants,
  scoreIdentityCandidate,
  validImdbId,
  validWikidataId,
  type IdentityCandidate,
  type IdentityResolution,
  type WorkIdentityInput,
} from "@/lib/work-identity";

function yearFromTmdbDetails(details: Record<string, unknown>) {
  const date = details.release_date ?? details.first_air_date ?? details.air_date;
  const year = typeof date === "string" ? Number.parseInt(date.slice(0, 4), 10) : NaN;
  return Number.isFinite(year) ? year : null;
}

function candidateFrom(input: WorkIdentityInput, data: {
  imdbId: string;
  title: string;
  year?: number | null;
  type?: "movie" | "series" | "episode";
  tmdbId?: string | number | null;
  wikidataId?: string | null;
  dfiId?: string | null;
  source: "existing" | "tmdb" | "wikidata" | "omdb";
  directExternalLink?: boolean;
  exactEpisodeRelation?: boolean;
  strongProviderMatch?: boolean;
}): IdentityCandidate | null {
  if (!validImdbId(data.imdbId)) return null;
  const scored = scoreIdentityCandidate(input, data);
  return {
    imdbId: data.imdbId,
    title: data.title,
    year: data.year ?? null,
    type: data.type ?? identityLevel(input.type, input.parent),
    tmdbId: data.tmdbId == null ? null : String(data.tmdbId),
    wikidataId: validWikidataId(data.wikidataId) ? data.wikidataId : null,
    dfiId: data.dfiId ?? null,
    confidence: scored.confidence,
    sources: [data.source],
    matchedBy: scored.matchedBy,
  };
}

export async function resolveWorkIdentity(input: WorkIdentityInput): Promise<IdentityResolution> {
  if (validImdbId(input.imdbId) && input.imdbId !== input.parent?.imdbId) {
    const existing = candidateFrom(input, {
      imdbId: input.imdbId,
      title: input.title,
      year: input.year,
      source: "existing",
      directExternalLink: true,
      tmdbId: input.tmdbId,
      wikidataId: input.wikidataId,
      dfiId: input.dfiId,
    });
    return classifyIdentityCandidates(existing ? [existing] : []);
  }

  const candidates: IdentityCandidate[] = [];
  let providerError: string | null = null;
  const level = identityLevel(input.type, input.parent);

  if (level === "episode" && input.parent && input.seasonNumber && input.episodeNumber) {
    const parentTmdbId = Number(input.parent.tmdbId ?? 0);
    let episodeTitle = input.title;
    let episodeYear = input.year ?? null;
    let episodeTmdbId: number | null = null;
    let episodeWikidataId: string | null = null;
    if (parentTmdbId) {
      const season = await getTMDBSeasonEpisodes(parentTmdbId, input.seasonNumber);
      const episode = season.episodes.find(item => item.episode_number === input.episodeNumber);
      if (episode) {
        episodeTitle = episode.name?.trim() || episodeTitle;
        episodeYear = episode.air_date ? Number.parseInt(episode.air_date.slice(0, 4), 10) || episodeYear : episodeYear;
        episodeTmdbId = episode.id;
        const ids = await getTMDBEpisodeExternalIds(parentTmdbId, input.seasonNumber, input.episodeNumber);
        episodeWikidataId = validWikidataId(ids.wikidata_id) ? ids.wikidata_id : null;
        if (validImdbId(ids.imdb_id)) {
          const candidate = candidateFrom(input, {
            imdbId: ids.imdb_id,
            title: episodeTitle,
            year: episodeYear,
            type: "episode",
            source: "tmdb",
            tmdbId: episodeTmdbId,
            wikidataId: episodeWikidataId,
            dfiId: input.dfiId,
            directExternalLink: true,
            exactEpisodeRelation: true,
          });
          if (candidate) candidates.push(candidate);
        }
      }
    }
    if (episodeWikidataId) {
      const ids = await getWikidataExternalIds(episodeWikidataId);
      if (validImdbId(ids.imdb_id)) {
        const candidate = candidateFrom(input, {
          imdbId: ids.imdb_id,
          title: episodeTitle,
          year: episodeYear,
          type: "episode",
          source: "wikidata",
          tmdbId: episodeTmdbId,
          wikidataId: episodeWikidataId,
          dfiId: input.dfiId,
          directExternalLink: true,
          exactEpisodeRelation: true,
        });
        if (candidate) candidates.push(candidate);
      }
    }
    if (validImdbId(input.parent.imdbId)) {
      const omdb = await getOmdbEpisode(input.parent.imdbId, input.seasonNumber, input.episodeNumber);
      if (omdb.ok) {
        const candidate = candidateFrom(input, {
          ...omdb.data,
          source: "omdb",
          tmdbId: episodeTmdbId,
          wikidataId: episodeWikidataId,
          dfiId: input.dfiId,
          exactEpisodeRelation: true,
        });
        if (candidate) candidates.push(candidate);
      } else if (omdb.code !== "not_found" && omdb.code !== "not_configured") providerError = `omdb_${omdb.code}`;
    }
  } else {
    let tmdbId = Number(input.tmdbId ?? 0) || null;
    const tmdbMediaType: "tv" | "movie" = level === "series" ? "tv" : "movie";
    for (const title of identityTitleVariants(input)) {
      if (tmdbId) break;
      const match = await findTMDBMatch(title, input.year, tmdbMediaType);
      if (match.tmdb_id && match.media_type === tmdbMediaType) tmdbId = Number(match.tmdb_id);
    }
    if (tmdbId) {
      const [externalIds, detailResult] = await Promise.all([
        getTMDBExternalIds(tmdbId, tmdbMediaType),
        getTMDBWorkDetails(tmdbId, tmdbMediaType),
      ]);
      const details = detailResult.success && detailResult.details ? detailResult.details as Record<string, unknown> : {};
      const title = String(details.name ?? details.title ?? identityTitleVariants(input).at(-1) ?? input.title);
      const year = yearFromTmdbDetails(details) ?? input.year ?? null;
      const wikidataId = validWikidataId(externalIds.wikidata_id) ? externalIds.wikidata_id : validWikidataId(input.wikidataId) ? input.wikidataId : null;
      if (validImdbId(externalIds.imdb_id)) {
        const candidate = candidateFrom(input, {
          imdbId: externalIds.imdb_id,
          title,
          year,
          type: level,
          source: "tmdb",
          tmdbId,
          wikidataId,
          dfiId: input.dfiId,
          directExternalLink: true,
        });
        if (candidate) candidates.push(candidate);
      }
      if (wikidataId) {
        const wikidata = await getWikidataExternalIds(wikidataId);
        if (validImdbId(wikidata.imdb_id)) {
          const candidate = candidateFrom(input, {
            imdbId: wikidata.imdb_id,
            title,
            year,
            type: level,
            source: "wikidata",
            tmdbId,
            wikidataId,
            dfiId: input.dfiId,
            directExternalLink: true,
          });
          if (candidate) candidates.push(candidate);
        }
      } else {
        const imdbId = await imdbFromWikidataByTmdb(tmdbId, tmdbMediaType);
        if (validImdbId(imdbId)) {
          const candidate = candidateFrom(input, { imdbId, title, year, type: level, source: "wikidata", tmdbId, dfiId: input.dfiId, directExternalLink: true });
          if (candidate) candidates.push(candidate);
        }
      }
    }
    if (!candidates.length) {
      const wiki = await enrichFromWikidata({ title: identityTitleVariants(input).at(-1) ?? input.title, year: input.year });
      if (validImdbId(wiki.imdb_id)) {
        const candidate = candidateFrom(input, {
          imdbId: wiki.imdb_id,
          title: input.title,
          year: wiki.release_year ?? input.year,
          type: level,
          source: "wikidata",
          tmdbId,
          wikidataId: wiki.wikidata_id,
          dfiId: input.dfiId,
          strongProviderMatch: true,
        });
        if (candidate) candidates.push(candidate);
      }
    }
  }

  if (!candidates.length) {
    for (const title of identityTitleVariants(input).slice(0, 4)) {
      const omdb = await searchOmdb(title, input.year, level);
      if (!omdb.ok) {
        if (omdb.code !== "not_found" && omdb.code !== "not_configured") providerError = `omdb_${omdb.code}`;
        continue;
      }
      for (const item of omdb.data.slice(0, 5)) {
        const candidate = candidateFrom(input, { ...item, source: "omdb", dfiId: input.dfiId, strongProviderMatch: true });
        if (candidate) candidates.push(candidate);
      }
    }
  }

  const resolution = classifyIdentityCandidates(candidates);
  if (resolution.status === "not_found" && providerError) return { ...resolution, status: "error", errorCode: providerError };
  return resolution;
}
