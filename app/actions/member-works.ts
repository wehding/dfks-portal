"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { findTMDBPoster, findTMDBMatch, getTMDBExternalIds, searchTMDB, getTMDBWorkDetails } from "@/app/actions/tmdb";
import { enrichFromWikidata } from "@/app/actions/wikidata";
import { getDFIFilmDetails, searchDFIFilms } from "@/app/actions/dfi";
import { extractDfiPosterUrl, extractDfiDirectors, extractDfiPremiereYear, mapDfiWorkType, parseDfiEpisodeTitleInfo, type DfiMetadata } from "@/lib/dfi-metadata";
import { generateEpisodesForSeries } from "@/app/actions/series-generator";
import type { DbWork } from "@/lib/db/types";

const DFKS_ORG_ID = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";

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

async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Du skal være logget ind.");
  return data.user;
}

async function currentOrgId(db: ReturnType<typeof createServiceClient>, userId: string): Promise<string> {
  const { data } = await db
    .from("user_org_roles")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return data?.org_id ?? DFKS_ORG_ID;
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
    .select("id, role, contract_id, episode_id, created_at, episodes(episode_number,title), works(id, title, type, year, duration_minutes, season_count, episode_count, genre, director, status, dfi_id, tmdb_id, poster_url, description, work_change_requests(*, work_change_request_comments(*)))")
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
  const user = await currentUser();
  const db = createServiceClient();
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
    .select("id, role, contract_id, episode_id, created_at, episodes(episode_number,title), works(id, title, type, year, duration_minutes, season_count, episode_count, genre, director, status, dfi_id, tmdb_id, poster_url, description)")
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
    .select("id, title, type, year, duration_minutes, season_count, episode_count, season_number, episode_number, genre, director, status, dfi_id, tmdb_id, poster_url, description, work_assignments(id, role, rights_holder_id, rettighedshavere(id, full_name))")
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

    const genRes = await generateEpisodesForSeries({
      parentWork: work as unknown as DbWork,
      seasonNumber: params.seasonNumber,
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
    return { success: true, pending: true, requestId, assignment: fresh };
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

  return { success: true, assignment: fresh };
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
    const sameTitle = normalizeTitle(work.title) === normalizeTitle(params.workData.title);
    const sameYear = params.workData.year && work.year ? work.year === params.workData.year : true;
    return sameTitle && sameYear;
  }) ?? null;
  const coEditors = normalizeCoEditors(params.coEditors);
  // Godkendelse kræves KUN når værket allerede findes i databasen (dublet-tilføjelse
  // via DFI/TMDB/manuelt). Helt nye, umatchede værker godkendes automatisk.
  const requiresApproval = similarWorks.length > 0;
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
    if (enrichedWorkData.dfi_id) {
      const { data } = await db.from("works").select("*").eq("dfi_id", enrichedWorkData.dfi_id).eq("org_id", orgId).is("parent_work_id", null).maybeSingle();
      parentWork = data;
    } else if (enrichedWorkData.tmdb_id) {
      const { data } = await db.from("works").select("*").eq("tmdb_id", enrichedWorkData.tmdb_id).eq("org_id", orgId).is("parent_work_id", null).maybeSingle();
      parentWork = data;
    } else {
      const { data } = await db.from("works").select("*").eq("title", enrichedWorkData.title).eq("org_id", orgId).is("parent_work_id", null).maybeSingle();
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
        description: enrichedWorkData.description ?? null,
        poster_url: enrichedWorkData.poster_url ?? null,
        dfi_id: enrichedWorkData.dfi_id ?? null,
        tmdb_id: enrichedWorkData.tmdb_id ?? null,
        imdb_id: enrichedWorkData.imdb_id ?? null,
        wikidata_id: enrichedWorkData.wikidata_id ?? null,
        dfi_metadata: enrichedWorkData.dfi_metadata ?? null,
      };

      const { data, error: parentError } = await db
        .from("works")
        .insert(parentPayload)
        .select("*")
        .single();
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
    let workId = exactExistingWork?.id ?? null;
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
        description: enrichedWorkData.description ?? null,
        poster_url: enrichedWorkData.poster_url ?? null,
        dfi_id: enrichedWorkData.dfi_id ?? null,
        tmdb_id: enrichedWorkData.tmdb_id ?? null,
        imdb_id: enrichedWorkData.imdb_id ?? null,
        wikidata_id: enrichedWorkData.wikidata_id ?? null,
        dfi_metadata: enrichedWorkData.dfi_metadata ?? null,
      };

      const { data: work, error: workError } = await db
        .from("works")
        .insert(insertPayload)
        .select("id")
        .single();
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
  return { success: true, assignment: fresh, coEditorsPending: Boolean(coEditorsRequestId), coEditorsRequestId };
}

