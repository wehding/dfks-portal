"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { getTMDBSeasonEpisodes } from "@/app/actions/tmdb";
import { parseDfiEpisodeTitleInfo } from "@/lib/dfi-metadata";
import type { DbWork } from "@/lib/db/types";

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

  const episodesToInsert: any[] = [];
  const sStr = String(seasonNumber).padStart(2, "0");

  // 2. Forsøg at hente afsnitsdata fra TMDB, hvis tmdb_id findes
  if (parentWork.tmdb_id) {
    try {
      const tmdbRes = await getTMDBSeasonEpisodes(parentWork.tmdb_id, seasonNumber);
      if (tmdbRes.success && tmdbRes.episodes && tmdbRes.episodes.length > 0) {
        for (const ep of tmdbRes.episodes) {
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
          });
        }
      }
    } catch (e) {
      console.error("TMDB afsnit hentning fejlede:", e);
    }
  }

  // 3. Forsøg at hente afsnitsdata fra DFI Children, hvis TMDB fejlede eller ikke findes
  if (episodesToInsert.length === 0 && parentWork.dfi_metadata) {
    const metadata = parentWork.dfi_metadata as any;
    const children = Array.isArray(metadata.Children) ? metadata.Children : [];

    // Tjek om DFI children repræsenterer direkte afsnit (indeholder f.eks. "1:6")
    const isEpisodeChildren = children.some((c: any) => parseDfiEpisodeTitleInfo(c.Title));

    if (isEpisodeChildren) {
      for (const child of children) {
        const info = parseDfiEpisodeTitleInfo(child.Title);
        if (info) {
          const eStr = String(info.episodeNumber).padStart(2, "0");
          const title = info.subtitle 
            ? `${parentWork.title} - S${sStr}E${eStr}: ${info.subtitle}` 
            : `${parentWork.title} - S${sStr}E${eStr}`;

          episodesToInsert.push({
            org_id: parentWork.org_id,
            parent_work_id: parentWork.id,
            season_number: seasonNumber,
            episode_number: info.episodeNumber,
            title,
            type: parentWork.type,
            year: parentWork.year,
            duration_minutes: parentWork.duration_minutes,
            genre: parentWork.genre,
            director: parentWork.director,
            description: parentWork.description,
            poster_url: parentWork.poster_url,
            status: parentWork.status,
            dfi_id: String(child.Id),
            dfi_metadata: child,
          });
        }
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
  const { error: insertErr } = await db.from("works").insert(episodesToInsert);
  if (insertErr) {
    console.error("Fejl ved indsættelse af afsnit:", insertErr);
    return { success: false, error: insertErr.message };
  }

  // Opdater parent_work.episode_count og season_count, hvis de er ændret
  const updates: any = {};
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
