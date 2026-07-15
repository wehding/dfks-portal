"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { findTMDBPoster, findTMDBMatch, getTMDBExternalIds, searchTMDB, getTMDBWorkDetails, getTMDBSeasonEpisodes } from "@/app/actions/tmdb";
import { enrichFromWikidata } from "@/app/actions/wikidata";
import { getDFIFilmDetails, normalizeDfiSeriesResults, searchDFIFilms } from "@/app/actions/dfi";
import { cleanDfiTitle, extractDfiPosterUrl, extractDfiDirectors, extractDfiPremiereYear, mapDfiWorkType, parseDfiEpisodeCount, parseDfiEpisodeTitleInfo, parseSeasonNumberFromTitle, type DfiMetadata } from "@/lib/dfi-metadata";
import { generateEpisodesForSeries } from "@/app/actions/series-generator";
import type { DbWork } from "@/lib/db/types";
import { buildCompleteEpisodeOptions, isSeriesType, parseLocalEpisodeCode, seriesLookupTitleVariants } from "@/lib/series-episodes";
import { isExactManualWorkMatch, manualWorkDuplicateDecision } from "@/lib/manual-work";

import { requireOrgId } from "@/lib/org";

type MemberWorkData = {
  dfi_id?: string | null;
  tmdb_id?: number | null;
  title: string;
  type: string;
  year: number | null;
  duration_minutes?: number | null;
  episode_count?: number | null;
  season_count?: number | null;
  season_number?: number | null;
  episode_number?: number | null;
  selected_episodes?: number[] | null;
  genre?: string | null;
  director?: string | null;
  production_companies?: string[] | null;
  description?: string | null;
  poster_url?: string | null;
  dfi_metadata?: DfiMetadata | null;
  imdb_id?: string | null;
  wikidata_id?: string | null;
};

type ProposedCoEditor = {
  name: string;
  role: string;
  rightsHolderId?: string | null;
  assignmentId?: string | null;
  action?: "add" | "remove" | "change";
};

function cleanText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isMissingOptionalWorkColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "42703" || (/schema cache/i.test(message) && /(imdb_id|wikidata_id|dfi_metadata)/i.test(message));
}

function withoutOptionalWorkColumns<T extends Record<string, unknown>>(payload: T) {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !["imdb_id", "wikidata_id", "dfi_metadata"].includes(key)));
}

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(the|en|et|den|det)\b/g, " ")
    .replace(/[^a-z0-9æøå\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(a: string, b: string) {
  const aTokens = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const bTokens = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;
  let overlap = 0;
  for (const token of aTokens) if (bTokens.has(token)) overlap++;
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function isLikelySameSeriesTitle(a: string, b: string) {
  const normalizedA = normalizeTitle(cleanDfiTitle(a));
  const normalizedB = normalizeTitle(cleanDfiTitle(b));
  if (!normalizedA || !normalizedB) return false;
  return normalizedA === normalizedB || normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA) || titleSimilarity(a, b) >= 0.6;
}

function dfiEpisodeOptionsFromFilm(film: DfiMetadata | Record<string, unknown> | null | undefined) {
  const children = Array.isArray((film as Record<string, unknown> | null | undefined)?.Children)
    ? ((film as Record<string, unknown>).Children as Array<Record<string, unknown>>)
    : [];
  const options = children
    .map((child, index) => {
      const title = typeof child.Title === "string" ? child.Title : "";
      const parsed = parseDfiEpisodeTitleInfo(title);
      const number = parsed?.episodeNumber ?? index + 1;
      if (!Number.isFinite(number) || number <= 0) return null;
      return {
        number,
        title: parsed?.subtitle || title || `Afsnit ${number}`,
        dfiId: child.Id ? String(child.Id) : null,
      };
    })
    .filter((option): option is { number: number; title: string; dfiId: string | null } => Boolean(option))
    .sort((a, b) => a.number - b.number);
  const textCount = parseDfiEpisodeCount(
    [
      (film as Record<string, unknown> | null | undefined)?.Comment,
      (film as Record<string, unknown> | null | undefined)?.Synopsis,
      (film as Record<string, unknown> | null | undefined)?.ShortSynopsis,
    ].filter(value => typeof value === "string").join(" ")
  );
  const maxOption = options.reduce((max, option) => Math.max(max, option.number), 0);
  return { options, episodeCount: Math.max(textCount ?? 0, maxOption) || null };
}

async function findDfiSeriesByTitle(title: string, year: number | null | undefined) {
  for (const candidate of seriesLookupTitleVariants(title)) {
    const search = await searchDFIFilms(candidate).catch(() => ({ success: false, results: [] as unknown[] }));
    const normalized = await normalizeDfiSeriesResults((search.success ? search.results ?? [] : []) as any[]);
    const match = normalized.find((film: any) => {
      const mappedType = mapDfiWorkType(film.Category, film.Type);
      if (!isSeriesType(mappedType)) return false;
      const filmTitle = cleanDfiTitle(film.Title || film.DanishTitle || "");
      if (!filmTitle.trim()) return false;
      const filmYear = extractDfiPremiereYear(film);
      if (year && filmYear && Math.abs(filmYear - year) > 1) return false;
      return isLikelySameSeriesTitle(filmTitle, title) || isLikelySameSeriesTitle(filmTitle, candidate);
    });
    if (match) return match as DfiMetadata;
  }
  return null;
}

async function resolveExternalSeriesEpisodesForTitle(params: {
  title: string;
  year?: number | null;
  dfiId?: string | null;
  tmdbId?: number | null;
  seasonNumber: number;
}) {
  let dfiMetadata: DfiMetadata | null = null;
  let tmdbId = params.tmdbId ?? null;
  let episodeOptions: { number: number; title: string; dfiId?: string | null }[] = [];
  let episodeCount: number | null = null;

  try {
    if (params.dfiId) {
      const details = await getDFIFilmDetails(Number(params.dfiId));
      if (details.success && details.film) dfiMetadata = details.film as DfiMetadata;
    }
    if (!dfiMetadata) {
      dfiMetadata = await findDfiSeriesByTitle(params.title, params.year);
    }
    if (dfiMetadata) {
      const dfiEpisodes = dfiEpisodeOptionsFromFilm(dfiMetadata);
      episodeOptions = dfiEpisodes.options;
      episodeCount = dfiEpisodes.episodeCount;
      if (!tmdbId && typeof (dfiMetadata as Record<string, unknown>).TmdbId === "number") {
        tmdbId = Number((dfiMetadata as Record<string, unknown>).TmdbId);
      }
    }
  } catch (error) {
    console.error("DFI serieafsnit lookup fejlede:", error);
  }

  try {
    if (!tmdbId) {
      for (const candidate of seriesLookupTitleVariants(params.title)) {
        const match = await findTMDBMatch(candidate, params.year);
        if (match.tmdb_id && match.media_type === "tv") {
          tmdbId = match.tmdb_id;
          break;
        }
      }
    }
    if (tmdbId) {
      const season = await getTMDBSeasonEpisodes(tmdbId, params.seasonNumber);
      const tmdbOptions = (season.episodes ?? [])
        .map(episode => ({
          number: Number(episode.episode_number),
          title: episode.name || `Afsnit ${episode.episode_number}`,
        }))
        .filter(option => Number.isFinite(option.number) && option.number > 0);
      if (tmdbOptions.length > episodeOptions.length) episodeOptions = tmdbOptions;
      if (tmdbOptions.length) episodeCount = Math.max(episodeCount ?? 0, ...tmdbOptions.map(option => option.number));
    }
  } catch (error) {
    console.error("TMDB serieafsnit lookup fejlede:", error);
  }

  return { dfiMetadata, tmdbId, episodeOptions, episodeCount };
}

async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Du skal være logget ind.");
  return data.user;
}

async function currentOrgId(db: ReturnType<typeof createServiceClient>, userId: string): Promise<string> {
  return requireOrgId(db, userId);
}

async function ensureOwnRightsHolder(db: ReturnType<typeof createServiceClient>, rightsHolderId: string) {
  const user = await currentUser();
  const { data, error } = await db
    .from("rettighedshavere")
    .select("id, full_name, user_id")
    .eq("id", rightsHolderId)
    .single();

  if (error || !data || data.user_id !== user.id) throw new Error("Du kan kun ændre dine egne værker.");
  return { user, rightsHolder: data };
}

export async function fetchMemberWorkDetail(params: { rightsHolderId: string; assignmentId: string }) {
  const db = createServiceClient();
  const rh = await ensureOwnRightsHolder(db, params.rightsHolderId);
  const { data: assignment, error } = await db
    .from("work_assignments")
    .select("id, role, contract_id, episode_id, created_at, episodes(episode_number,title), works(id, title, type, year, duration_minutes, season_count, episode_count, parent_work_id, season_number, episode_number, genre, director, production_companies, status, dfi_id, tmdb_id, poster_url, description, work_production_numbers(tv_station, number), work_change_requests(*, work_change_request_comments(*)))")
    .eq("id", params.assignmentId)
    .eq("rights_holder_id", rh.rightsHolder.id)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!assignment) return { success: false, error: "Værket blev ikke fundet." };

  const workId = (assignment as { works?: { id?: string | null } | null }).works?.id;
  const { data: coEditors } = workId
    ? await db
        .from("work_assignments")
        .select("id, work_id, role, rights_holder_id, rettighedshavere(id, full_name)")
        .eq("work_id", workId)
        .neq("rights_holder_id", rh.rightsHolder.id)
    : { data: [] };

  return { success: true, assignment, coEditors: coEditors ?? [] };
}