export async function removeWorkAssignment(assignmentId: string, rightsHolderId: string) {
  const db = createServiceClient();

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
  const { data: work } = await db
    .from("works")
    .select("id, poster_url")
    .eq("id", params.workId)
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
  sources: ("local" | "dfi" | "tmdb")[];
  raw_local?: any;
  raw_dfi?: any;
  raw_tmdb?: any;
};

export async function searchWorksUnified(query: string) {
  const q = query.trim();
  if (!q) return { success: true, results: [] };

  const db = createServiceClient();
  const user = await currentUser();
  const orgId = await currentOrgId(db, user.id);

  let localWorks: any[] = [];
  try {
    const { data } = await db.from("works")
      .select("id, title, type, year, duration_minutes, season_count, episode_count, season_number, episode_number, genre, director, status, dfi_id, tmdb_id, poster_url, description, parent_work_id")
      .eq("org_id", orgId)
      .ilike("title", `%${q}%`)
      .limit(15);
    if (data) localWorks = data;
  } catch (e) {
    console.error("Local search error in searchWorksUnified:", e);
  }

  // Fetch in parallel: DFI, TMDB
  const [dfiRes, tmdbRes] = await Promise.all([
    searchDFIFilms(q).catch(() => ({ success: false, results: [] })),
    searchTMDB(q).catch(() => []),
  ]);

  const dfiFilms = (dfiRes.success ? dfiRes.results ?? [] : []) as any[];
  const tmdbItems = (Array.isArray(tmdbRes) ? tmdbRes : []) as any[];

  const results: UnifiedSearchWorkResult[] = [];
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

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
      sources: ["local"],
      raw_local: w,
    });
  });

  // 2. Merge DFI results
  dfiFilms.forEach((film: any) => {
    const isChild = film.Parent && film.Parent.Id;
    if (isChild) return; // Skip child episodes, we always select parent series!

    const title = film.Title || film.DanishTitle || "Ukendt";
    const year = extractDfiPremiereYear(film);
    const dfiId = String(film.Id);
    const mappedType = mapDfiWorkType(film.Category, film.Type);
    const director = extractDfiDirectors(film).join(", ") || null;

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
        sources: ["tmdb"],
        raw_tmdb: item,
      });
    }
  });

  results.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  return { success: true, results };
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
  let episodeOptions: { number: number; title: string; dfiId?: string | null }[] = [];

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

        // Fetch DFI episodes count
        const comment = (dfiMetadata as any).Comment || (dfiMetadata as any).Synopsis || "";
        const epMatch = comment.match(/(\d+)\s+afsnit/i);
        if (epMatch) {
          episodeCount = parseInt(epMatch[1]);
        }

        const children = Array.isArray((dfiMetadata as any).Children) ? (dfiMetadata as any).Children : [];
        if (children.length > 0) {
          const isEp = children.some((c: any) => parseDfiEpisodeTitleInfo(c.Title));
          if (isEp) {
            episodeCount = children.length;
            episodeOptions = children.map((c: any, idx: number) => {
              const parsed = parseDfiEpisodeTitleInfo(c.Title ?? "");
              const num = parsed?.episodeNumber ?? idx + 1;
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
      const externalIds = await getTMDBExternalIds(tmdbId, type === "tv-serie" ? "tv" : "movie");
      imdbId = imdbId ?? externalIds.imdb_id;
      wikidataId = wikidataId ?? externalIds.wikidata_id;

      if (type === "tv-serie") {
        const tmdbDet = await getTMDBWorkDetails(tmdbId, "tv");
        if (tmdbDet.success && tmdbDet.details) {
          const tDetails = tmdbDet.details as any;
          if (tDetails.number_of_episodes) {
            episodeCount = episodeCount ?? tDetails.number_of_episodes;
          }
        }
      }
    } catch (e) {
      console.error("TMDB external IDs lookup error in resolveUnifiedSearchResultDetails:", e);
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
      episode_options: episodeOptions,
    }
  };
}

