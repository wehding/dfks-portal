"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { findTMDBPoster } from "@/app/actions/tmdb";

const DFKS_ORG_ID = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";

type MemberWorkData = {
  dfi_id?: string | null;
  tmdb_id?: number | null;
  title: string;
  type: string;
  year: number | null;
  duration_minutes?: number | null;
  episode_count?: number | null;
  genre?: string | null;
  description?: string | null;
  poster_url?: string | null;
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

async function findSimilarWorks(db: ReturnType<typeof createServiceClient>, title: string, year: number | null) {
  if (!title.trim()) return [];
  const { data } = await db
    .from("works")
    .select("id, title, type, year, status, dfi_id, tmdb_id, poster_url")
    .eq("org_id", DFKS_ORG_ID)
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
  const { data: request, error: requestError } = await params.db
    .from("work_change_requests")
    .insert({
      org_id: DFKS_ORG_ID,
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
    .select("id, role, contract_id, episode_id, created_at, episodes(episode_number,title), works(id, title, type, year, duration_minutes, episode_count, genre, status, dfi_id, tmdb_id, poster_url, description, work_change_requests(*, work_change_request_comments(*)))")
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
    description?: string | null;
    poster_url?: string | null;
  };
}) {
  const db = createServiceClient();

  const orgId = DFKS_ORG_ID;

  // Find eksisterende værk
  let workId: string | null = null;
  let existingPosterUrl: string | null = null;
  if (params.workData.dfi_id) {
    const { data } = await db.from("works").select("id, poster_url").eq("dfi_id", params.workData.dfi_id).maybeSingle();
    if (data) {
      workId = data.id;
      existingPosterUrl = data.poster_url;
    }
  }
  if (!workId && params.workData.tmdb_id) {
    const { data } = await db.from("works").select("id, poster_url").eq("tmdb_id", params.workData.tmdb_id).maybeSingle();
    if (data) {
      workId = data.id;
      existingPosterUrl = data.poster_url;
    }
  }

  const posterUrl = params.workData.poster_url
    ?? await findTMDBPoster(params.workData.title, params.workData.year)
    ?? null;

  // Opret nyt værk hvis ikke fundet
  if (!workId) {
    const { data: nw, error } = await db
      .from("works")
      .insert({ org_id: orgId, status: "godkendt", ...params.workData, poster_url: posterUrl })
      .select("id")
      .single();
    if (error || !nw) return { success: false, error: error?.message ?? "Kunne ikke oprette værk" };
    workId = nw.id;
  } else if (!existingPosterUrl && posterUrl) {
    await db.from("works").update({ poster_url: posterUrl }).eq("id", workId);
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
    .select("id, role, contract_id, episode_id, created_at, episodes(episode_number,title), works(id, title, type, year, duration_minutes, episode_count, genre, status, dfi_id, tmdb_id, poster_url, description)")
    .eq("work_id", workId)
    .eq("rights_holder_id", params.rightsHolderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return { success: true, assignment: fresh };
}

export async function searchLocalWorksForMember(query: string) {
  const db = createServiceClient();
  const q = query.trim();
  if (!q) return { success: true, works: [] };

  const { data, error } = await db
    .from("works")
    .select("id, title, type, year, duration_minutes, episode_count, genre, status, dfi_id, tmdb_id, poster_url, description, work_assignments(id, role, rights_holder_id, rettighedshavere(id, full_name))")
    .eq("org_id", DFKS_ORG_ID)
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
}) {
  const db = createServiceClient();
  const { user } = await ensureOwnRightsHolder(db, params.rightsHolderId);

  const { data: work, error: workError } = await db
    .from("works")
    .select("id, title, type, year, status")
    .eq("id", params.workId)
    .eq("org_id", DFKS_ORG_ID)
    .single();
  if (workError || !work) return { success: false, error: "Værket findes ikke." };

  const { error: assignErr } = await db
    .from("work_assignments")
    .upsert(
      { work_id: params.workId, org_id: DFKS_ORG_ID, rights_holder_id: params.rightsHolderId, role: params.role },
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
  const similarWorks = await findSimilarWorks(db, params.workData.title, params.workData.year);
  const coEditors = normalizeCoEditors(params.coEditors);
  const requiresApproval = params.overrideLocalMatch || similarWorks.length > 0 || coEditors.length > 0;
  const posterUrl = params.workData.poster_url ?? await findTMDBPoster(params.workData.title, params.workData.year) ?? null;

  const insertPayload = {
    org_id: DFKS_ORG_ID,
    status: requiresApproval ? "til_godkendelse" : "godkendt",
    ...params.workData,
    poster_url: posterUrl,
  };

  const { data: work, error: workError } = await db
    .from("works")
    .insert(insertPayload)
    .select("id, title, type, year, status")
    .single();
  if (workError || !work) return { success: false, error: workError?.message ?? "Kunne ikke oprette værk." };

  const { error: assignErr } = await db
    .from("work_assignments")
    .upsert(
      { work_id: work.id, org_id: DFKS_ORG_ID, rights_holder_id: params.rightsHolderId, role: params.role },
      { onConflict: "work_id,rights_holder_id,role" }
    );
  if (assignErr) return { success: false, error: assignErr.message };

  if (requiresApproval) {
    const requestId = await createWorkRequest({
      db,
      workId: work.id,
      userId: user.id,
      rightsHolderId: params.rightsHolderId,
      source: "Mine værker - oprettelse",
      proposedData: {
        kind: "creation",
        workData: params.workData,
        memberRole: params.role,
        coEditors,
        source: params.source,
        overrideLocalMatch: Boolean(params.overrideLocalMatch),
        localMatches: similarWorks,
      },
      comment: params.comment,
    });
    const fresh = await fetchMemberAssignment(db, work.id, params.rightsHolderId);
    revalidatePath("/portal/mine-vaerker");
    revalidatePath("/admin/vaerker");
    return { success: true, pending: true, requestId, workId: work.id, assignment: fresh };
  }

  const fresh = await fetchMemberAssignment(db, work.id, params.rightsHolderId);

  return { success: true, assignment: fresh };
}

export async function removeWorkAssignment(assignmentId: string, rightsHolderId: string) {
  const db = createServiceClient();
  await db.from("work_assignments").delete().eq("id", assignmentId).eq("rights_holder_id", rightsHolderId);
  return { success: true };
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
  await ensureOwnRightsHolder(db, params.rightsHolderId);
  const normalizedName = normalizeTitle(params.fullName);
  if (!normalizedName) return { success: true, linked: 0 };

  const { data: requests } = await db
    .from("work_change_requests")
    .select("id, work_id, proposed_data")
    .eq("org_id", DFKS_ORG_ID)
    .eq("status", "approved");

  let linked = 0;
  for (const request of requests ?? []) {
    const proposed = request.proposed_data as { coEditors?: ProposedCoEditor[] } | null;
    for (const editor of proposed?.coEditors ?? []) {
      if (normalizeTitle(editor.name) !== normalizedName) continue;
      const { error } = await db
        .from("work_assignments")
        .upsert(
          { work_id: request.work_id, org_id: DFKS_ORG_ID, rights_holder_id: params.rightsHolderId, role: editor.role || "Klipper" },
          { onConflict: "work_id,rights_holder_id,role" }
        );
      if (!error) linked++;
    }
  }

  if (linked) revalidatePath("/portal/mine-vaerker");
  return { success: true, linked };
}