function normalizeCoEditors(coEditors?: ProposedCoEditor[]) {
  return (coEditors ?? [])
    .map(editor => ({
      name: cleanText(editor.name),
      role: cleanText(editor.role) ?? "Klipper",
      rightsHolderId: cleanText(editor.rightsHolderId ?? undefined),
      assignmentId: cleanText(editor.assignmentId ?? undefined),
      action: editor.action ?? "add",
    }))
    .filter(editor => Boolean(editor.name))
    .map(editor => ({
      name: editor.name as string,
      role: editor.role,
      rightsHolderId: editor.rightsHolderId,
      assignmentId: editor.assignmentId,
      action: editor.action,
    }));
}

async function findSimilarWorks(db: ReturnType<typeof createServiceClient>, title: string, year: number | null, orgId: string) {
  if (!title.trim()) return [];
  const { data } = await db
    .from("works")
    .select("id, title, type, year, status, dfi_id, tmdb_id, poster_url")
    .eq("org_id", orgId)
    .limit(200);

  return (data ?? [])
    .filter(work => {
      const yearsClose = year && work.year ? Math.abs(year - work.year) <= 1 : true;
      return yearsClose && (normalizeTitle(work.title) === normalizeTitle(title) || titleSimilarity(work.title, title) >= 0.65);
    })
    .slice(0, 8);
}

export async function findManualWorkDuplicates(title: string, year: number | null) {
  const db = createServiceClient();
  const user = await currentUser();
  const orgId = await currentOrgId(db, user.id);
  if (!title.trim() || !year) return { success: true, matches: [] };

  const { data, error } = await db
    .from("works")
    .select("id, title, type, year, poster_url, status")
    .eq("org_id", orgId)
    .eq("year", year);
  if (error) return { success: false, error: error.message, matches: [] };

  return {
    success: true,
    matches: (data ?? []).filter(work => isExactManualWorkMatch(work, { title, year })),
  };
}

async function createWorkRequest(params: {
  db: ReturnType<typeof createServiceClient>;
  workId: string;
  userId: string;
  rightsHolderId: string;
  source: string;
  oldData?: Record<string, unknown>;
  proposedData: Record<string, unknown>;
  comment: string;
  status?: "pending" | "approved" | "rejected";
}) {
  const orgId = await currentOrgId(params.db, params.userId);
  const { data: request, error: requestError } = await params.db
    .from("work_change_requests")
    .insert({
      org_id: orgId,
      work_id: params.workId,
      requested_by_user_id: params.userId,
      requested_by_rights_holder_id: params.rightsHolderId,
      source: params.source,
      old_data: params.oldData ?? {},
      proposed_data: params.proposedData,
      status: params.status ?? "pending",
    })
    .select("id")
    .single();

  if (requestError || !request?.id) throw new Error(requestError?.message ?? "Kunne ikke oprette request.");

  const trimmed = params.comment.trim();
  const now = new Date().toISOString();
  const baseComment = {
    request_id: request.id,
    author_user_id: params.userId,
    author_role: "member",
    message: trimmed || "Ingen bemærkning.",
  };
  let { error: commentError } = await params.db.from("work_change_request_comments").insert({
    ...baseComment,
    member_read_at: now,
    // Kun reelle beskeder tæller som ulæst for admin (pending besked).
    // Tom bemærkning markeres som læst, så den ikke giver falsk besked-badge.
    admin_read_at: trimmed ? null : now,
  });
  // Fallback hvis read-markør-kolonnerne endnu ikke er migreret ind i DB'en
  // (migration 20260706190000). Så crasher work-add ikke før migrationen er kørt.
  if (commentError && /read_at|schema cache/i.test(commentError.message)) {
    ({ error: commentError } = await params.db.from("work_change_request_comments").insert(baseComment));
  }
  if (commentError) throw new Error(commentError.message);
  return request.id as string;
}

// Fjerner afsnits-suffiks fra en afsnitstitel for at få seriens grundtitel.
// "Frontlinjen - S01E01: Vi kommer med fred" -> "Frontlinjen"
// "Frontlinjen 1:6 - Vi kommer med fred"     -> "Frontlinjen"
function deriveSeriesBaseTitle(title: string | null | undefined): string {
  return (title ?? "")
    .replace(/\s*[-–—]?\s*S\d+E\d+.*$/i, "")
    .replace(/\s*\d+:\d+\s*[-–—:].*$/i, "")
    .replace(/\s*[-–—:]\s*$/, "")
    .trim();
}

