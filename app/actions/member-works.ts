"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { findTMDBPoster, findTMDBMatch } from "@/app/actions/tmdb";
import { getDFIFilmDetails } from "@/app/actions/dfi";
import { extractDfiPosterUrl, type DfiMetadata } from "@/lib/dfi-metadata";
import { generateEpisodesForSeries } from "@/app/actions/series-generator";

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
      status: "pending",
    })
    .select("id")
    .single();

  if (requestError || !request?.id) throw new Error(requestError?.message ?? "Kunne ikke oprette request.");

  const message = params.comment.trim() || "Ingen bemærkning.";
  const { error: commentError } = await params.db.from("work_change_request_comments").insert({
    request_id: request.id,
    author_user_id: params.userId,
    author_role: "member",
    message,
  });
  if (commentError) throw new Error(commentError.message);
  return request.id as string;
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
    } catch (e) {
      console.error("DFI import TMDB match lookup error:", e);
    }
  }

  if (!posterUrl) {
    posterUrl = await findTMDBPoster(params.workData.title, params.workData.year) ?? null;
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
    .select("id, title, type, year, duration_minutes, season_count, episode_count, genre, director, status, dfi_id, tmdb_id, poster_url, description, work_assignments(id, role, rights_holder_id, rettighedshavere(id, full_name))")
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

  let targetWorkId = params.workId;

  // Hvis det er en serie og der er angivet sæson, find eller generer afsnit
  const isSeries = work.type === "tv-serie" || work.type === "dokumentar-serie";
  if (isSeries && params.seasonNumber) {
    if (work.parent_work_id === null) {
      // Sørg for at afsnit er genereret for denne sæson
      const genRes = await generateEpisodesForSeries({
        parentWork: work as any,
        seasonNumber: params.seasonNumber,
      });
      if (genRes.success) {
        // Find det specifikke afsnitsværk
        const { data: epWork } = await db
          .from("works")
          .select("id")
          .eq("parent_work_id", work.id)
          .eq("season_number", params.seasonNumber)
          .eq("episode_number", params.episodeNumber ?? 1)
          .maybeSingle();

        if (epWork) {
          targetWorkId = epWork.id;
        }
      }
    }
  }

  const { error: assignErr } = await db
    .from("work_assignments")
    .upsert(
      { work_id: targetWorkId, org_id: orgId, rights_holder_id: params.rightsHolderId, role: params.role },
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
    await db.from("works").update({ status: "til_godkendelse" }).eq("id", params.workId);
    const fresh = await fetchMemberAssignment(db, params.workId, params.rightsHolderId);
    revalidatePath("/portal/mine-vaerker");
    revalidatePath("/admin/vaerker");
    return { success: true, pending: true, requestId, assignment: fresh };
  }

  const fresh = await fetchMemberAssignment(db, params.workId, params.rightsHolderId);

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
  const coEditors = normalizeCoEditors(params.coEditors);
  const requiresApproval = params.overrideLocalMatch || similarWorks.length > 0 || coEditors.length > 0;
  let dfiMetadata = params.workData.dfi_metadata ?? null;
  let posterUrl = params.workData.poster_url ?? null;
  let tmdbId = params.workData.tmdb_id ?? null;

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
    } catch (error) {
      console.error("DFI TMDB match lookup error in addWorkForMemberWithApproval:", error);
    }
  }

  posterUrl = posterUrl ?? await findTMDBPoster(params.workData.title, params.workData.year) ?? null;
  const enrichedWorkData = {
    ...params.workData,
    tmdb_id: tmdbId,
    poster_url: posterUrl,
    dfi_metadata: dfiMetadata,
  };

  const isSeries = params.workData.type === "tv-serie" || params.workData.type === "dokumentar-serie";
  let finalWorkId: string;
  let parentWork: any = null;

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
        dfi_metadata: enrichedWorkData.dfi_metadata ?? null,
      };

      const { data, error: parentError } = await db
        .from("works")
        .insert(parentPayload)
        .select("*")
        .single();
      if (parentError || !data) return { success: false, error: parentError?.message ?? "Kunne ikke oprette serieværk." };
      parentWork = data;
    }

    // 3. Generer episoder for den givne sæson
    const seasonNum = params.workData.season_number ?? 1;
    const genRes = await generateEpisodesForSeries({
      parentWork: parentWork as any,
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
      targetEpisodes = episodes ?? [];
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
  } else {
    // Enkeltværk flow
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
      dfi_metadata: enrichedWorkData.dfi_metadata ?? null,
    };

    const { data: work, error: workError } = await db
      .from("works")
      .insert(insertPayload)
      .select("id")
      .single();
    if (workError || !work) return { success: false, error: workError?.message ?? "Kunne ikke oprette værk." };

    const { error: assignErr } = await db
      .from("work_assignments")
      .upsert(
        { work_id: work.id, org_id: orgId, rights_holder_id: params.rightsHolderId, role: params.role },
        { onConflict: "work_id,rights_holder_id,role" }
      );
    if (assignErr) return { success: false, error: assignErr.message };

    finalWorkId = work.id;
  }

  if (requiresApproval) {
    const requestId = await createWorkRequest({
      db,
      workId: isSeries && parentWork ? parentWork.id : finalWorkId,
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

  const fresh = await fetchMemberAssignment(db, finalWorkId, params.rightsHolderId);
  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/admin/vaerker");
  return { success: true, assignment: fresh };
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
