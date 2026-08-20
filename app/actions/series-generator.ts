import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { getTMDBEpisodeExternalIds, getTMDBSeasonEpisodes } from "@/app/actions/tmdb";
import { getDFIFilmDetails } from "@/app/actions/dfi";
import { parseDfiEpisodeTitleInfo, extractDfiDirectors, extractDfiPremiereYear, extractDfiPosterUrl } from "@/lib/dfi-metadata";
import type { DbWork } from "@/lib/db/types";
import { resolveSeriesWorkOwnerOrgId } from "@/lib/series-work-ownership";
import { resolveWorkIdentity } from "@/lib/server/work-identity-resolver";
import { storeWorkExternalIdentity } from "@/lib/server/work-identity-storage";
import type { IdentityCandidate } from "@/lib/work-identity";

type EpisodeInsert = {
  org_id: string;
  parent_work_id: string;
  season_number: number;
  episode_number: number;
  title: string;
  type: string;
  year: number | null;
  duration_minutes: number | null;
  genre: string | null;
  director: string | null;
  description: string | null;
  poster_url: string | null;
  status: string;
  dfi_id?: string | null;
  tmdb_id?: number | null;
  imdb_id?: string | null;
  wikidata_id?: string | null;
  dfi_metadata?: unknown;
};

type DfiChildMetadata = Record<string, unknown> & {
  Id?: number | string | null;
  Title?: string | null;
  Category?: string | null;
  Duration?: number | string | null;
  Synopsis?: string | null;
  ShortSynopsis?: string | null;
};

type DfiEpisodeRow = {
  child: DfiChildMetadata;
  info: ReturnType<typeof parseDfiEpisodeTitleInfo>;
  episodeNumber: number;
};

export type SeriesParentWork = Pick<DbWork,
  | "id"
  | "org_id"
  | "title"
  | "type"
  | "year"
  | "duration_minutes"
  | "episode_count"
  | "season_count"
  | "genre"
  | "director"
  | "description"
  | "poster_url"
  | "status"
  | "dfi_id"
  | "tmdb_id"
  | "imdb_id"
  | "wikidata_id"
  | "dfi_metadata"
>;

function asDfiChild(value: unknown): DfiChildMetadata | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as DfiChildMetadata
    : null;
}

function textOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isMissingWorkMetadataColumnError(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "42703"
    || (/schema cache/i.test(message) && /(imdb_id|wikidata_id|dfi_metadata)/i.test(message));
}

function stripOptionalWorkMetadata(episode: EpisodeInsert): EpisodeInsert {
  const rest = { ...episode };
  delete rest.imdb_id;
  delete rest.wikidata_id;
  delete rest.dfi_metadata;
  return rest;
}

