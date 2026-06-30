"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { findTMDBPoster } from "@/app/actions/tmdb";
import type { DfiMetadata } from "@/lib/dfi-metadata";

const DFKS_ORG_ID = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";

type WorkCorrectionData = {
  title: string;
  type: string;
  year: number | null;
  duration_minutes: number | null;
  episode_count: number | null;
  genre: string | null;
  description: string | null;
};

type AdminWorkData = WorkCorrectionData & {
  dfi_id: string | null;
  tmdb_id: number | null;
  poster_url: string | null;
  status: string;
  dfi_metadata?: DfiMetadata | null;
};

type CreateWorkData = WorkCorrectionData & {
  dfi_id?: string | null;
  tmdb_id?: number | null;
  poster_url?: string | null;
  dfi_metadata?: DfiMetadata | null;
};

type ProposedCoEditor = {
  name: string;
  role: string;
  sharePercent?: number | null;
  share_percent?: number | null;
  rightsHolderId?: string | null;
  assignmentId?: string | null;
  action?: "add" | "remove" | "change";
};

type WorkRequestPayload = Partial<WorkCorrectionData> & {
  kind?: "creation" | "correction" | "co_editors";
  workData?: Partial<CreateWorkData>;
  memberRole?: string;
  coEditors?: ProposedCoEditor[];
  localMatches?: unknown[];
  overrideLocalMatch?: boolean;
  assignmentChanges?: ProposedCoEditor[];
};

const BROADCAST_STREAM_NUMBER = "broadcast/stream";

const CORRECTABLE_KEYS: (keyof WorkCorrectionData)[] = [
  "title",
  "type",
  "year",
  "duration_minutes",
  "episode_count",
  "genre",
  "description",
];

const ADMIN_EDITABLE_KEYS: (keyof AdminWorkData)[] = [
  ...CORRECTABLE_KEYS,
  "dfi_id",
  "tmdb_id",
  "poster_url",
  "status",
  "dfi_metadata",
];

function cleanText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanWorkType(value: string) {
  const allowed = ["kortfilm", "spillefilm", "tv-serie", "dokumentar-serie", "dokumentarfilm"];
  return allowed.includes(value) ? value : "spillefilm";
}

function normalizeData(data: WorkCorrectionData): WorkCorrectionData {
  return {
    title: data.title.trim(),
    type: cleanWorkType(data.type),
    year: data.year,
    duration_minutes: data.duration_minutes,
    episode_count: data.episode_count,
    genre: cleanText(data.genre),
    description: cleanText(data.description),
  };
}

function normalizeAdminData(data: AdminWorkData): AdminWorkData {
  return {
    ...normalizeData(data),
    dfi_id: cleanText(data.dfi_id),
    tmdb_id: data.tmdb_id,
    poster_url: cleanText(data.poster_url),
    status: cleanText(data.status) ?? "godkendt",
    dfi_metadata: data.dfi_metadata ?? null,
  };
}

function cleanSharePercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isMissingSharePercentError(error: { message?: string; code?: string } | null | undefined) {
  return error?.code === "42703" || error?.message?.includes("share_percent");
}

async function retryWithoutSharePercent<T>(
  result: { data: T | null; error: { message?: string; code?: string } | null },
  fallback: () => Promise<{ data: T | null; error: { message?: string; code?: string } | null }>
) {
  if (!isMissingSharePercentError(result.error)) return result;
  return fallback();
}

