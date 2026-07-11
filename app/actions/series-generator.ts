"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { getTMDBEpisodeExternalIds, getTMDBSeasonEpisodes } from "@/app/actions/tmdb";
import { getDFIFilmDetails } from "@/app/actions/dfi";
import { parseDfiEpisodeTitleInfo, extractDfiDirectors, extractDfiPremiereYear, extractDfiPosterUrl } from "@/lib/dfi-metadata";
import type { DbWork } from "@/lib/db/types";

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
  const { imdb_id: _imdbId, wikidata_id: _wikidataId, dfi_metadata: _dfiMetadata, ...rest } = episode;
  return rest;
}

export async function generateEpisodesForSeries(params: {
  parentWork: DbWork;
  seasonNumber: number;
  totalEpisodes?: number | null;
}) {
  const { parentWork, seasonNumber } = params;
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

  // Hvis afsnit allerede findes, behøver vi ikke oprette dem igen
  if (existingEpisodes && existingEpisodes.length > 0) {
    return { success: true, count: existingEpisodes.length, existing: true };
  }

  const episodesToInsert: EpisodeInsert[] = [];
  const sStr = String(seasonNumber).padStart(2, "0");

  // 2. Forsøg at hente afsnitsdata fra TMDB, hvis tmdb_id findes
  if (parentWork.tmdb_id) {
    try {
      const tmdbRes = await getTMDBSeasonEpisodes(parentWork.tmdb_id, seasonNumber);
      if (tmdbRes.success && tmdbRes.episodes && tmdbRes.episodes.length > 0) {
        for (const ep of tmdbRes.episodes) {
          const externalIds = await getTMDBEpisodeExternalIds(parentWork.tmdb_id, seasonNumber, ep.episode_number);
          const eStr = String(ep.episode_number).padStart(2, "0");
          const subtitle = ep.name ? String(ep.name).trim() : "";
          const title = subtitle 
            ? `${parentWork.title} - S${sStr}E${eStr}: ${subtitle}` 
            : `${parentWork.title} - S${sStr}E${eStr}`;

          episodesToInsert.push({
            org_id: parentWork.org_id,
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
            tmdb_id: parentWork.tmdb_id,
            dfi_id: parentWork.dfi_id,
            imdb_id: externalIds.imdb_id,
            wikidata_id: externalIds.wikidata_id,
          });
        }
      }
    } catch (e) {
      console.error("TMDB afsnit hentning fejlede:", e);
    }
  }

  // 3. Forsøg at hente afsnitsdata fra DFI Children, hvis TMDB fejlede eller ikke findes
  if (episodesToInsert.length === 0 && parentWork.dfi_metadata) {
    const metadata = typeof parentWork.dfi_metadata === "object" && parentWork.dfi_metadata !== null
      ? parentWork.dfi_metadata as Record<string, unknown>
      : {};
    const children = Array.isArray(metadata.Children)
      ? metadata.Children.map(asDfiChild).filter((child): child is DfiChildMetadata => child !== null)
      : [];

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

        episodesToInsert.push({
          org_id: parentWork.org_id,
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
        org_id: parentWork.org_id,
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
        dfi_id: parentWork.dfi_id,
        tmdb_id: parentWork.tmdb_id,
      });
    }
  }

  // 5. Gem afsnit i databasen
  let { error: insertErr } = await db.from("works").insert(episodesToInsert);
  if (isMissingWorkMetadataColumnError(insertErr)) {
    ({ error: insertErr } = await db.from("works").insert(episodesToInsert.map(stripOptionalWorkMetadata)));
  }
  if (insertErr) {
    console.error("Fejl ved indsættelse af afsnit:", insertErr);
    return { success: false, error: insertErr.message };
  }

  // Opdater parent_work.episode_count og season_count, hvis de er ændret
  const updates: Partial<Pick<DbWork, "episode_count" | "season_count">> = {};
  if (params.totalEpisodes && parentWork.episode_count !== params.totalEpisodes) {
    updates.episode_count = params.totalEpisodes;
  } else if (episodesToInsert.length > 0 && !parentWork.episode_count) {
    updates.episode_count = episodesToInsert.length;
  }
  if (!parentWork.season_count || parentWork.season_count < seasonNumber) {
    updates.season_count = seasonNumber;
  }

  if (Object.keys(updates).length > 0) {
    await db.from("works").update(updates).eq("id", parentWork.id);
  }

  return { success: true, count: episodesToInsert.length, existing: false };
}