export async function generateEpisodesForSeries(params: {
  parentWork: SeriesParentWork;
  seasonNumber: number;
  totalEpisodes?: number | null;
}) {
  const { parentWork, seasonNumber } = params;
  const owner = resolveSeriesWorkOwnerOrgId(parentWork.org_id);
  if (!owner.success) return owner;
  const ownerOrgId = owner.orgId;
  const db = createServiceClient();

  // 1. Tjek om der allerede findes afsnit for denne sæson
  const { data: existingEpisodes, error: fetchErr } = await db
    .from("works")
    .select("id, episode_number")
    .eq("parent_work_id", parentWork.id)
    .eq("season_number", seasonNumber);

  if (fetchErr) {
    console.error("Fejl ved hentning af eksisterende afsnit:", fetchErr);
  }

  const existingEpisodeNumbers = new Set(
    (existingEpisodes ?? [])
      .map(episode => Number(episode.episode_number))
      .filter(number => Number.isFinite(number) && number > 0)
  );
  const requestedTotalEpisodes = params.totalEpisodes || parentWork.episode_count || null;

  // Hvis hele den efterspurgte sæson allerede findes, behøver vi ikke oprette den igen.
  if (existingEpisodeNumbers.size > 0 && requestedTotalEpisodes) {
    const hasFullSeason = Array.from({ length: requestedTotalEpisodes }, (_, index) => index + 1)
      .every(number => existingEpisodeNumbers.has(number));
    if (hasFullSeason) {
      return { success: true, count: existingEpisodeNumbers.size, existing: true };
    }
  } else if (existingEpisodeNumbers.size > 0 && !requestedTotalEpisodes) {
    return { success: true, count: existingEpisodeNumbers.size, existing: true };
  }

  const episodesToInsert: EpisodeInsert[] = [];
  const episodeIdentities = new Map<number, IdentityCandidate>();
  const sStr = String(seasonNumber).padStart(2, "0");
  const parentMetadata = typeof parentWork.dfi_metadata === "object" && parentWork.dfi_metadata !== null
    ? parentWork.dfi_metadata as Record<string, unknown>
    : {};
  const dfiChildren = Array.isArray(parentMetadata.Children)
    ? parentMetadata.Children.map(asDfiChild).filter((child): child is DfiChildMetadata => child !== null)
    : [];
  const dfiChildByEpisode = new Map(dfiChildren.map((child, index) => {
    const parsed = parseDfiEpisodeTitleInfo(child.Title);
    return [parsed?.episodeNumber ?? index + 1, child] as const;
  }));

  // 2. Forsøg at hente afsnitsdata fra TMDB, hvis tmdb_id findes
  if (parentWork.tmdb_id) {
    try {
      const tmdbRes = await getTMDBSeasonEpisodes(parentWork.tmdb_id, seasonNumber);
      if (tmdbRes.success && tmdbRes.episodes && tmdbRes.episodes.length > 0) {
        for (const ep of tmdbRes.episodes) {
          const externalIds = await getTMDBEpisodeExternalIds(parentWork.tmdb_id, seasonNumber, ep.episode_number);
          const dfiChild = dfiChildByEpisode.get(ep.episode_number);
          const eStr = String(ep.episode_number).padStart(2, "0");
          const subtitle = ep.name ? String(ep.name).trim() : "";
          const title = subtitle 
            ? `${parentWork.title} - S${sStr}E${eStr}: ${subtitle}` 
            : `${parentWork.title} - S${sStr}E${eStr}`;

          const resolution = await resolveWorkIdentity({
            title,
            alternativeTitles: [subtitle, textOrNull(dfiChild?.Title)].filter((value): value is string => Boolean(value)),
            type: parentWork.type,
            year: ep.air_date ? parseInt(ep.air_date.substring(0, 4)) : parentWork.year,
            imdbId: externalIds.imdb_id,
            wikidataId: externalIds.wikidata_id,
            dfiId: dfiChild?.Id ? String(dfiChild.Id) : null,
            parent: {
              title: parentWork.title,
              imdbId: parentWork.imdb_id,
              tmdbId: parentWork.tmdb_id,
              wikidataId: parentWork.wikidata_id,
              dfiId: parentWork.dfi_id,
            },
            seasonNumber,
            episodeNumber: ep.episode_number,
          });
          const candidate = resolution.status === "matched" ? resolution.candidates[0] : null;
          if (candidate) episodeIdentities.set(ep.episode_number, candidate);
          episodesToInsert.push({
            org_id: ownerOrgId,
            parent_work_id: parentWork.id,
            season_number: seasonNumber,
            episode_number: ep.episode_number,
            title,
            type: parentWork.type,
            year: ep.air_date ? parseInt(ep.air_date.substring(0, 4)) : parentWork.year,
            duration_minutes: ep.runtime || parentWork.duration_minutes,
            genre: parentWork.genre,
            director: parentWork.director,
            description: ep.overview || null,
            poster_url: parentWork.poster_url,
            status: parentWork.status,
            dfi_id: dfiChild?.Id ? String(dfiChild.Id) : null,
            imdb_id: candidate?.imdbId ?? externalIds.imdb_id,
            wikidata_id: candidate?.wikidataId ?? externalIds.wikidata_id,
          });
        }
      }
    } catch (e) {
      console.error("TMDB afsnit hentning fejlede:", e);
    }
  }

  // 3. Forsøg at hente afsnitsdata fra DFI Children, hvis TMDB fejlede eller ikke findes
  if (episodesToInsert.length === 0 && parentWork.dfi_metadata) {
    const children = dfiChildren;

    const childEpisodeRows = children
      .map((child, index) => {
        const info = parseDfiEpisodeTitleInfo(child.Title);
        const episodeNumber = info?.episodeNumber ?? index + 1;
        if (!Number.isFinite(episodeNumber) || episodeNumber < 1) return null;
        return { child, info, episodeNumber };
      })
      .filter((row): row is DfiEpisodeRow => row !== null);

    if (childEpisodeRows.length > 0) {
      // Hent detaljer for alle børn i parallel for at berige deres data
      const childDetailsMap = new Map<number, DfiChildMetadata>();
      try {
        const promises = childEpisodeRows.map(async ({ child }) => {
          if (!child.Id) return;
          try {
            const det = await getDFIFilmDetails(Number(child.Id));
            if (det.success && det.film) {
              const film = asDfiChild(det.film);
              if (film) childDetailsMap.set(Number(child.Id), film);
            }
          } catch (e) {
            console.error(`Kunne ikke hente DFI detaljer for barn ${child.Id}:`, e);
          }
        });
        await Promise.all(promises);
      } catch (err) {
        console.error("Fejl ved parallel DFI-børnehentning:", err);
      }

      for (const { child, info, episodeNumber } of childEpisodeRows) {
        const eStr = String(episodeNumber).padStart(2, "0");
        const fullChild = childDetailsMap.get(Number(child.Id)) || child;
        const childTitle = textOrNull(fullChild.Title) || textOrNull(child.Title) || "";
        const subtitle = info?.subtitle || childTitle;
        const title = subtitle
          ? `${parentWork.title} - S${sStr}E${eStr}: ${subtitle}`
          : `${parentWork.title} - S${sStr}E${eStr}`;

        const director = extractDfiDirectors(fullChild).join(", ") || parentWork.director;
        const year = extractDfiPremiereYear(fullChild) || parentWork.year;
        const description = textOrNull(fullChild.Synopsis) || textOrNull(fullChild.ShortSynopsis) || parentWork.description;
        const duration = fullChild.Duration ? Number(fullChild.Duration) : parentWork.duration_minutes;

        const resolution = await resolveWorkIdentity({
          title,
          alternativeTitles: [subtitle],
          type: parentWork.type,
          year,
          dfiId: child.Id ? String(child.Id) : null,
          parent: {
            title: parentWork.title,
            imdbId: parentWork.imdb_id,
            tmdbId: parentWork.tmdb_id,
            wikidataId: parentWork.wikidata_id,
            dfiId: parentWork.dfi_id,
          },
          seasonNumber,
          episodeNumber,
        });
        const candidate = resolution.status === "matched" ? resolution.candidates[0] : null;
        if (candidate) episodeIdentities.set(episodeNumber, candidate);
        episodesToInsert.push({
          org_id: ownerOrgId,
          parent_work_id: parentWork.id,
          season_number: seasonNumber,
          episode_number: episodeNumber,
          title,
          type: parentWork.type,
          year,
          duration_minutes: duration,
          genre: textOrNull(fullChild.Category) || parentWork.genre,
          director,
          description,
          poster_url: extractDfiPosterUrl(fullChild) || parentWork.poster_url,
          status: parentWork.status,
          dfi_id: child.Id ? String(child.Id) : null,
          imdb_id: candidate?.imdbId ?? null,
          wikidata_id: candidate?.wikidataId ?? null,
          dfi_metadata: fullChild,
        });
      }
    }
  }

  // 4. Fallback: Generer sekventielle afsnit baseret på episode_count eller totalEpisodes
  if (episodesToInsert.length === 0) {
    const count = params.totalEpisodes || parentWork.episode_count || 10; // default 10 afsnit
    for (let i = 1; i <= count; i++) {
      const eStr = String(i).padStart(2, "0");
      episodesToInsert.push({
        org_id: ownerOrgId,
        parent_work_id: parentWork.id,
        season_number: seasonNumber,
        episode_number: i,
        title: `${parentWork.title} - S${sStr}E${eStr}`,
        type: parentWork.type,
        year: parentWork.year,
        duration_minutes: parentWork.duration_minutes ? Math.round(parentWork.duration_minutes / count) : null,
        genre: parentWork.genre,
        director: parentWork.director,
        description: parentWork.description,
        poster_url: parentWork.poster_url,
        status: parentWork.status,
      });
    }
  }

  // Eksterne kilder kan indeholde en ufuldstændig sæson (fx kun S01E01),
  // selv om et godkendt medlem-/admininput fastslår et højere antal. Bevar de
  // fundne metadata og supplér resten med neutrale afsnit.
  if (requestedTotalEpisodes) {
    const representedNumbers = new Set([
      ...existingEpisodeNumbers,
      ...episodesToInsert.map(episode => episode.episode_number),
    ]);
    for (let episodeNumber = 1; episodeNumber <= requestedTotalEpisodes; episodeNumber++) {
      if (representedNumbers.has(episodeNumber)) continue;
      const eStr = String(episodeNumber).padStart(2, "0");
      episodesToInsert.push({
        org_id: ownerOrgId,
        parent_work_id: parentWork.id,
        season_number: seasonNumber,
        episode_number: episodeNumber,
        title: `${parentWork.title} - S${sStr}E${eStr}`,
        type: parentWork.type,
        year: parentWork.year,
        duration_minutes: parentWork.duration_minutes,
        genre: parentWork.genre,
        director: parentWork.director,
        description: parentWork.description,
        poster_url: parentWork.poster_url,
        status: parentWork.status,
      });
    }
  }

  // En godkendt rettelse med et eksplicit antal må ikke utilsigtet oprette
  // flere afsnit, blot fordi den eksterne kilde indeholder en længere sæson.
  const boundedEpisodes = requestedTotalEpisodes
    ? episodesToInsert.filter(episode => episode.episode_number <= requestedTotalEpisodes)
    : episodesToInsert;

  // 5. Gem kun de afsnit, som mangler i databasen
  const missingEpisodesToInsert = boundedEpisodes.filter(episode => !existingEpisodeNumbers.has(episode.episode_number));
  if (missingEpisodesToInsert.length === 0) {
    return { success: true, count: existingEpisodeNumbers.size, existing: true };
  }

  let { error: insertErr } = await db.from("works").insert(missingEpisodesToInsert);
  if (isMissingWorkMetadataColumnError(insertErr)) {
    ({ error: insertErr } = await db.from("works").insert(missingEpisodesToInsert.map(stripOptionalWorkMetadata)));
  }
  if (insertErr) {
    console.error("Fejl ved indsættelse af afsnit:", insertErr);
    return { success: false, error: insertErr.message };
  }

  if (episodeIdentities.size) {
    const { data: insertedRows } = await db.from("works").select("id,episode_number")
      .eq("parent_work_id", parentWork.id).eq("season_number", seasonNumber)
      .in("episode_number", [...episodeIdentities.keys()]);
    for (const row of insertedRows ?? []) {
      const candidate = episodeIdentities.get(Number(row.episode_number));
      if (candidate) await storeWorkExternalIdentity(db, { orgId: ownerOrgId, workId: row.id, level: "episode", candidate });
    }
  }

  // Opdater parent_work.episode_count og season_count, hvis de er ændret
  const updates: Partial<Pick<DbWork, "episode_count" | "season_count">> = {};
  if (params.totalEpisodes && parentWork.episode_count !== params.totalEpisodes) {
    updates.episode_count = params.totalEpisodes;
  } else if (missingEpisodesToInsert.length > 0 && !parentWork.episode_count) {
    updates.episode_count = Math.max(existingEpisodeNumbers.size + missingEpisodesToInsert.length, missingEpisodesToInsert.length);
  }
  if (!parentWork.season_count || parentWork.season_count < seasonNumber) {
    updates.season_count = seasonNumber;
  }

  if (Object.keys(updates).length > 0) {
    await db.from("works").update(updates).eq("id", parentWork.id);
  }

  return { success: true, count: missingEpisodesToInsert.length, existing: false };
}