function changedFields(current: Record<string, unknown>, proposed: WorkCorrectionData) {
  return CORRECTABLE_KEYS.reduce<Partial<WorkCorrectionData>>((acc, key) => {
    const next = proposed[key];
    const prev = current[key];
    if ((next ?? null) !== (prev ?? null)) acc[key] = next as never;
    return acc;
  }, {});
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

async function findRightsHolderByName(db: ReturnType<typeof createServiceClient>, name: string, orgId: string) {
  const normalizedName = normalizeTitle(name);
  if (!normalizedName) return null;

  const { data } = await db
    .from("org_affiliations")
    .select("rettighedshavere(id, full_name)")
    .eq("org_id", orgId);

  return (data ?? [])
    .map(row => Array.isArray(row.rettighedshavere) ? row.rettighedshavere[0] : row.rettighedshavere)
    .find(holder => holder?.id && normalizeTitle(holder.full_name ?? "") === normalizedName) ?? null;
}

async function applyCoEditorChanges(db: ReturnType<typeof createServiceClient>, workId: string, orgId: string, coEditors?: ProposedCoEditor[]) {
  for (const editor of coEditors ?? []) {
    const role = cleanText(editor.role) ?? "Klipper";
    const share_percent = cleanSharePercent(editor.sharePercent ?? editor.share_percent);

         if (editor.action === "remove" && editor.assignmentId) {
           const { error } = await db
             .from("work_assignments")
             .delete()
             .eq("id", editor.assignmentId)
             .eq("work_id", workId)
             .eq("org_id", orgId);
           if (error) throw new Error(error.message);
           continue;
         }

         if (editor.action === "change" && editor.assignmentId) {
           const { error } = await retryWithoutSharePercent(
             await db
               .from("work_assignments")
               .update({ role, share_percent })
               .eq("id", editor.assignmentId)
               .eq("work_id", workId)
               .eq("org_id", orgId),
             async () => await db
               .from("work_assignments")
               .update({ role })
               .eq("id", editor.assignmentId)
               .eq("work_id", workId)
               .eq("org_id", orgId)
           );
           if (error) throw new Error(error.message);
           continue;
         }

         let rightsHolderId = cleanText(editor.rightsHolderId);
         if (!rightsHolderId && editor.name) {
           const holder = await findRightsHolderByName(db, editor.name, orgId);
           rightsHolderId = holder?.id ?? null;
         }
         if (!rightsHolderId) continue;

         const { error } = await retryWithoutSharePercent(
           await db
             .from("work_assignments")
             .upsert(
               { work_id: workId, org_id: orgId, rights_holder_id: rightsHolderId, role, share_percent },
               { onConflict: "work_id,rights_holder_id,role" }
             ),
           async () => await db
             .from("work_assignments")
             .upsert(
               { work_id: workId, org_id: orgId, rights_holder_id: rightsHolderId, role },
               { onConflict: "work_id,rights_holder_id,role" }
             )
         );
         if (error) throw new Error(error.message);
       }
     }

async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Du skal være logget ind.");
  return { supabase, user: data.user };
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

export async function submitWorkDataCorrection(params: {
  assignmentId: string;
  workId: string;
  data: WorkCorrectionData;
  comment: string;
  coEditors?: ProposedCoEditor[];
}) {
  const comment = params.comment.trim();
  if (!comment) throw new Error("Skriv en bemærkning til admin.");

  const proposed = normalizeData(params.data);
  if (!proposed.title) throw new Error("Titel må ikke være tom.");
  if (!proposed.type) throw new Error("Type må ikke være tom.");

  const { user } = await currentUser();
  const db = createServiceClient();

  const { data: assignment, error: assignmentError } = await db
    .from("work_assignments")
    .select("id, work_id, rights_holder_id, rettighedshavere(id,user_id)")
    .eq("id", params.assignmentId)
    .eq("work_id", params.workId)
    .single();

  if (assignmentError || !assignment) throw new Error("Kunne ikke finde din tilknytning til værket.");
  const rightsHolder = Array.isArray(assignment.rettighedshavere) ? assignment.rettighedshavere[0] : assignment.rettighedshavere;
  if (!rightsHolder || rightsHolder.user_id !== user.id) throw new Error("Du kan kun foreslå rettelser til dine egne værker.");

  const { data: work, error: workError } = await db
    .from("works")
    .select("id, org_id, title, type, year, duration_minutes, episode_count, genre, description, status")
    .eq("id", params.workId)
    .single();

  if (workError || !work) throw new Error("Værket findes ikke.");

  const proposedChanges = changedFields(work, proposed);
  const coEditors = params.coEditors ?? [];
  if (!Object.keys(proposedChanges).length && !coEditors.length) throw new Error("Der er ingen ændringer at sende til admin.");

  const orgId = await currentOrgId(db, user.id);
  const { data: request, error: requestError } = await db
    .from("work_change_requests")
    .insert({
      org_id: work.org_id ?? orgId,
      work_id: work.id,
      requested_by_user_id: user.id,
      requested_by_rights_holder_id: rightsHolder.id,
      source: "Mine værker",
      old_data: work,
      proposed_data: { kind: "correction", ...proposedChanges, coEditors },
      status: "pending",
    })
    .select("id")
    .single();

  if (requestError || !request?.id) throw new Error(requestError?.message ?? "Kunne ikke oprette ændringsanmodning.");

  const { error: commentError } = await db.from("work_change_request_comments").insert({
    request_id: request.id,
    author_user_id: user.id,
    author_role: "member",
    message: comment,
  });
  if (commentError) throw new Error(commentError.message);

  const { error: statusError } = await db.from("works").update({ status: "til_godkendelse" }).eq("id", work.id);
  if (statusError) throw new Error(statusError.message);

  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/admin/vaerker");
  return { success: true, requestId: request.id as string };
}

export async function fetchAdminWorksForReview() {
  const { supabase, user } = await currentUser();
  const admin = await assertAdminRole(supabase);
  if (!admin) throw new Error("Mangler adminrettigheder.");

  const db = createServiceClient();
  const orgId = await currentOrgId(db, user.id);
  const withSharePercent = await db
    .from("works")
    .select("*, work_change_requests(*, rettighedshavere(full_name), work_change_request_comments(*)), contracts(id, type, status, created_at, rettighedshavere(full_name)), work_assignments(id, role, share_percent, rettighedshavere(id, full_name)), work_production_numbers(id, tv_station, number)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  const { data, error } = await retryWithoutSharePercent(
    withSharePercent,
    async () => await db
      .from("works")
      .select("*, work_change_requests(*, rettighedshavere(full_name), work_change_request_comments(*)), contracts(id, type, status, created_at, rettighedshavere(full_name)), work_assignments(id, role, rettighedshavere(id, full_name)), work_production_numbers(id, tv_station, number)")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
  );

  if (error) throw new Error(error.message);
  return { success: true, works: data ?? [] };
}

export async function fetchAdminRightsHolders() {
  const { supabase, user } = await currentUser();
  const admin = await assertAdminRole(supabase);
  if (!admin) throw new Error("Mangler adminrettigheder.");

  const db = createServiceClient();
  const orgId = await currentOrgId(db, user.id);
  const { data, error } = await db
    .from("org_affiliations")
    .select("rettighedshavere(id, full_name)")
    .eq("org_id", orgId);

  if (error) throw new Error(error.message);
  const rightsHolders = (data ?? [])
    .map(row => Array.isArray(row.rettighedshavere) ? row.rettighedshavere[0] : row.rettighedshavere)
    .filter((holder): holder is { id: string; full_name: string } => Boolean(holder?.id && holder?.full_name))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "da-DK"));

  return { success: true, rightsHolders };
}