async function fetchMemberAssignment(db: ReturnType<typeof createServiceClient>, workId: string, rightsHolderId: string) {
  const { data } = await db
    .from("work_assignments")
    .select("id, role, contract_id, episode_id, created_at, episodes(episode_number,title), works(id, title, type, year, duration_minutes, season_count, episode_count, genre, director, production_companies, status, dfi_id, tmdb_id, poster_url, description, work_change_requests(*, work_change_request_comments(*)))")
    .eq("work_id", workId)
    .eq("rights_holder_id", rightsHolderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data;
}

export async function addWorkForMember(params: {
  rightsHolderId: string;
  role: string;
  workData: {
    dfi_id?: string;
    tmdb_id?: number;
    title: string;
    type: string;
    year: number | null;
    duration_minutes?: number | null;
    episode_count?: number | null;
    genre?: string | null;
    director?: string | null;
    description?: string | null;
    poster_url?: string | null;
    imdb_id?: string | null;
    wikidata_id?: string | null;
  };
}) {
  const db = createServiceClient();
  const { user } = await ensureOwnRightsHolder(db, params.rightsHolderId);
  const orgId = await currentOrgId(db, user.id);

  // Find eksisterende værk
  let workId: string | null = null;
  let existingPosterUrl: string | null = null;
  let existingTmdbId: number | null = null;
  if (params.workData.dfi_id) {
    const { data } = await db.from("works").select("id, poster_url, tmdb_id").eq("dfi_id", params.workData.dfi_id).maybeSingle();
    if (data) {
      workId = data.id;
      existingPosterUrl = data.poster_url;
      existingTmdbId = data.tmdb_id;
    }
  }
  if (!workId && params.workData.tmdb_id) {
    const { data } = await db.from("works").select("id, poster_url, tmdb_id").eq("tmdb_id", params.workData.tmdb_id).maybeSingle();
    if (data) {
      workId = data.id;
      existingPosterUrl = data.poster_url;
      existingTmdbId = data.tmdb_id;
    }
  }

  let posterUrl = params.workData.poster_url ?? null;
  let tmdbId = params.workData.tmdb_id ?? existingTmdbId ?? null;
  let imdbId = params.workData.imdb_id ?? null;
  let wikidataId = params.workData.wikidata_id ?? null;
  let dfiMetadata: DfiMetadata | null = null;

  if (params.workData.dfi_id) {
    try {
      const details = await getDFIFilmDetails(Number(params.workData.dfi_id));
      if (details.success && details.film) {
        dfiMetadata = details.film as DfiMetadata;
        posterUrl = details.posterDataUrl ?? extractDfiPosterUrl(dfiMetadata) ?? posterUrl;
      }
    } catch (e) {
      console.error("DFI lookup error in member-works action:", e);
    }
  }

  // Hvis det er et DFI værk og vi ikke har en TMDB plakat/id endnu, så prøv at slå det op
  if (params.workData.dfi_id && !tmdbId) {
    try {
      const match = await findTMDBMatch(params.workData.title, params.workData.year);
      if (match.tmdb_id) tmdbId = match.tmdb_id;
      if (match.poster_url && !posterUrl) posterUrl = match.poster_url;
      if (match.tmdb_id) {
        const externalIds = await getTMDBExternalIds(match.tmdb_id, match.media_type ?? "movie");
        imdbId = imdbId ?? externalIds.imdb_id;
        wikidataId = wikidataId ?? externalIds.wikidata_id;
      }
    } catch (e) {
      console.error("DFI import TMDB match lookup error:", e);
    }
  }

  if (!posterUrl) {
    posterUrl = await findTMDBPoster(params.workData.title, params.workData.year) ?? null;
  }

  try {
    const wiki = await enrichFromWikidata({ imdbId, title: params.workData.title, year: params.workData.year });
    imdbId = imdbId ?? wiki.imdb_id;
    wikidataId = wikidataId ?? wiki.wikidata_id;
  } catch {
    // Wikidata er kun berigelse.
  }

  // Opret nyt værk hvis ikke fundet
  if (!workId) {
    const { data: nw, error } = await db
      .from("works")
      .insert({
        org_id: orgId,
        status: "godkendt",
        ...params.workData,
        poster_url: posterUrl,
        tmdb_id: tmdbId,
        imdb_id: imdbId,
        wikidata_id: wikidataId,
        dfi_metadata: dfiMetadata,
      })
      .select("id")
      .single();
    if (error || !nw) return { success: false, error: error?.message ?? "Kunne ikke oprette værk" };
    workId = nw.id;
  } else {
    // Opdater hvis der mangler plakat, TMDB id eller DFI metadata
    const updates: Partial<MemberWorkData> = {};
    if (!existingPosterUrl && posterUrl) updates.poster_url = posterUrl;
    if (!existingTmdbId && tmdbId) updates.tmdb_id = tmdbId;
    if (imdbId) updates.imdb_id = imdbId;
    if (wikidataId) updates.wikidata_id = wikidataId;
    if (dfiMetadata) updates.dfi_metadata = dfiMetadata;
    if (Object.keys(updates).length > 0) {
      await db.from("works").update(updates).eq("id", workId);
    }
  }

  // Kobl rettighedshaver
  const { error: assignErr } = await db
    .from("work_assignments")
    .upsert(
      { work_id: workId, org_id: orgId, rights_holder_id: params.rightsHolderId, role: params.role },
      { onConflict: "work_id,rights_holder_id,role" }
    );
  if (assignErr) return { success: false, error: assignErr.message };

  // Hent det oprettede assignment
  const { data: fresh } = await db
    .from("work_assignments")
    .select("id, role, contract_id, episode_id, created_at, episodes(episode_number,title), works(id, title, type, year, duration_minutes, season_count, episode_count, genre, director, production_companies, status, dfi_id, tmdb_id, poster_url, description)")
    .eq("work_id", workId)
    .eq("rights_holder_id", params.rightsHolderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return { success: true, assignment: fresh };
}

export async function searchLocalWorksForMember(query: string) {
  const user = await currentUser();
  const db = createServiceClient();
  const orgId = await currentOrgId(db, user.id);
  const q = query.trim();
  if (!q) return { success: true, works: [] };

  const { data, error } = await db
    .from("works")
    .select("id, title, type, year, duration_minutes, season_count, episode_count, parent_work_id, season_number, episode_number, genre, director, production_companies, status, dfi_id, tmdb_id, imdb_id, field_sources, poster_url, description, work_assignments(id, role, rights_holder_id, rettighedshavere(id, full_name))")
    .eq("org_id", orgId)
    .ilike("title", `%${q}%`)
    .limit(10);

  if (error) return { success: false, error: error.message, works: [] };
  return { success: true, works: data ?? [] };
}

export async function linkExistingWorkForMember(params: {
  rightsHolderId: string;
  workId: string;
  role: string;
  comment?: string;
  coEditors?: ProposedCoEditor[];
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  selectedEpisodes?: number[] | null;
}) {
  const db = createServiceClient();
  const { user } = await ensureOwnRightsHolder(db, params.rightsHolderId);
  const orgId = await currentOrgId(db, user.id);

  const { data: work, error: workError } = await db
    .from("works")
    .select("id, title, type, year, parent_work_id, season_number, episode_number, status, duration_minutes, episode_count, season_count, genre, director, description, poster_url, dfi_id, tmdb_id, dfi_metadata")
    .eq("id", params.workId)
    .eq("org_id", orgId)
    .single();
  if (workError || !work) return { success: false, error: "Værket findes ikke." };

  let targetWorkIds = [params.workId];

  // Hvis det er en serie, skal medlemmet tilknyttes konkrete afsnit.
  const isSeries = work.type === "tv-serie" || work.type === "dokumentar-serie";
  const selectedEpisodeNumbers = (params.selectedEpisodes ?? []).filter(Number.isFinite);

  if (isSeries && work.parent_work_id === null && work.episode_number === null) {
    // Ægte serie-parent → generér og tilknyt de valgte afsnit.
    if (!params.seasonNumber) {
      return { success: false, error: "Vælg mindst ét afsnit." };
    }
    if (selectedEpisodeNumbers.length === 0 && !params.episodeNumber) {
      return { success: false, error: "Vælg mindst ét afsnit." };
    }

    const externalEpisodes = await resolveExternalSeriesEpisodesForTitle({
      title: work.title,
      year: work.year,
      dfiId: work.dfi_id ? String(work.dfi_id) : null,
      tmdbId: work.tmdb_id ? Number(work.tmdb_id) : null,
      seasonNumber: params.seasonNumber,
    });
    const totalEpisodes = Math.max(
      Number(work.episode_count ?? 0) || 0,
      externalEpisodes.episodeCount ?? 0,
      selectedEpisodeNumbers.reduce((max, number) => Math.max(max, number), 0),
      params.episodeNumber ?? 0
    );
    const genRes = await generateEpisodesForSeries({
      parentWork: {
        ...work,
        tmdb_id: externalEpisodes.tmdbId ?? work.tmdb_id,
        dfi_metadata: externalEpisodes.dfiMetadata ?? work.dfi_metadata,
        episode_count: totalEpisodes || work.episode_count,
      } as unknown as DbWork,
      seasonNumber: params.seasonNumber,
      totalEpisodes: totalEpisodes || undefined,
    });
    if (!genRes.success) return { success: false, error: genRes.error };

    let episodeQuery = db
      .from("works")
      .select("id")
      .eq("parent_work_id", work.id)
      .eq("season_number", params.seasonNumber);

    if (selectedEpisodeNumbers.length > 0) {
      episodeQuery = episodeQuery.in("episode_number", selectedEpisodeNumbers);
    } else if (params.episodeNumber) {
      episodeQuery = episodeQuery.eq("episode_number", params.episodeNumber);
    }

    const { data: epWorks } = await episodeQuery;
    if (epWorks && epWorks.length > 0) {
      targetWorkIds = epWorks.map(ep => ep.id);
    }
    if (targetWorkIds.length === 0 || targetWorkIds.includes(params.workId)) {
      return { success: false, error: "Ingen afsnit fundet til tildeling." };
    }
  } else if (isSeries && work.episode_number !== null) {
    // Brugeren valgte et enkelt afsnit-værk → tilknyt de valgte afsnitsnumre.
    // Eksisterende søsken-afsnit (samme DFI/TMDB-serie) genbruges; manglende oprettes.
    const seasonNum = params.seasonNumber ?? work.season_number ?? 1;
    const wanted = selectedEpisodeNumbers.length > 0
      ? selectedEpisodeNumbers
      : params.episodeNumber
      ? [params.episodeNumber]
      : [work.episode_number];

    let siblingQuery = db
      .from("works")
      .select("id, episode_number")
      .eq("org_id", orgId)
      .in("type", ["tv-serie", "dokumentar-serie"])
      .not("episode_number", "is", null);
    if (work.dfi_id) siblingQuery = siblingQuery.eq("dfi_id", work.dfi_id);
    else if (work.tmdb_id) siblingQuery = siblingQuery.eq("tmdb_id", work.tmdb_id);
    else siblingQuery = siblingQuery.eq("id", work.id);

    const { data: siblings } = await siblingQuery;
    const existingByNum = new Map<number, string>();
    for (const s of siblings ?? []) if (s.episode_number != null) existingByNum.set(s.episode_number, s.id);

    const ids: string[] = [];
    const missing: number[] = [];
    for (const n of wanted) {
      const existing = existingByNum.get(n);
      if (existing) ids.push(existing);
      else missing.push(n);
    }

    // Opret manglende afsnit som selvstændige afsnit-værker (samme metadata).
    if (missing.length > 0) {
      const baseTitle = deriveSeriesBaseTitle(work.title);
      const sStr = String(seasonNum).padStart(2, "0");
      const rows = missing.map(n => ({
        org_id: orgId,
        status: "godkendt",
        title: `${baseTitle} - S${sStr}E${String(n).padStart(2, "0")}`,
        type: work.type,
        year: work.year,
        season_number: seasonNum,
        episode_number: n,
        genre: work.genre ?? null,
        director: work.director ?? null,
        poster_url: work.poster_url ?? null,
        dfi_id: work.dfi_id ?? null,
        tmdb_id: work.tmdb_id ?? null,
        dfi_metadata: work.dfi_metadata ?? null,
      }));
      const { data: created, error: createErr } = await db.from("works").insert(rows).select("id");
      if (createErr) return { success: false, error: createErr.message };
      for (const c of created ?? []) ids.push(c.id);
    }

    targetWorkIds = ids.length > 0 ? ids : [work.id];
  }

  const assignments = targetWorkIds.map(workId => ({
    work_id: workId,
    org_id: orgId,
    rights_holder_id: params.rightsHolderId,
    role: params.role,
  }));

  const { data: existingAssignments, error: existingError } = await db
    .from("work_assignments")
    .select("work_id")
    .eq("rights_holder_id", params.rightsHolderId)
    .eq("role", params.role)
    .in("work_id", targetWorkIds);
  if (existingError) return { success: false, error: existingError.message };
  const alreadyExists = targetWorkIds.length > 0 && (existingAssignments?.length ?? 0) === targetWorkIds.length;

  const { error: assignErr } = await db
    .from("work_assignments")
    .upsert(
      assignments,
      { onConflict: "work_id,rights_holder_id,role" }
    );
  if (assignErr) return { success: false, error: assignErr.message };

  const coEditors = normalizeCoEditors(params.coEditors);
  if (coEditors.length) {
    const requestId = await createWorkRequest({
      db,
      workId: params.workId,
      userId: user.id,
      rightsHolderId: params.rightsHolderId,
      source: "Mine værker - medklippere",
      oldData: { work },
      proposedData: { kind: "co_editors", coEditors },
      comment: params.comment ?? "",
    });
    const fresh = await fetchMemberAssignment(db, params.workId, params.rightsHolderId);
    revalidatePath("/portal/mine-vaerker");
    revalidatePath("/admin/vaerker");
    return { success: true, pending: true, alreadyExists, requestId, workId: targetWorkIds[0] ?? params.workId, assignment: fresh };
  }

  // Genbrug af eksisterende værk kræver ikke godkendelse. Men skrev brugeren en
  // besked, oprettes en auto-godkendt besked-request så den vises som pending besked.
  if ((params.comment ?? "").trim()) {
    await createWorkRequest({
      db,
      workId: targetWorkIds[0] ?? params.workId,
      userId: user.id,
      rightsHolderId: params.rightsHolderId,
      source: "Mine værker - besked",
      oldData: { work },
      proposedData: { kind: "message" },
      comment: params.comment ?? "",
      status: "approved",
    });
    revalidatePath("/admin/vaerker");
  }

  const fresh = await fetchMemberAssignment(db, targetWorkIds[0] ?? params.workId, params.rightsHolderId);

  return { success: true, alreadyExists, workId: targetWorkIds[0] ?? params.workId, assignment: fresh };
}

export async function addWorkForMemberWithApproval(params: {
  rightsHolderId: string;
  role: string;
  workData: MemberWorkData;
  comment: string;
  coEditors?: ProposedCoEditor[];
  source: "manual" | "dfi" | "tmdb";
  overrideLocalMatch?: boolean;
}) {
  const db = createServiceClient();
  const { user } = await ensureOwnRightsHolder(db, params.rightsHolderId);
  const orgId = await currentOrgId(db, user.id);
  const similarWorks = await findSimilarWorks(db, params.workData.title, params.workData.year, orgId);
  const exactExistingWork = similarWorks.find(work => {
    if (params.source === "manual") {
      return isExactManualWorkMatch(work, { title: params.workData.title, year: params.workData.year });
    }
    const sameTitle = normalizeTitle(work.title) === normalizeTitle(params.workData.title);
    const sameYear = params.workData.year && work.year ? work.year === params.workData.year : true;
    return sameTitle && sameYear;
  }) ?? null;
  const coEditors = normalizeCoEditors(params.coEditors);
  const forceManualDuplicate = params.source === "manual" && Boolean(params.overrideLocalMatch);
  // Manuelle værker kræver kun godkendelse ved et eksakt titel/år-match, som brugeren
  // eksplicit har valgt at oprette på trods af. Eksterne kilder beholder den bredere kontrol.
  const requiresApproval = params.source === "manual" ? forceManualDuplicate : similarWorks.length > 0;
  let dfiMetadata = params.workData.dfi_metadata ?? null;
  let posterUrl = params.workData.poster_url ?? null;
  let tmdbId = params.workData.tmdb_id ?? null;
  let imdbId = params.workData.imdb_id ?? null;
  let wikidataId = params.workData.wikidata_id ?? null;

  if (params.workData.dfi_id && !dfiMetadata) {
    try {
      const details = await getDFIFilmDetails(Number(params.workData.dfi_id));
      if (details.success && details.film) {
        dfiMetadata = details.film as DfiMetadata;
        posterUrl = details.posterDataUrl ?? extractDfiPosterUrl(dfiMetadata) ?? posterUrl;
      }
    } catch (error) {
      console.error("DFI lookup error in addWorkForMemberWithApproval:", error);
    }
  }

  if (params.workData.dfi_id && !tmdbId) {
    try {
      const match = await findTMDBMatch(params.workData.title, params.workData.year);
      if (match.tmdb_id) tmdbId = match.tmdb_id;
      if (match.poster_url && !posterUrl) posterUrl = match.poster_url;
      if (match.tmdb_id) {
        const externalIds = await getTMDBExternalIds(match.tmdb_id, match.media_type ?? "movie");
        imdbId = imdbId ?? externalIds.imdb_id;
        wikidataId = wikidataId ?? externalIds.wikidata_id;
      }
    } catch (error) {
      console.error("DFI TMDB match lookup error in addWorkForMemberWithApproval:", error);
    }
  }

  posterUrl = posterUrl ?? await findTMDBPoster(params.workData.title, params.workData.year) ?? null;
  try {
    const wiki = await enrichFromWikidata({ imdbId, title: params.workData.title, year: params.workData.year });
    imdbId = imdbId ?? wiki.imdb_id;
    wikidataId = wikidataId ?? wiki.wikidata_id;
  } catch {
    // Wikidata er kun en berigelse.
  }
  const enrichedWorkData = {
    ...params.workData,
    tmdb_id: tmdbId,
    imdb_id: imdbId,
    wikidata_id: wikidataId,
    poster_url: posterUrl,
    dfi_metadata: dfiMetadata,
  };

  const isSeries = params.workData.type === "tv-serie" || params.workData.type === "dokumentar-serie";
  let finalWorkId: string;
  let parentWork: DbWork | null = null;
  let parentWasCreated = false;

  if (isSeries) {
    // 1. Forsøg at finde eksisterende overordnet serieværk
    if (forceManualDuplicate) {
      parentWork = null;
    } else if (enrichedWorkData.dfi_id) {
      const { data } = await db.from("works").select("*").eq("dfi_id", enrichedWorkData.dfi_id).eq("org_id", orgId).is("parent_work_id", null).maybeSingle();
      parentWork = data;
    } else if (enrichedWorkData.tmdb_id) {
      const { data } = await db.from("works").select("*").eq("tmdb_id", enrichedWorkData.tmdb_id).eq("org_id", orgId).is("parent_work_id", null).maybeSingle();
      parentWork = data;
    } else {
      let parentQuery = db.from("works").select("*").eq("title", enrichedWorkData.title).eq("org_id", orgId).is("parent_work_id", null);
      if (params.source === "manual" && enrichedWorkData.year) {
        parentQuery = parentQuery.eq("year", enrichedWorkData.year);
      }
      const { data } = await parentQuery.maybeSingle();
      parentWork = data;
    }

    // 2. Opret overordnet serieværk, hvis det ikke findes
    if (!parentWork) {
      const parentPayload = {
        org_id: orgId,
        status: requiresApproval ? "til_godkendelse" : "godkendt",
        title: enrichedWorkData.title,
        type: enrichedWorkData.type,
        year: enrichedWorkData.year,
        duration_minutes: enrichedWorkData.duration_minutes ?? null,
        episode_count: enrichedWorkData.episode_count ?? null,
        season_count: enrichedWorkData.season_count ?? null,
        genre: enrichedWorkData.genre ?? null,
        director: enrichedWorkData.director ?? null,
        production_companies: enrichedWorkData.production_companies ?? [],
        description: enrichedWorkData.description ?? null,
        poster_url: enrichedWorkData.poster_url ?? null,
        dfi_id: enrichedWorkData.dfi_id ?? null,
        tmdb_id: enrichedWorkData.tmdb_id ?? null,
        imdb_id: enrichedWorkData.imdb_id ?? null,
        wikidata_id: enrichedWorkData.wikidata_id ?? null,
        dfi_metadata: enrichedWorkData.dfi_metadata ?? null,
      };

      let { data, error: parentError } = await db
        .from("works")
        .insert(parentPayload)
        .select("*")
        .single();
      if (isMissingOptionalWorkColumn(parentError)) {
        const retry = await db.from("works").insert(withoutOptionalWorkColumns(parentPayload)).select("*").single();
        data = retry.data;
        parentError = retry.error;
      }
      if (parentError || !data) return { success: false, error: parentError?.message ?? "Kunne ikke oprette serieværk." };
      parentWork = data;
      parentWasCreated = true;
    }

    if (!parentWork) return { success: false, error: "Kunne ikke finde eller oprette serieværk." };

    // 3. Generer episoder for den givne sæson
    const seasonNum = params.workData.season_number ?? 1;
    const genRes = await generateEpisodesForSeries({
      parentWork,
      seasonNumber: seasonNum,
      totalEpisodes: params.workData.episode_count,
    });
    if (!genRes.success) return { success: false, error: genRes.error };

    // Hent de genererede episoder
    const { data: episodes } = await db
      .from("works")
      .select("*")
      .eq("parent_work_id", parentWork.id)
      .eq("season_number", seasonNum);

    // Find de specifikke afsnit at tildele medlemmet
    let targetEpisodes = [];
    if (params.workData.selected_episodes && params.workData.selected_episodes.length > 0) {
      targetEpisodes = (episodes ?? []).filter(e => params.workData.selected_episodes!.includes(e.episode_number));
    } else if (params.workData.episode_number) {
      targetEpisodes = (episodes ?? []).filter(e => e.episode_number === params.workData.episode_number);
    } else {
      return { success: false, error: "Vælg mindst ét afsnit." };
    }

    if (targetEpisodes.length === 0) {
      return { success: false, error: "Ingen afsnit fundet til tildeling." };
    }

    // Opret assignments for alle målafsnit
    const assignmentsToInsert = targetEpisodes.map(ep => ({
      work_id: ep.id,
      org_id: orgId,
      rights_holder_id: params.rightsHolderId,
      role: params.role,
    }));

    const { error: assignErr } = await db
      .from("work_assignments")
      .upsert(assignmentsToInsert, { onConflict: "work_id,rights_holder_id,role" });
    if (assignErr) return { success: false, error: assignErr.message };

    finalWorkId = targetEpisodes[0].id;

    if (parentWasCreated) {
      const targetEpisodeIds = targetEpisodes.map(ep => ep.id);
      const { error: detachErr } = await db
        .from("works")
        .update({ parent_work_id: null })
        .in("id", targetEpisodeIds);
      if (detachErr) return { success: false, error: detachErr.message };

      const { error: deleteParentErr } = await db
        .from("works")
        .delete()
        .eq("id", parentWork.id);
      if (deleteParentErr) return { success: false, error: deleteParentErr.message };
    }
  } else {
    // Enkeltværk flow
    let workId = forceManualDuplicate ? null : exactExistingWork?.id ?? null;
    if (!workId) {
      const insertPayload = {
        org_id: orgId,
        status: requiresApproval ? "til_godkendelse" : "godkendt",
        title: enrichedWorkData.title,
        type: enrichedWorkData.type,
        year: enrichedWorkData.year,
        duration_minutes: enrichedWorkData.duration_minutes ?? null,
        episode_count: enrichedWorkData.episode_count ?? null,
        genre: enrichedWorkData.genre ?? null,
        director: enrichedWorkData.director ?? null,
        production_companies: enrichedWorkData.production_companies ?? [],
        description: enrichedWorkData.description ?? null,
        poster_url: enrichedWorkData.poster_url ?? null,
        dfi_id: enrichedWorkData.dfi_id ?? null,
        tmdb_id: enrichedWorkData.tmdb_id ?? null,
        imdb_id: enrichedWorkData.imdb_id ?? null,
        wikidata_id: enrichedWorkData.wikidata_id ?? null,
        dfi_metadata: enrichedWorkData.dfi_metadata ?? null,
      };

      let { data: work, error: workError } = await db
        .from("works")
        .insert(insertPayload)
        .select("id")
        .single();
      if (isMissingOptionalWorkColumn(workError)) {
        const retry = await db.from("works").insert(withoutOptionalWorkColumns(insertPayload)).select("id").single();
        work = retry.data;
        workError = retry.error;
      }
      if (workError || !work) return { success: false, error: workError?.message ?? "Kunne ikke oprette værk." };
      workId = work.id;
    }

    const { error: assignErr } = await db
      .from("work_assignments")
      .upsert(
        { work_id: workId, org_id: orgId, rights_holder_id: params.rightsHolderId, role: params.role },
        { onConflict: "work_id,rights_holder_id,role" }
      );
    if (assignErr) return { success: false, error: assignErr.message };

    finalWorkId = workId;
  }

  if (requiresApproval) {
    const requestId = await createWorkRequest({
      db,
      workId: finalWorkId,
      userId: user.id,
      rightsHolderId: params.rightsHolderId,
      source: "Mine værker - oprettelse",
      proposedData: {
        kind: "creation",
        workData: enrichedWorkData,
        memberRole: params.role,
        coEditors,
        source: params.source,
        overrideLocalMatch: Boolean(params.overrideLocalMatch),
        localMatches: similarWorks,
      },
      comment: params.comment,
    });
    const fresh = await fetchMemberAssignment(db, finalWorkId, params.rightsHolderId);
    revalidatePath("/portal/mine-vaerker");
    revalidatePath("/admin/vaerker");
    return { success: true, pending: true, requestId, workId: finalWorkId, assignment: fresh };
  }

  let coEditorsRequestId: string | null = null;
  if (coEditors.length > 0) {
    coEditorsRequestId = await createWorkRequest({
      db,
      workId: finalWorkId,
      userId: user.id,
      rightsHolderId: params.rightsHolderId,
      source: "Mine værker - medklippere",
      proposedData: {
        kind: "co_editors",
        coEditors,
        source: params.source,
      },
      comment: params.comment,
    });
  } else if (params.comment.trim()) {
    // Ingen godkendelse nødvendig, men brugeren skrev en besked →
    // opret en auto-godkendt besked-request så den vises som pending besked.
    await createWorkRequest({
      db,
      workId: finalWorkId,
      userId: user.id,
      rightsHolderId: params.rightsHolderId,
      source: "Mine værker - besked",
      proposedData: { kind: "message", source: params.source },
      comment: params.comment,
      status: "approved",
    });
  }

  const fresh = await fetchMemberAssignment(db, finalWorkId, params.rightsHolderId);
  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/admin/vaerker");
  return { success: true, workId: finalWorkId, assignment: fresh, coEditorsPending: Boolean(coEditorsRequestId), coEditorsRequestId };
}

export async function addManualWorkAndLinkContract(params: {
  rightsHolderId: string;
  role: string;
  workData: MemberWorkData;
  comment: string;
  coEditors?: ProposedCoEditor[];
  overrideLocalMatch?: boolean;
  contractId?: string | null;
  reuseWorkId?: string | null;
  reusePending?: boolean;
  forceCreateDuplicate?: boolean;
}) {
  let workId = params.reuseWorkId ?? null;
  let pending = params.reuseWorkId ? Boolean(params.reusePending) : false;
  let assignment: unknown = null;

  if (!workId) {
    if (!params.workData.year) {
      return { success: false, error: "Premiereår skal udfyldes.", workId: null, pending: false, retryable: false };
    }
    const duplicateResult = await findManualWorkDuplicates(params.workData.title, params.workData.year);
    if (!duplicateResult.success) {
      return { success: false, error: duplicateResult.error ?? "Kunne ikke kontrollere for eksisterende værker.", workId: null, pending: false, retryable: false };
    }
    const duplicateDecision = manualWorkDuplicateDecision(duplicateResult.matches.length > 0, Boolean(params.forceCreateDuplicate));
    if (duplicateDecision === "block") {
      return {
        success: false,
        error: "Der findes allerede et værk med samme titel og premiereår.",
        duplicate: true,
        matches: duplicateResult.matches,
        workId: null,
        pending: false,
        retryable: false,
      };
    }
    const createResult = await addWorkForMemberWithApproval({
      rightsHolderId: params.rightsHolderId,
      role: params.role,
      workData: params.workData,
      comment: params.comment,
      coEditors: params.coEditors,
      source: "manual",
      overrideLocalMatch: duplicateDecision === "create_pending",
    });
    if (!createResult.success || !createResult.workId) {
      return { success: false, error: createResult.error ?? "Kunne ikke oprette værket.", workId: null, pending: false, retryable: false };
    }
    workId = createResult.workId;
    pending = "pending" in createResult ? Boolean(createResult.pending) : false;
    assignment = createResult.assignment ?? null;
  }

  if (!params.contractId) {
    return { success: true, workId, pending, assignment, retryable: false };
  }

  const db = createServiceClient();
  const { user } = await ensureOwnRightsHolder(db, params.rightsHolderId);
  const orgId = await currentOrgId(db, user.id);

  const [{ data: contract }, { data: work }, { data: ownAssignment }] = await Promise.all([
    db
      .from("contracts")
      .select("id, org_id, work_id")
      .eq("id", params.contractId)
      .eq("rights_holder_id", params.rightsHolderId)
      .maybeSingle(),
    db.from("works").select("id, org_id").eq("id", workId).maybeSingle(),
    db
      .from("work_assignments")
      .select("id")
      .eq("work_id", workId)
      .eq("rights_holder_id", params.rightsHolderId)
      .limit(1)
      .maybeSingle(),
  ]);

  if (!contract) {
    return { success: false, error: "Værket blev oprettet, men kontrakten blev ikke fundet. Prøv at linke igen.", workId, pending, retryable: true };
  }
  if (!work || work.org_id !== orgId || contract.org_id !== orgId || !ownAssignment) {
    console.error("Afvist link efter manuel værksoprettelse", { contractId: params.contractId, workId, orgId });
    return { success: false, error: "Værket blev oprettet, men kunne ikke godkendes til denne kontrakt.", workId, pending, retryable: false };
  }
  if (contract.work_id === workId) {
    return { success: true, workId, pending, assignment, retryable: false };
  }

  const { data: linked, error: linkError } = await db
    .from("contracts")
    .update({ work_id: workId })
    .eq("id", params.contractId)
    .eq("rights_holder_id", params.rightsHolderId)
    .select("id, work_id")
    .maybeSingle();

  if (linkError || linked?.work_id !== workId) {
    console.error("Manuelt værk oprettet, men kontraktlink fejlede", {
      contractId: params.contractId,
      workId,
      error: linkError?.message ?? "Opdateringen returnerede ikke det forventede work_id",
    });
    return {
      success: false,
      error: `Værket blev oprettet, men kontrakten kunne ikke tilknyttes${linkError?.message ? `: ${linkError.message}` : "."}`,
      workId,
      pending,
      retryable: true,
    };
  }

  revalidatePath("/portal/mine-kontrakter");
  return { success: true, workId, pending, assignment, retryable: false };
}

export async function removeWorkAssignment(assignmentId: string, rightsHolderId: string) {
  const db = createServiceClient();
  await ensureOwnRightsHolder(db, rightsHolderId);

  // Hent work_id for denne work_assignment
  const { data: assignment, error: assignError } = await db
    .from("work_assignments")
    .select("work_id")
    .eq("id", assignmentId)
    .eq("rights_holder_id", rightsHolderId)
    .maybeSingle();

  if (assignError || !assignment) throw new Error("Kreditering ikke fundet.");

  // Tjek om der er tilknyttede kontrakter
  const { data: contracts, error: contractsError } = await db
    .from("contracts")
    .select("id")
    .eq("work_id", assignment.work_id)
    .eq("rights_holder_id", rightsHolderId)
    .limit(1);

  if (contractsError) throw new Error(contractsError.message);
  if (contracts && contracts.length > 0) {
    throw new Error("Du kan ikke fjerne dette værk, da du har en eller flere tilknyttede kontrakter på det. Slet eller omlink kontrakterne først.");
  }

  const { error: deleteError } = await db
    .from("work_assignments")
    .delete()
    .eq("id", assignmentId)
    .eq("rights_holder_id", rightsHolderId);

  if (deleteError) throw new Error(deleteError.message);
  return { success: true };
}

export async function removeWorkAssignments(assignmentIds: string[], rightsHolderId: string) {
  const db = createServiceClient();
  await ensureOwnRightsHolder(db, rightsHolderId);
  const deletedIds: string[] = [];
  const errors: string[] = [];

  for (const id of assignmentIds) {
    try {
      const { data: assignment } = await db
        .from("work_assignments")
        .select("work_id, works(title)")
        .eq("id", id)
        .eq("rights_holder_id", rightsHolderId)
        .maybeSingle();

      if (!assignment) continue;

      const { data: contracts } = await db
        .from("contracts")
        .select("id")
        .eq("work_id", assignment.work_id)
        .eq("rights_holder_id", rightsHolderId)
        .limit(1);

      const workRelation = (assignment as { works?: { title?: string } | { title?: string }[] | null }).works;
      const workTitle = Array.isArray(workRelation) ? workRelation[0]?.title : workRelation?.title;

      if (contracts && contracts.length > 0) {
        const title = workTitle;
        errors.push(`"${title || "Værket"}" har tilknyttede kontrakter.`);
        continue;
      }

      const { error } = await db
        .from("work_assignments")
        .delete()
        .eq("id", id)
        .eq("rights_holder_id", rightsHolderId);

      if (error) {
        const title = workTitle;
        errors.push(`Fejl ved sletning af ${title || "værk"}: ${error.message}`);
      } else {
        deletedIds.push(id);
      }
    } catch (e: unknown) {
      errors.push(e instanceof Error ? e.message : "Ukendt fejl");
    }
  }

  return { success: errors.length === 0, deletedIds, errors };
}

export async function ensureWorkPosterFromTMDB(params: {
  workId: string;
  title: string;
  year: number | null;
}) {
  const db = createServiceClient();
  const user = await currentUser();
  const orgId = await currentOrgId(db, user.id);
  const { data: work } = await db
    .from("works")
    .select("id, org_id, poster_url")
    .eq("id", params.workId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (!work || work.poster_url) return { success: true, poster_url: work?.poster_url ?? null };

  const posterUrl = await findTMDBPoster(params.title, params.year);
  if (!posterUrl) return { success: true, poster_url: null };

  const { error } = await db
    .from("works")
    .update({ poster_url: posterUrl })
    .eq("id", params.workId)
    .is("poster_url", null);

  if (error) return { success: false, error: error.message };
  return { success: true, poster_url: posterUrl };
}

export async function linkApprovedCoEditorSuggestionsForRightsHolder(params: {
  rightsHolderId: string;
  fullName: string;
}) {
  const db = createServiceClient();
  const { user } = await ensureOwnRightsHolder(db, params.rightsHolderId);
  const orgId = await currentOrgId(db, user.id);
  const normalizedName = normalizeTitle(params.fullName);
  if (!normalizedName) return { success: true, linked: 0 };

  const { data: requests } = await db
    .from("work_change_requests")
    .select("id, work_id, proposed_data")
    .eq("org_id", orgId)
    .eq("status", "approved");

  let linked = 0;
  for (const request of requests ?? []) {
    const proposed = request.proposed_data as { coEditors?: ProposedCoEditor[] } | null;
    for (const editor of proposed?.coEditors ?? []) {
      if (normalizeTitle(editor.name) !== normalizedName) continue;
      const { error } = await db
        .from("work_assignments")
        .upsert(
          { work_id: request.work_id, org_id: orgId, rights_holder_id: params.rightsHolderId, role: editor.role || "Klipper" },
          { onConflict: "work_id,rights_holder_id,role" }
        );
      if (!error) linked++;
    }
  }

  if (linked) revalidatePath("/portal/mine-vaerker");
  return { success: true, linked };
}

export type UnifiedSearchWorkResult = {
  id: string;
  title: string;
  year: number | null;
  type: string;
  description: string | null;
  poster_url: string | null;
  director: string | null;
  genre: string | null;
  duration_minutes: number | null;
  local_id?: string | null;
  dfi_id?: string | null;
  tmdb_id?: number | null;
  imdb_id?: string | null;
  wikidata_id?: string | null;
  season_hint?: number | null;
  sources: ("local" | "dfi" | "tmdb")[];
  raw_local?: any;
  raw_dfi?: any;
  raw_tmdb?: any;
};

export async function searchWorksUnified(query: string, options: { preferLocalOnly?: boolean } = {}) {
  const q = query.trim();
  if (!q) return { success: true, results: [] };

  const db = createServiceClient();
  const user = await currentUser();
  const orgId = await currentOrgId(db, user.id);

  let localWorks: any[] = [];
  try {
    let { data, error } = await db.from("works")
      .select("id, title, type, year, duration_minutes, season_count, episode_count, season_number, episode_number, genre, director, production_companies, status, dfi_id, tmdb_id, imdb_id, wikidata_id, poster_url, description, parent_work_id")
      .eq("org_id", orgId)
      .ilike("title", `%${q}%`)
      .limit(15);
    if (isMissingOptionalWorkColumn(error)) {
      const retry = await db.from("works")
        .select("id, title, type, year, duration_minutes, season_count, episode_count, season_number, episode_number, genre, director, production_companies, status, dfi_id, tmdb_id, poster_url, description, parent_work_id")
        .eq("org_id", orgId)
        .ilike("title", `%${q}%`)
        .limit(15);
      data = (retry.data ?? []).map(work => ({ ...work, imdb_id: null, wikidata_id: null }));
      error = retry.error;
    }
    if (error) throw error;
    if (data) localWorks = data;
  } catch (e) {
    console.error("Local search error in searchWorksUnified:", e);
  }

  try {
    const localById = new Map(localWorks.map(work => [work.id, work]));
    const parentIds = Array.from(new Set(localWorks.map(work => work.parent_work_id).filter(Boolean)));
    if (parentIds.length > 0) {
      const [{ data: parents }, { data: children }] = await Promise.all([
        db.from("works")
          .select("id, title, type, year, duration_minutes, season_count, episode_count, season_number, episode_number, genre, director, production_companies, status, dfi_id, tmdb_id, imdb_id, wikidata_id, poster_url, description, parent_work_id")
          .in("id", parentIds),
        db.from("works")
          .select("id, title, type, year, season_number, episode_number, parent_work_id")
          .in("parent_work_id", parentIds)
          .order("season_number", { ascending: true })
          .order("episode_number", { ascending: true }),
      ]);
      const childrenByParent = new Map<string, any[]>();
      for (const child of children ?? []) {
        const rows = childrenByParent.get(child.parent_work_id) ?? [];
        rows.push(child);
        childrenByParent.set(child.parent_work_id, rows);
      }
      for (const parent of parents ?? []) {
        localById.set(parent.id, { ...parent, __local_children: childrenByParent.get(parent.id) ?? [] });
      }
      for (const work of localWorks) {
        if (work.parent_work_id) localById.delete(work.id);
      }
    }

    const parentsByTitle = new Map<string, any>();
    for (const work of localById.values()) {
      if (!work.parent_work_id && isSeriesType(work.type)) parentsByTitle.set(normalizeTitle(cleanDfiTitle(work.title)), work);
    }
    for (const work of Array.from(localById.values())) {
      const parsed = parseLocalEpisodeCode(work.title);
      if (!parsed?.baseTitle) continue;
      const parent = parentsByTitle.get(normalizeTitle(cleanDfiTitle(parsed.baseTitle)));
      if (!parent) continue;
      localById.delete(work.id);
      const children = Array.isArray(parent.__local_children) ? parent.__local_children : [];
      parent.__local_children = [...children, { ...work, season_number: work.season_number ?? parsed.seasonNumber, episode_number: work.episode_number ?? parsed.episodeNumber }];
      localById.set(parent.id, parent);
    }
    localWorks = Array.from(localById.values());
  } catch (e) {
    console.error("Local series grouping error in searchWorksUnified:", e);
  }

  const results: UnifiedSearchWorkResult[] = [];
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const querySeasonHint = parseSeasonNumberFromTitle(q);

  // 1. Add Local works (parents only)
  localWorks.forEach(w => {
    if (w.parent_work_id) return;
    results.push({
      id: `local-${w.id}`,
      title: w.title,
      year: w.year,
      type: w.type,
      description: w.description ?? null,
      poster_url: w.poster_url ?? null,
      director: w.director ?? null,
      genre: w.genre ?? null,
      duration_minutes: w.duration_minutes ?? null,
      local_id: w.id,
      dfi_id: w.dfi_id ? String(w.dfi_id) : null,
      tmdb_id: w.tmdb_id ? Number(w.tmdb_id) : null,
      imdb_id: w.imdb_id ?? null,
      wikidata_id: w.wikidata_id ?? null,
      season_hint: w.season_number ?? parseSeasonNumberFromTitle(w.title) ?? querySeasonHint,
      sources: ["local"],
      raw_local: w,
    });
  });

  if (options.preferLocalOnly && results.length > 0) {
    results.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    return { success: true, results };
  }

  // Fetch in parallel: DFI, TMDB
  const [dfiRes, tmdbRes] = await Promise.all([
    searchDFIFilms(q).catch(() => ({ success: false, results: [] })),
    searchTMDB(q).catch(() => []),
  ]);

  const dfiFilms = await normalizeDfiSeriesResults((dfiRes.success ? dfiRes.results ?? [] : []) as any[]);
  const tmdbItems = (Array.isArray(tmdbRes) ? tmdbRes : []) as any[];

  // 2. Merge DFI results
  dfiFilms.forEach((film: any) => {
    const isChild = film.Parent && film.Parent.Id;
    if (isChild) return; // Skip child episodes, we always select parent series!

    const title = cleanDfiTitle(film.Title || film.DanishTitle || "Ukendt");
    const year = extractDfiPremiereYear(film);
    const dfiId = String(film.Id);
    const mappedType = mapDfiWorkType(film.Category, film.Type);
    const director = extractDfiDirectors(film).join(", ") || null;
    const seasonHint = parseSeasonNumberFromTitle(title) ?? querySeasonHint;

    const existingIndex = results.findIndex(r => {
      if (r.dfi_id && r.dfi_id === dfiId) return true;
      if (normalize(r.title) === normalize(title) && r.year && year && Math.abs(r.year - year) <= 1) return true;
      return false;
    });

    if (existingIndex !== -1) {
      const match = results[existingIndex];
      if (!match.sources.includes("dfi")) match.sources.push("dfi");
      if (!match.dfi_id) match.dfi_id = dfiId;
      if (!match.raw_dfi) match.raw_dfi = film;
      if (!match.director && director) match.director = director;
      if (!match.poster_url) match.poster_url = extractDfiPosterUrl(film);
      if (!match.season_hint) match.season_hint = seasonHint;
    } else {
      results.push({
        id: `dfi-${dfiId}`,
        title,
        year,
        type: mappedType,
        description: film.Synopsis || film.ShortSynopsis || null,
        poster_url: extractDfiPosterUrl(film) ?? null,
        director,
        genre: typeof film.Genre === "string" ? film.Genre : typeof film.Category === "string" ? film.Category : null,
        duration_minutes: typeof film.Duration === "number" ? film.Duration : null,
        dfi_id: dfiId,
        season_hint: seasonHint,
        sources: ["dfi"],
        raw_dfi: film,
      });
    }
  });

  // 3. Merge TMDB results
  tmdbItems.forEach((item: any) => {
    const title = item.title || item.name || "Ukendt";
    const releaseDate = item.release_date || item.first_air_date || "";
    const year = Number.parseInt(releaseDate.substring(0, 4), 10) || null;
    const tmdbId = Number(item.id);
    const type = item.media_type === "tv" ? "tv-serie" : "spillefilm";

    const existingIndex = results.findIndex(r => {
      if (r.tmdb_id && r.tmdb_id === tmdbId) return true;
      if (normalize(r.title) === normalize(title) && r.year && year && Math.abs(r.year - year) <= 1) return true;
      return false;
    });

    if (existingIndex !== -1) {
      const match = results[existingIndex];
      if (!match.sources.includes("tmdb")) match.sources.push("tmdb");
      if (!match.tmdb_id) match.tmdb_id = tmdbId;
      if (!match.raw_tmdb) match.raw_tmdb = item;
      if (!match.poster_url && item.poster_path) match.poster_url = `https://image.tmdb.org/t/p/w185${item.poster_path}`;
      if (!match.season_hint) match.season_hint = parseSeasonNumberFromTitle(title) ?? querySeasonHint;
    } else {
      results.push({
        id: `tmdb-${tmdbId}`,
        title,
        year,
        type,
        description: item.overview || null,
        poster_url: item.poster_path ? `https://image.tmdb.org/t/p/w185${item.poster_path}` : null,
        director: null,
        genre: null,
        duration_minutes: null,
        tmdb_id: tmdbId,
        season_hint: parseSeasonNumberFromTitle(title) ?? querySeasonHint,
        sources: ["tmdb"],
        raw_tmdb: item,
      });
    }
  });

  results.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  return { success: true, results };
}

export async function searchRightsHoldersForMember(query: string) {
  const q = query.trim();
  if (q.length === 1) return { success: true, results: [] };
  const db = createServiceClient();
  const user = await currentUser();
  const orgId = await currentOrgId(db, user.id);
  let lookup = db
    .from("rettighedshavere")
    .select("id, full_name")
    .eq("org_id", orgId)
    .order("full_name")
    .limit(8);
  if (q) lookup = lookup.ilike("full_name", `%${q}%`);
  const { data, error } = await lookup;
  if (error) return { success: false, error: error.message, results: [] };
  return { success: true, results: data ?? [] };
}

export async function fetchMemberSeriesEpisodeOptions(params: {
  rightsHolderId: string;
  workId: string;
}) {
  const db = createServiceClient();
  const { user } = await ensureOwnRightsHolder(db, params.rightsHolderId);
  const orgId = await currentOrgId(db, user.id);
  const { data: current } = await db
    .from("works")
    .select("id,parent_work_id,season_number,episode_number,type")
    .eq("id", params.workId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!current) return { success: false, error: "Værket findes ikke.", options: [] };

  const parentId = current.parent_work_id ?? current.id;
  const seasonNumber = current.season_number ?? 1;
  const { data: parentWork } = await db
    .from("works")
    .select("*")
    .eq("id", parentId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!parentWork) return { success: false, error: "Serien findes ikke.", options: [] };

  const { data: localChildren } = await db
    .from("works")
    .select("id,title,season_number,episode_number,parent_work_id")
    .eq("org_id", orgId)
    .eq("parent_work_id", parentId)
    .eq("season_number", seasonNumber)
    .order("episode_number", { ascending: true });

  const external = await resolveExternalSeriesEpisodesForTitle({
    title: parentWork.title,
    year: parentWork.year,
    dfiId: parentWork.dfi_id ? String(parentWork.dfi_id) : null,
    tmdbId: parentWork.tmdb_id ? Number(parentWork.tmdb_id) : null,
    seasonNumber,
  });
  const episodeCount = Math.max(
    Number(parentWork.episode_count ?? 0) || 0,
    external.episodeCount ?? 0,
    ...(localChildren ?? []).map(child => Number(child.episode_number ?? 0))
  );
  const options = buildCompleteEpisodeOptions({
    episodeCount,
    externalOptions: external.episodeOptions,
    localChildren,
    seasonNumber,
  });

  return { success: true, options, episodeCount, seasonNumber };
}

export async function syncMemberEpisodeAssignments(params: {
  rightsHolderId: string;
  workId: string;
  role: string;
  selectedEpisodes: number[];
}) {
  const db = createServiceClient();
  const { user } = await ensureOwnRightsHolder(db, params.rightsHolderId);
  const orgId = await currentOrgId(db, user.id);
  const { data: current } = await db.from("works")
    .select("id,parent_work_id,season_number,episode_number,type")
    .eq("id", params.workId).eq("org_id", orgId).single();
  if (!current) return { success: false, error: "Værket findes ikke." };
  const parentId = current.parent_work_id ?? current.id;
  const seasonNumber = current.season_number ?? 1;
  const selected = new Set(params.selectedEpisodes.filter(Number.isFinite));

  const { data: parentWork } = await db
    .from("works")
    .select("*")
    .eq("id", parentId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!parentWork) return { success: false, error: "Serien findes ikke." };

  const externalEpisodes = await resolveExternalSeriesEpisodesForTitle({
    title: parentWork.title,
    year: parentWork.year,
    dfiId: parentWork.dfi_id ? String(parentWork.dfi_id) : null,
    tmdbId: parentWork.tmdb_id ? Number(parentWork.tmdb_id) : null,
    seasonNumber,
  });
  const requiredEpisodeCount = Math.max(
    Number(parentWork.episode_count ?? 0) || 0,
    externalEpisodes.episodeCount ?? 0,
    params.selectedEpisodes.reduce((max, number) => Math.max(max, number), 0)
  );
  if (requiredEpisodeCount > 0) {
    await generateEpisodesForSeries({
      parentWork: {
        ...parentWork,
        tmdb_id: externalEpisodes.tmdbId ?? parentWork.tmdb_id,
        dfi_metadata: externalEpisodes.dfiMetadata ?? parentWork.dfi_metadata,
        episode_count: requiredEpisodeCount,
      } as DbWork,
      seasonNumber,
      totalEpisodes: requiredEpisodeCount,
    });
  }

  const { data: episodes, error } = await db.from("works")
    .select("id,episode_number")
    .eq("org_id", orgId).eq("parent_work_id", parentId).eq("season_number", seasonNumber)
    .not("episode_number", "is", null);
  if (error) return { success: false, error: error.message };
  const episodeIds = (episodes ?? []).map(episode => episode.id);
  const { data: existing } = episodeIds.length ? await db.from("work_assignments")
    .select("id,work_id").eq("org_id", orgId).eq("rights_holder_id", params.rightsHolderId).in("work_id", episodeIds) : { data: [] };
  const existingByWork = new Map((existing ?? []).map(item => [item.work_id, item.id]));
  const toAdd = (episodes ?? []).filter(episode => selected.has(episode.episode_number) && !existingByWork.has(episode.id));
  const toRemove = (episodes ?? []).filter(episode => !selected.has(episode.episode_number) && existingByWork.has(episode.id));
  const blocked: number[] = [];
  for (const episode of toRemove) {
    const [{ count: contractCount }, { count: claimCount }] = await Promise.all([
      db.from("contracts").select("id", { count: "exact", head: true }).eq("work_id", episode.id),
      db.from("screening_claims").select("id", { count: "exact", head: true }).eq("work_id", episode.id).eq("profile_id", user.id).eq("status", "approved"),
    ]);
    if ((contractCount ?? 0) > 0 || (claimCount ?? 0) > 0) blocked.push(episode.episode_number);
  }
  if (blocked.length) return { success: false, error: `Afsnit ${blocked.join(", ")} kan ikke fjernes, fordi det er knyttet til en kontrakt eller godkendt visning.`, blocked };
  if (toAdd.length) {
    const { error: addError } = await db.from("work_assignments").upsert(toAdd.map(episode => ({ org_id: orgId, work_id: episode.id, rights_holder_id: params.rightsHolderId, role: params.role })), { onConflict: "work_id,rights_holder_id,role" });
    if (addError) return { success: false, error: addError.message };
  }
  const removeIds = toRemove.map(episode => existingByWork.get(episode.id)).filter(Boolean) as string[];
  if (removeIds.length) {
    const { error: removeError } = await db.from("work_assignments").delete().in("id", removeIds);
    if (removeError) return { success: false, error: removeError.message };
  }
  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/admin/vaerker");
  return { success: true, added: toAdd.map(item => item.episode_number), removed: toRemove.map(item => item.episode_number), unchanged: params.selectedEpisodes.length - toAdd.length };
}

export async function updateMemberCoEditors(params: {
  workId: string;
  changes: Array<{ assignmentId?: string | null; rightsHolderId?: string | null; role: string; action?: "add" | "remove" | "change" }>;
}) {
  const db = createServiceClient();
  const user = await currentUser();
  const orgId = await currentOrgId(db, user.id);
  const { data: ownHolder } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).eq("org_id", orgId).maybeSingle();
  if (!ownHolder) return { success: false, error: "Rettighedshaveren findes ikke." };
  const { data: ownAssignment } = await db.from("work_assignments").select("id").eq("work_id", params.workId).eq("rights_holder_id", ownHolder.id).maybeSingle();
  if (!ownAssignment) return { success: false, error: "Du kan kun redigere medklippere på dine egne værker." };
  for (const change of params.changes) {
    if (change.action === "remove" && change.assignmentId) {
      const { error } = await db.from("work_assignments").delete().eq("id", change.assignmentId).eq("work_id", params.workId).eq("org_id", orgId);
      if (error) return { success: false, error: error.message };
    } else if (change.action === "change" && change.assignmentId && change.rightsHolderId) {
      const { error } = await db.from("work_assignments").update({ rights_holder_id: change.rightsHolderId, role: change.role }).eq("id", change.assignmentId).eq("work_id", params.workId).eq("org_id", orgId);
      if (error) return { success: false, error: error.message };
    } else if (change.action === "add" && change.rightsHolderId) {
      const { error } = await db.from("work_assignments").upsert({ org_id: orgId, work_id: params.workId, rights_holder_id: change.rightsHolderId, role: change.role }, { onConflict: "work_id,rights_holder_id,role" });
      if (error) return { success: false, error: error.message };
    }
  }
  revalidatePath("/portal/mine-vaerker");
  return { success: true };
}

export async function resolveUnifiedSearchResultDetails(result: UnifiedSearchWorkResult) {
  let dfiMetadata: DfiMetadata | null = null;
  let tmdbId = result.tmdb_id ?? null;
  let imdbId = result.imdb_id ?? null;
  let wikidataId = result.wikidata_id ?? null;
  let director = result.director ?? null;
  let genre = result.genre ?? null;
  let duration = result.duration_minutes ?? null;
  let description = result.description ?? null;
  let posterUrl = result.poster_url ?? null;
  let type = result.type;
  let episodeCount: number | null = null;
  let seasonCount: number | null = null;
  let alternativeTitles: string[] = [];
  let productionCountries: string[] = [];
  let productionCompanies: string[] = [];
  let episodeOptions: { number: number; title: string; dfiId?: string | null }[] = [];
  let localChildren: any[] = Array.isArray(result.raw_local?.__local_children) ? result.raw_local.__local_children : [];
  const detailSeasonNumber = result.season_hint ?? parseSeasonNumberFromTitle(result.title) ?? 1;

  if (result.local_id && isSeriesType(result.type)) {
    try {
      const { data: children } = await createServiceClient()
        .from("works")
        .select("id, title, season_number, episode_number, parent_work_id")
        .eq("parent_work_id", result.local_id)
        .order("season_number", { ascending: true })
        .order("episode_number", { ascending: true });
      if (children?.length) localChildren = children;
      episodeCount = Number(result.raw_local?.episode_count ?? 0) || episodeCount;
      seasonCount = Number(result.raw_local?.season_count ?? 0) || seasonCount;
    } catch (e) {
      console.error("Local episode lookup error in resolveUnifiedSearchResultDetails:", e);
    }
  }

  // 1. Fetch DFI details if DFI ID is present
  if (result.dfi_id) {
    try {
      const det = await getDFIFilmDetails(Number(result.dfi_id));
      if (det.success && det.film) {
        const meta = det.film as DfiMetadata;
        dfiMetadata = meta;
        const syn = typeof meta.Synopsis === "string" ? meta.Synopsis : null;
        const shortSyn = typeof meta.ShortSynopsis === "string" ? meta.ShortSynopsis : null;
        description = syn || shortSyn || description;
        director = extractDfiDirectors(meta).join(", ") || director;
        genre = typeof meta.Genre === "string" ? meta.Genre : genre;
        duration = typeof meta.Duration === "number" ? meta.Duration : duration;
        posterUrl = det.posterDataUrl ?? extractDfiPosterUrl(meta) ?? posterUrl;
        type = mapDfiWorkType(meta.Category, meta.Type);
        const toTextList = (value: unknown) => (Array.isArray(value) ? value : value == null ? [] : [value]).flatMap(item => typeof item === "string" ? [item.trim()] : item && typeof item === "object" ? [String((item as Record<string, unknown>).Name ?? (item as Record<string, unknown>).Title ?? "").trim()] : []).filter(Boolean);
        alternativeTitles = Array.from(new Set([...toTextList(meta.AltTitle), ...toTextList(meta.ForeignTitles)]));
        productionCountries = toTextList(meta.ProductionCountries);
        productionCompanies = toTextList(meta.ProductionCompanies);

        // Fetch DFI episodes count
        const comment = (dfiMetadata as any).Comment || (dfiMetadata as any).Synopsis || "";
        const epMatch = comment.match(/(\d+)\s+afsnit/i);
        if (epMatch) {
          episodeCount = parseInt(epMatch[1]);
        }

        const precomputedOptions = Array.isArray((result.raw_dfi as any)?.__episode_options)
          ? (result.raw_dfi as any).__episode_options
          : Array.isArray((dfiMetadata as any).__episode_options) ? (dfiMetadata as any).__episode_options : [];
        const children = Array.isArray((dfiMetadata as any).Children) ? (dfiMetadata as any).Children : [];
        const episodeChildren = children.filter((child: any) => Boolean(parseDfiEpisodeTitleInfo(child.Title ?? "")));
        if (precomputedOptions.length > 0) {
          episodeOptions = precomputedOptions;
          episodeCount = Math.max(episodeCount ?? 0, ...precomputedOptions.map((option: { number?: number }) => Number(option.number ?? 0)));
        } else if (episodeChildren.length > 0) {
            episodeOptions = episodeChildren.map((c: any, idx: number) => {
              const parsed = parseDfiEpisodeTitleInfo(c.Title ?? "");
              const num = parsed?.episodeNumber ?? idx + 1;
              episodeCount = Math.max(episodeCount ?? 0, parsed?.totalEpisodes ?? num);
              const subtitle = parsed?.subtitle || c.Title || `Afsnit ${num}`;
              return {
                number: num,
                title: subtitle,
                dfiId: c.Id ? String(c.Id) : null,
              };
            }).filter((opt: any) => opt.number > 0);
            episodeOptions.sort((a, b) => a.number - b.number);
        }
      }
    } catch (e) {
      console.error("DFI lookup error in resolveUnifiedSearchResultDetails:", e);
    }
  }

  // 2. Fetch TMDB match and external IDs if TMDB ID is missing
  if (result.dfi_id && !tmdbId) {
    try {
      const match = await findTMDBMatch(result.title, result.year);
      if (match.tmdb_id) {
        tmdbId = match.tmdb_id;
        if (!posterUrl && match.poster_url) posterUrl = match.poster_url;
      }
    } catch (e) {
      console.error("TMDB match lookup error in resolveUnifiedSearchResultDetails:", e);
    }
  }

  if (tmdbId) {
    try {
      const isSeries = type === "tv-serie" || type === "dokumentar-serie";
      const externalIds = await getTMDBExternalIds(tmdbId, isSeries ? "tv" : "movie");
      imdbId = imdbId ?? externalIds.imdb_id;
      wikidataId = wikidataId ?? externalIds.wikidata_id;

      if (isSeries) {
        const tmdbDet = await getTMDBWorkDetails(tmdbId, "tv");
        if (tmdbDet.success && tmdbDet.details) {
          const tDetails = tmdbDet.details as any;
          const season = Array.isArray(tDetails.seasons)
            ? tDetails.seasons.find((item: any) => item.season_number === detailSeasonNumber)
            : null;
          seasonCount = Number(tDetails.number_of_seasons ?? 0) || seasonCount;
          productionCountries = productionCountries.length ? productionCountries : (tDetails.production_countries ?? []).map((item: any) => String(item.name ?? "")).filter(Boolean);
          productionCompanies = productionCompanies.length ? productionCompanies : (tDetails.production_companies ?? []).map((item: any) => String(item.name ?? "")).filter(Boolean);
          if (season?.episode_count && (!episodeCount || season.episode_count > episodeCount)) {
            episodeCount = season.episode_count;
          }
        }
      }
    } catch (e) {
      console.error("TMDB external IDs lookup error in resolveUnifiedSearchResultDetails:", e);
    }
  }

  const needsExternalEpisodeSupplement =
    isSeriesType(type) &&
    (
      !episodeCount ||
      episodeCount <= localChildren.length ||
      episodeOptions.length <= localChildren.length
    );

  if (needsExternalEpisodeSupplement) {
    const externalEpisodes = await resolveExternalSeriesEpisodesForTitle({
      title: result.title,
      year: result.year,
      dfiId: result.dfi_id,
      tmdbId,
      seasonNumber: detailSeasonNumber,
    });
    if (externalEpisodes.dfiMetadata && !dfiMetadata) dfiMetadata = externalEpisodes.dfiMetadata;
    if (externalEpisodes.tmdbId && !tmdbId) tmdbId = externalEpisodes.tmdbId;
    if (externalEpisodes.episodeOptions.length > episodeOptions.length) {
      episodeOptions = externalEpisodes.episodeOptions;
    }
    if (externalEpisodes.episodeCount && externalEpisodes.episodeCount > (episodeCount ?? 0)) {
      episodeCount = externalEpisodes.episodeCount;
    }
  }

  // 3. Enrich from Wikidata
  try {
    const wiki = await enrichFromWikidata({ imdbId, title: result.title, year: result.year });
    imdbId = imdbId ?? wiki.imdb_id;
    wikidataId = wikidataId ?? wiki.wikidata_id;
    director = director ?? wiki.director;
    genre = genre ?? wiki.genre;
    duration = duration ?? wiki.duration_minutes;
  } catch (e) {
    console.error("Wikidata enrichment error in resolveUnifiedSearchResultDetails:", e);
  }

  episodeOptions = buildCompleteEpisodeOptions({
    episodeCount,
    externalOptions: episodeOptions,
    localChildren,
    seasonNumber: detailSeasonNumber,
  }) as { number: number; title: string; dfiId?: string | null }[];

  return {
    success: true,
    details: {
      title: result.title,
      year: result.year,
      type,
      description,
      poster_url: posterUrl,
      director,
      genre,
      duration_minutes: duration,
      dfi_id: result.dfi_id ?? null,
      tmdb_id: tmdbId,
      imdb_id: imdbId,
      wikidata_id: wikidataId,
      dfi_metadata: dfiMetadata,
      episode_count: episodeCount,
      season_count: seasonCount,
      alternative_titles: alternativeTitles,
      production_countries: productionCountries,
      production_companies: productionCompanies,
      episode_options: episodeOptions,
      season_hint: result.season_hint ?? parseSeasonNumberFromTitle(result.title),
    }
  };
}