export async function fetchAdminBroadcasters() {
  const { supabase } = await currentUser();
  const admin = await assertAdminRole(supabase);
  if (!admin) throw new Error("Mangler adminrettigheder.");

  const db = createServiceClient();
  const { data, error } = await db
    .from("broadcasters")
    .select("name")
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  const broadcasters = (data ?? [])
    .map(row => row.name)
    .filter((name): name is string => Boolean(name));

  return { success: true, broadcasters };
}

export async function fetchPendingWorkReviewCount() {
  const { supabase, user } = await currentUser();
  const admin = await assertAdminRole(supabase);
  if (!admin) return { success: true, count: 0 };

  const db = createServiceClient();
  const orgId = await currentOrgId(db, user.id);
  const { count, error } = await db
    .from("work_change_requests")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "pending");

  if (error) throw new Error(error.message);
  return { success: true, count: count ?? 0 };
}

async function updateWorkBroadcaster(db: ReturnType<typeof createServiceClient>, workId: string, broadcaster?: string | null) {
  const cleanBroadcaster = cleanText(broadcaster);
  const { error: deleteError } = await db
    .from("work_production_numbers")
    .delete()
    .eq("work_id", workId)
    .eq("number", BROADCAST_STREAM_NUMBER);

  if (deleteError) throw new Error(deleteError.message);
  if (!cleanBroadcaster) return;

  const { error: insertError } = await db
    .from("work_production_numbers")
    .insert({
      work_id: workId,
      tv_station: cleanBroadcaster,
      number: BROADCAST_STREAM_NUMBER,
    });

  if (insertError) throw new Error(insertError.message);
}

export async function updateAdminWorkData(params: {
  workId: string;
  data: AdminWorkData;
  assignments?: { id?: string; rightsHolderId?: string; role: string; sharePercent?: number | null }[];
  broadcaster?: string | null;
}) {
  const { supabase, user } = await currentUser();
  const admin = await assertAdminRole(supabase);
  if (!admin) throw new Error("Mangler adminrettigheder.");

  const normalized = normalizeAdminData(params.data);
  if (!normalized.title) throw new Error("Titel må ikke være tom.");
  if (!normalized.type) throw new Error("Type må ikke være tom.");

  const updates = ADMIN_EDITABLE_KEYS.reduce<Partial<AdminWorkData>>((acc, key) => {
    acc[key] = normalized[key] as never;
    return acc;
  }, {});

  const db = createServiceClient();
  const orgId = await currentOrgId(db, user.id);
  const { error } = await db
    .from("works")
    .update(updates)
    .eq("id", params.workId)
    .eq("org_id", orgId);

  if (error) throw new Error(error.message);

  await updateWorkBroadcaster(db, params.workId, params.broadcaster);

  for (const assignment of params.assignments ?? []) {
    const role = cleanText(assignment.role);
    if (!role) continue;
    const share_percent = cleanSharePercent(assignment.sharePercent);
    if (assignment.id) {
      const { error: assignmentError } = await retryWithoutSharePercent(
        await db
          .from("work_assignments")
          .update({ role, share_percent })
          .eq("id", assignment.id)
          .eq("work_id", params.workId)
          .eq("org_id", orgId),
        async () => await db
          .from("work_assignments")
          .update({ role })
          .eq("id", assignment.id)
          .eq("work_id", params.workId)
          .eq("org_id", orgId)
      );
      if (assignmentError) throw new Error(assignmentError.message);
      continue;
    }

    if (assignment.rightsHolderId) {
      const { error: assignmentError } = await retryWithoutSharePercent(
        await db
          .from("work_assignments")
          .upsert(
            {
              work_id: params.workId,
              org_id: orgId,
              rights_holder_id: assignment.rightsHolderId,
              role,
              share_percent,
            },
            { onConflict: "work_id,rights_holder_id,role" }
          ),
        async () => await db
          .from("work_assignments")
          .upsert(
            {
              work_id: params.workId,
              org_id: orgId,
              rights_holder_id: assignment.rightsHolderId,
              role,
            },
            { onConflict: "work_id,rights_holder_id,role" }
          )
      );
      if (assignmentError) throw new Error(assignmentError.message);
    }
  }

  revalidatePath("/admin/vaerker");
  revalidatePath("/portal/mine-vaerker");
  return { success: true };
}

export async function createAdminWork(params: {
  data: CreateWorkData;
  workId?: string | null;
  rightsHolderId?: string | null;
  role?: string | null;
  sharePercent?: number | null;
  broadcaster?: string | null;
}) {
  const { supabase, user } = await currentUser();
  const admin = await assertAdminRole(supabase);
  if (!admin) throw new Error("Mangler adminrettigheder.");

  const normalized = normalizeData(params.data);
  if (!normalized.title) throw new Error("Titel må ikke være tom.");
  if (!normalized.type) throw new Error("Type må ikke være tom.");

  const db = createServiceClient();
  const orgId = await currentOrgId(db, user.id);
  let workId: string | null = null;
  let existingPosterUrl: string | null = null;

  if (params.workId) {
    const { data } = await db
      .from("works")
      .select("id, poster_url")
      .eq("id", params.workId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (data?.id) {
      workId = data.id;
      existingPosterUrl = data.poster_url;
    }
  }
  if (!workId && params.data.dfi_id) {
    const { data } = await db.from("works").select("id, poster_url").eq("dfi_id", params.data.dfi_id).maybeSingle();
    if (data?.id) {
      workId = data.id;
      existingPosterUrl = data.poster_url;
    }
  }
  if (!workId && params.data.tmdb_id) {
    const { data } = await db.from("works").select("id, poster_url").eq("tmdb_id", params.data.tmdb_id).maybeSingle();
    if (data?.id) {
      workId = data.id;
      existingPosterUrl = data.poster_url;
    }
  }
  if (!workId && normalized.title && normalized.year) {
    const { data } = await db
      .from("works")
      .select("id, poster_url")
      .ilike("title", normalized.title)
      .eq("year", normalized.year)
      .maybeSingle();
    if (data?.id) {
      workId = data.id;
      existingPosterUrl = data.poster_url;
    }
  }

  const posterUrl = cleanText(params.data.poster_url)
    ?? await findTMDBPoster(normalized.title, normalized.year)
    ?? null;

  if (!workId) {
    const { data: created, error } = await db
      .from("works")
      .insert({
        org_id: orgId,
        ...normalized,
        dfi_id: cleanText(params.data.dfi_id),
        tmdb_id: params.data.tmdb_id ?? null,
        poster_url: posterUrl,
        dfi_metadata: params.data.dfi_metadata ?? null,
        status: "godkendt",
      })
      .select("id")
      .single();
    if (error || !created?.id) throw new Error(error?.message ?? "Kunne ikke oprette værk.");
    workId = created.id;
  } else {
    // Opdater hvis der mangler plakat eller DFI metadata
    const updates: Partial<CreateWorkData> = {};
    if (!existingPosterUrl && posterUrl) updates.poster_url = posterUrl;
    if (params.data.dfi_metadata) updates.dfi_metadata = params.data.dfi_metadata;
    if (Object.keys(updates).length > 0) {
      const { error } = await db
        .from("works")
        .update(updates)
        .eq("id", workId)
        .eq("org_id", orgId);
      if (error) throw new Error(error.message);
    }
  }

  if (!workId) throw new Error("Kunne ikke finde eller oprette værk.");

  if (params.rightsHolderId && params.role) {
    const { error: assignmentError } = await retryWithoutSharePercent(
      await db
        .from("work_assignments")
        .upsert(
          {
            work_id: workId,
            org_id: orgId,
            rights_holder_id: params.rightsHolderId,
            role: params.role,
            share_percent: cleanSharePercent(params.sharePercent),
          },
          { onConflict: "work_id,rights_holder_id,role" }
        ),
      async () => await db
        .from("work_assignments")
        .upsert(
          {
            work_id: workId,
            org_id: orgId,
            rights_holder_id: params.rightsHolderId,
            role: params.role,
          },
          { onConflict: "work_id,rights_holder_id,role" }
        )
    );
    if (assignmentError) throw new Error(assignmentError.message);
  }

  await updateWorkBroadcaster(db, workId, params.broadcaster);

  revalidatePath("/admin/vaerker");
  revalidatePath("/portal/mine-vaerker");
  return { success: true, workId };
}

export async function archiveAdminWorks(params: { workIds: string[] }) {
  const { supabase, user } = await currentUser();
  const admin = await assertAdminRole(supabase);
  if (!admin) throw new Error("Mangler adminrettigheder.");

  const ids = [...new Set(params.workIds)].filter(Boolean);
  if (!ids.length) throw new Error("Vælg mindst ét værk.");

  const db = createServiceClient();
  const orgId = await currentOrgId(db, user.id);
  const { error } = await db
    .from("works")
    .update({ status: "arkiveret" })
    .eq("org_id", orgId)
    .in("id", ids);

  if (error) throw new Error(error.message);
  revalidatePath("/admin/vaerker");
  revalidatePath("/portal/mine-vaerker");
  return { success: true };
}

export async function approveAdminWorks(params: { workIds: string[] }) {
  const { supabase, user } = await currentUser();
  const admin = await assertAdminRole(supabase);
  if (!admin) throw new Error("Mangler adminrettigheder.");

  const ids = [...new Set(params.workIds)].filter(Boolean);
  if (!ids.length) throw new Error("Vælg mindst ét værk.");

  const db = createServiceClient();
  const orgId = await currentOrgId(db, user.id);
  const { error } = await db
    .from("works")
    .update({ status: "godkendt" })
    .eq("org_id", orgId)
    .in("id", ids);

  if (error) throw new Error(error.message);
  revalidatePath("/admin/vaerker");
  revalidatePath("/portal/mine-vaerker");
  return { success: true };
}

export async function mergeAdminWorks(params: {
  masterWorkId: string;
  duplicateWorkIds: string[];
}) {
  const { supabase, user } = await currentUser();
  const admin = await assertAdminRole(supabase);
  if (!admin) throw new Error("Mangler adminrettigheder.");

  const duplicateIds = [...new Set(params.duplicateWorkIds)]
    .filter(id => id && id !== params.masterWorkId);
  if (!params.masterWorkId || duplicateIds.length === 0) {
    throw new Error("Vælg et hovedværk og mindst én dublet.");
  }

  const db = createServiceClient();
  const orgId = await currentOrgId(db, user.id);
  const { data: master, error: masterError } = await db
    .from("works")
    .select("id, org_id")
    .eq("id", params.masterWorkId)
    .eq("org_id", orgId)
    .single();
  if (masterError || !master) throw new Error("Hovedværket findes ikke.");

  const tableUpdates = [
    db.from("contracts").update({ work_id: params.masterWorkId }).in("work_id", duplicateIds),
    db.from("work_assignments").update({ work_id: params.masterWorkId }).in("work_id", duplicateIds),
    db.from("episodes").update({ work_id: params.masterWorkId }).in("work_id", duplicateIds),
    db.from("work_production_numbers").update({ work_id: params.masterWorkId }).in("work_id", duplicateIds),
    db.from("work_change_requests").update({ work_id: params.masterWorkId }).in("work_id", duplicateIds),
  ];

  for (const update of tableUpdates) {
    const { error } = await update;
    if (error) throw new Error(error.message);
  }

  const { error: archiveError } = await db
    .from("works")
    .update({ status: "arkiveret" })
    .eq("org_id", orgId)
    .in("id", duplicateIds);

  if (archiveError) throw new Error(archiveError.message);
  revalidatePath("/admin/vaerker");
  revalidatePath("/portal/mine-vaerker");
  return { success: true };
}

export async function reviewWorkDataCorrection(params: {
  requestId: string;
  decision: "approved" | "rejected";
  comment?: string;
}) {
  const { supabase, user } = await currentUser();
  const admin = await assertAdminRole(supabase);
  if (!admin) throw new Error("Mangler adminrettigheder.");

  const db = createServiceClient();
  const { data: request, error: requestError } = await db
    .from("work_change_requests")
    .select("*")
    .eq("id", params.requestId)
    .single();

  if (requestError || !request) throw new Error(requestError?.message ?? "Anmodningen findes ikke.");
  if (params.decision === "rejected" && request.status === "approved") throw new Error("Godkendte anmodninger kan ikke afvises.");
  if (params.decision === "approved" && request.status === "approved") throw new Error("Anmodningen er allerede godkendt.");

  const proposed = request.proposed_data as WorkRequestPayload;
  if (params.decision === "approved") {
    const candidate = proposed.workData ?? proposed;
    const allowed = CORRECTABLE_KEYS.reduce<Partial<WorkCorrectionData>>((acc, key) => {
      if (Object.prototype.hasOwnProperty.call(candidate, key)) acc[key] = candidate[key] as never;
      return acc;
    }, {});
    const workUpdates = {
      ...allowed,
      status: "godkendt",
    };
    const { error } = await db.from("works").update(workUpdates).eq("id", request.work_id);
    if (error) throw new Error(error.message);
    await applyCoEditorChanges(db, request.work_id, request.org_id, proposed.coEditors);
    await applyCoEditorChanges(db, request.work_id, request.org_id, proposed.assignmentChanges);
  }

  const adminMessage = cleanText(params.comment) ?? (params.decision === "rejected" ? "Rettelsen er afvist." : null);

  const { error } = await db
    .from("work_change_requests")
    .update({
      status: params.decision,
      reviewed_by_user_id: user.id,
      reviewed_at: new Date().toISOString(),
      admin_comment: adminMessage,
    })
    .eq("id", params.requestId);
  if (error) throw new Error(error.message);

  if (adminMessage) {
    const { error: commentError } = await db.from("work_change_request_comments").insert({
      request_id: params.requestId,
      author_user_id: user.id,
      author_role: "admin",
      message: adminMessage,
    });
    if (commentError) throw new Error(commentError.message);
  }

  if (params.decision === "approved") {
    const { count } = await db
      .from("work_change_requests")
      .select("id", { count: "exact", head: true })
      .eq("work_id", request.work_id)
      .eq("status", "pending");

    if (!count && proposed.kind !== "creation") await db.from("works").update({ status: "godkendt" }).eq("id", request.work_id);
  }

  revalidatePath("/admin/vaerker");
  revalidatePath("/portal/mine-vaerker");
  return { success: true };
}
