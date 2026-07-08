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
  season_count?: number | null;
  episode_count: number | null;
  parent_work_id?: string | null;
  season_number?: number | null;
  episode_number?: number | null;
  genre: string | null;
  director?: string | null;
  alternative_titles?: string[];
  production_countries?: string[];
  production_companies?: string[];
  description: string | null;
};

type AdminWorkData = WorkCorrectionData & {
  dfi_id: string | null;
  tmdb_id: number | null;
  poster_url: string | null;
  status: string;
  dfi_metadata?: DfiMetadata | null;
  dfi_title?: string | null;
  dfi_danish_title?: string | null;
  dfi_original_title?: string | null;
  dfi_category?: string | null;
  dfi_type?: string | null;
};

type CreateWorkData = WorkCorrectionData & {
  dfi_id?: string | null;
  tmdb_id?: number | null;
  poster_url?: string | null;
  dfi_metadata?: DfiMetadata | null;
  dfi_title?: string | null;
  dfi_danish_title?: string | null;
  dfi_original_title?: string | null;
  dfi_category?: string | null;
  dfi_type?: string | null;
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
  myEpisodes?: number[];
};

const BROADCAST_STREAM_NUMBER = "broadcast/stream";

const CORRECTABLE_KEYS: (keyof WorkCorrectionData)[] = [
  "title",
  "type",
  "year",
  "duration_minutes",
  "season_count",
  "episode_count",
  "parent_work_id",
  "season_number",
  "episode_number",
  "genre",
  "director",
  "alternative_titles",
  "production_countries",
  "production_companies",
  "description",
];

const ADMIN_EDITABLE_KEYS: (keyof AdminWorkData)[] = [
  ...CORRECTABLE_KEYS,
  "dfi_id",
  "tmdb_id",
  "poster_url",
  "status",
  "dfi_metadata",
  "dfi_title",
  "dfi_danish_title",
  "dfi_original_title",
  "dfi_category",
  "dfi_type",
];

function cleanText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanTextList(value: string[] | null | undefined) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const item of value) {
    const text = cleanText(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(text);
  }
  return cleaned;
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
    season_count: data.season_count,
    episode_count: data.episode_count,
    parent_work_id: cleanText(data.parent_work_id),
    season_number: data.season_number,
    episode_number: data.episode_number,
    genre: cleanText(data.genre),
    director: cleanText(data.director),
    alternative_titles: cleanTextList(data.alternative_titles),
    production_countries: cleanTextList(data.production_countries),
    production_companies: cleanTextList(data.production_companies),
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
    dfi_title: cleanText(data.dfi_title),
    dfi_danish_title: cleanText(data.dfi_danish_title),
    dfi_original_title: cleanText(data.dfi_original_title),
    dfi_category: cleanText(data.dfi_category),
    dfi_type: cleanText(data.dfi_type),
  };
}

function cleanSharePercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isMissingSharePercentError(error: { message?: string; code?: string } | null | undefined) {
  return error?.code === "42703" || error?.message?.includes("share_percent");
}

function isMissingRelationError(error: { message?: string; code?: string } | null | undefined) {
  return error?.code === "42P01";
}

async function retryWithoutSharePercent<T>(
  result: { data: T | null; error: { message?: string; code?: string } | null },
  fallback: () => Promise<{ data: T | null; error: { message?: string; code?: string } | null }>
) {
  if (!isMissingSharePercentError(result.error)) return result;
  return fallback();
}

// Værdibaseret sammenligning så uændrede felter ikke fejlagtigt markeres som rettelser.
// Arrays sammenlignes normaliseret (trimmet, sorteret) — ikke ved reference.
function normValue(v: unknown) {
  return v === undefined || v === "" ? null : v;
}
function valuesEqual(a: unknown, b: unknown) {
  const na = normValue(a);
  const nb = normValue(b);
  if (Array.isArray(na) || Array.isArray(nb)) {
    const asArr = (x: unknown) => (Array.isArray(x) ? x : x == null ? [] : [x]).map(e => String(e).trim()).filter(Boolean).sort();
    return JSON.stringify(asArr(na)) === JSON.stringify(asArr(nb));
  }
  if (na == null || nb == null) return na === nb;
  return String(na) === String(nb);
}

function changedFields(current: Record<string, unknown>, proposed: WorkCorrectionData) {
  return CORRECTABLE_KEYS.reduce<Partial<WorkCorrectionData>>((acc, key) => {
    const next = proposed[key];
    const prev = current[key];
    if (!valuesEqual(next, prev)) acc[key] = next as never;
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

async function findExistingWorkByTitle(
  db: ReturnType<typeof createServiceClient>,
  title: string,
  year: number | null,
  orgId: string
) {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) return null;

  const { data, error } = await db
    .from("works")
    .select("id, poster_url, title, year")
    .eq("org_id", orgId)
    .limit(50);
  if (error) throw new Error(error.message);

  const matches = (data ?? []).filter(work => {
    const sameTitle = normalizeTitle(work.title ?? "") === normalizedTitle;
    const sameYear = year ? work.year === year : true;
    return sameTitle && sameYear;
  });

  if (matches.length > 1) {
    throw new Error(`Værket "${title}" findes allerede flere gange i databasen. Vælg et eksisterende værk i stedet for at oprette en dublet.`);
  }

  return matches[0] ?? null;
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
  myEpisodes?: number[];
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
    .select("id, org_id, title, type, year, duration_minutes, season_count, episode_count, parent_work_id, season_number, episode_number, genre, director, description, status")
    .eq("id", params.workId)
    .single();

  if (workError || !work) throw new Error("Værket findes ikke.");

  const proposedChanges = changedFields(work, proposed);
  const coEditors = params.coEditors ?? [];
  const hasChanges = Object.keys(proposedChanges).length > 0 || coEditors.length > 0 || (params.myEpisodes ?? []).length > 0;
  if (!hasChanges) throw new Error("Der er ingen ændringer at sende til admin.");

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
      proposed_data: { kind: "correction", ...proposedChanges, coEditors, myEpisodes: params.myEpisodes || [] },
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
    member_read_at: new Date().toISOString(),
  });
  if (commentError) throw new Error(commentError.message);

  // Værket forbliver "godkendt" — kun selve ændringsanmodningen er pending.
  // Admin ser stadig "Til godkendelse" via hasPendingRequest(), så en enkelt
  // klippers mikro-rettelse flager ikke andre rettighedshaveres andel af værket.

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
  const rows = data ?? [];
  // Skjul KUN tekniske serie-parents der faktisk har afsnit (children). Et childless
  // serie-værk (fx ældre data hvor brugeren er tildelt direkte på serien) er et rigtigt
  // værk og skal vises — ellers bliver det usynligt i admin selvom det har tildelinger/beskeder.
  const parentIdsWithChildren = new Set(
    rows.map(w => (w as { parent_work_id?: string | null }).parent_work_id).filter(Boolean)
  );
  const visibleWorks = rows.filter(work => {
    const isTechnicalSeriesParent =
      (work.type === "tv-serie" || work.type === "dokumentar-serie") &&
      work.parent_work_id === null &&
      work.episode_number === null &&
      parentIdsWithChildren.has(work.id);
    return !isTechnicalSeriesParent;
  });
  return { success: true, works: visibleWorks };
}

export async function deleteAdminWorkPermanently(params: { workId: string }) {
  const { supabase, user } = await currentUser();
  const admin = await assertAdminRole(supabase);
  if (!admin) throw new Error("Mangler adminrettigheder.");

  const workId = cleanText(params.workId);
  if (!workId) throw new Error("Værket mangler.");

  const db = createServiceClient();
  const orgId = await currentOrgId(db, user.id);
  const { data: work, error: workError } = await db
    .from("works")
    .select("id")
    .eq("id", workId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (workError) throw new Error(workError.message);
  if (!work) throw new Error("Værket findes ikke.");

  // Hent alle berørte kontrakter
  const { data: affectedContracts, error: affectedError } = await db
    .from("contracts")
    .select("id")
    .eq("work_id", workId)
    .eq("org_id", orgId);
  if (affectedError) throw new Error(affectedError.message);

  if (affectedContracts && affectedContracts.length > 0) {
    const contractIds = affectedContracts.map(c => c.id);
    
    // Slet valideringerne for disse kontrakter
    const { error: validationDeleteError } = await db
      .from("contract_validations")
      .delete()
      .in("contract_id", contractIds);
    if (validationDeleteError) throw new Error(validationDeleteError.message);
  }

  const { error: contractUpdateError } = await db
    .from("contracts")
    .update({ work_id: null, status: "kladde" })
    .eq("work_id", workId)
    .eq("org_id", orgId);
  if (contractUpdateError) throw new Error(contractUpdateError.message);

  const { error: airingUpdateError } = await db
    .from("work_airings")
    .update({ work_id: null })
    .eq("work_id", workId)
    .eq("org_id", orgId);
  if (airingUpdateError && !isMissingRelationError(airingUpdateError)) throw new Error(airingUpdateError.message);

  const { error: deleteError } = await db
    .from("works")
    .delete()
    .eq("id", workId)
    .eq("org_id", orgId);
  if (deleteError) throw new Error(deleteError.message);

  revalidatePath("/admin/vaerker");
  revalidatePath("/portal/mine-vaerker");
  return { success: true };
}

export async function deleteAdminWorksPermanently(params: { workIds: string[] }) {
  const { supabase, user } = await currentUser();
  const admin = await assertAdminRole(supabase);
  if (!admin) throw new Error("Mangler adminrettigheder.");

  const workIds = params.workIds.map(id => cleanText(id)).filter(Boolean);
  if (workIds.length === 0) throw new Error("Ingen værker valgt.");

  const db = createServiceClient();
  const orgId = await currentOrgId(db, user.id);

  const { data: works, error: worksError } = await db
    .from("works")
    .select("id")
    .in("id", workIds)
    .eq("org_id", orgId);

  if (worksError) throw new Error(worksError.message);
  const foundIds = works?.map(w => w.id) ?? [];
  if (foundIds.length === 0) throw new Error("Ingen af de valgte værker blev fundet.");

  // Slet i batches så store cascade-sletninger ikke rammer statement-timeout
  for (let i = 0; i < foundIds.length; i += 50) {
    const chunk = foundIds.slice(i, i + 50);

    // Hent alle berørte kontrakter for denne batch
    const { data: affectedContracts, error: affectedError } = await db
      .from("contracts")
      .select("id")
      .in("work_id", chunk)
      .eq("org_id", orgId);
    if (affectedError) throw new Error(affectedError.message);

    if (affectedContracts && affectedContracts.length > 0) {
      const contractIds = affectedContracts.map(c => c.id);
      
      // Slet valideringerne for disse kontrakter
      const { error: validationDeleteError } = await db
        .from("contract_validations")
        .delete()
        .in("contract_id", contractIds);
      if (validationDeleteError) throw new Error(validationDeleteError.message);
    }

    const { error: contractUpdateError } = await db
      .from("contracts")
      .update({ work_id: null, status: "kladde" })
      .in("work_id", chunk)
      .eq("org_id", orgId);
    if (contractUpdateError) throw new Error(contractUpdateError.message);

    const { error: airingUpdateError } = await db
      .from("work_airings")
      .update({ work_id: null })
      .in("work_id", chunk)
      .eq("org_id", orgId);
    if (airingUpdateError && !isMissingRelationError(airingUpdateError)) throw new Error(airingUpdateError.message);

    const { error: deleteError } = await db
      .from("works")
      .delete()
      .in("id", chunk)
      .eq("org_id", orgId);
    if (deleteError) throw new Error(deleteError.message);
  }

  revalidatePath("/admin/vaerker");
  revalidatePath("/portal/mine-vaerker");
  return { success: true, deletedCount: foundIds.length };
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
    .select("name, logo_path")
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  const broadcasters = (data ?? [])
    .filter((row): row is { name: string; logo_path: string | null } => Boolean(row.name));

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
    const { data } = await db.from("works").select("id, poster_url").eq("dfi_id", params.data.dfi_id).eq("org_id", orgId).maybeSingle();
    if (data?.id) {
      workId = data.id;
      existingPosterUrl = data.poster_url;
    }
  }
  if (!workId && params.data.tmdb_id) {
    const { data } = await db.from("works").select("id, poster_url").eq("tmdb_id", params.data.tmdb_id).eq("org_id", orgId).maybeSingle();
    if (data?.id) {
      workId = data.id;
      existingPosterUrl = data.poster_url;
    }
  }
  if (!workId && normalized.title) {
    const existing = await findExistingWorkByTitle(db, normalized.title, normalized.year, orgId);
    if (existing?.id) {
      workId = existing.id;
      existingPosterUrl = existing.poster_url;
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
        dfi_title: cleanText(params.data.dfi_title),
        dfi_danish_title: cleanText(params.data.dfi_danish_title),
        dfi_original_title: cleanText(params.data.dfi_original_title),
        dfi_category: cleanText(params.data.dfi_category),
        dfi_type: cleanText(params.data.dfi_type),
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
    if (params.data.dfi_title) updates.dfi_title = cleanText(params.data.dfi_title);
    if (params.data.dfi_danish_title) updates.dfi_danish_title = cleanText(params.data.dfi_danish_title);
    if (params.data.dfi_original_title) updates.dfi_original_title = cleanText(params.data.dfi_original_title);
    if (params.data.dfi_category) updates.dfi_category = cleanText(params.data.dfi_category);
    if (params.data.dfi_type) updates.dfi_type = cleanText(params.data.dfi_type);
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
  // Admin kan rette antal afsnit + hvilke afsnit medlemmet krediteres på inden godkendelse.
  episodeCountOverride?: number | null;
  myEpisodesOverride?: number[];
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
      ...(params.episodeCountOverride != null ? { episode_count: params.episodeCountOverride } : {}),
    };
    const { error } = await db.from("works").update(workUpdates).eq("id", request.work_id);
    if (error) throw new Error(error.message);
    await applyCoEditorChanges(db, request.work_id, request.org_id, proposed.coEditors);
    await applyCoEditorChanges(db, request.work_id, request.org_id, proposed.assignmentChanges);

    // Automatisk generering og tildeling af afsnit
    const oldWork = request.old_data as any;
    const isSeries = workUpdates.type === "tv-serie" || workUpdates.type === "dokumentar-serie" || oldWork?.type === "tv-serie" || oldWork?.type === "dokumentar-serie";
    const epCount = params.episodeCountOverride != null && params.episodeCountOverride > 0
      ? params.episodeCountOverride
      : (workUpdates.episode_count ? Number(workUpdates.episode_count) : (oldWork?.episode_count ? Number(oldWork.episode_count) : 0));

    if (isSeries && epCount > 0) {
      const { data: existingEpisodes } = await db
        .from("works")
        .select("id, episode_number")
        .eq("parent_work_id", request.work_id);

      const existingMap = new Map<number, string>();
      if (existingEpisodes) {
        existingEpisodes.forEach((e: any) => {
          if (e.episode_number != null) existingMap.set(Number(e.episode_number), e.id);
        });
      }

      const { data: myAssignment } = await db
        .from("work_assignments")
        .select("role")
        .eq("work_id", request.work_id)
        .eq("rights_holder_id", request.requested_by_rights_holder_id)
        .maybeSingle();

      const memberRole = myAssignment?.role || "Klipper";
      const myEpisodes = (params.myEpisodesOverride && params.myEpisodesOverride.length > 0
        ? params.myEpisodesOverride
        : (proposed.myEpisodes || [])) as number[];

      for (let i = 1; i <= epCount; i++) {
        let epWorkId = existingMap.get(i);

        if (!epWorkId) {
          const eStr = String(i).padStart(2, "0");
          const sStr = "01";
          const epTitle = `${workUpdates.title || oldWork?.title || "Ukendt"} - S${sStr}E${eStr}`;

          const { data: newEp, error: epErr } = await db
            .from("works")
            .insert({
              org_id: request.org_id,
              parent_work_id: request.work_id,
              season_number: 1,
              episode_number: i,
              title: epTitle,
              type: workUpdates.type || oldWork?.type || "tv-serie",
              year: workUpdates.year || oldWork?.year,
              duration_minutes: workUpdates.duration_minutes || oldWork?.duration_minutes,
              genre: workUpdates.genre || oldWork?.genre,
              director: workUpdates.director || oldWork?.director,
              description: workUpdates.description || oldWork?.description,
              poster_url: oldWork?.poster_url || null,
              status: "godkendt",
            })
            .select("id")
            .single();

          if (epErr) {
            console.error(`Fejl ved automatisk oprettelse af afsnit ${i}:`, epErr);
          } else {
            epWorkId = newEp.id;
          }
        }

        if (epWorkId && myEpisodes.includes(i)) {
          await db
            .from("work_assignments")
            .upsert(
              {
                work_id: epWorkId,
                org_id: request.org_id,
                rights_holder_id: request.requested_by_rights_holder_id,
                role: memberRole,
              },
              { onConflict: "work_id,rights_holder_id,role" }
            );
        }
      }
    }
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
      admin_read_at: new Date().toISOString(),
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

const WORK_ADMIN_ROLES = ["superadmin", "admin", "org-admin", "jurist"];

export async function markWorkRequestCommentsRead(requestId: string, viewerRole: "admin" | "member" = "member") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const db = createServiceClient();
  const { data: request } = await db
    .from("work_change_requests")
    .select("id, org_id, requested_by_user_id")
    .eq("id", requestId)
    .single();
  if (!request) return { success: false, error: "Anmodning ikke fundet" };

  // Rollen bestemmes af HVILKEN side der kalder (admin vs portal), ikke af hvem der
  // oprettede requesten — ellers fejler mark-læst når admin selv er medlemmet.
  if (viewerRole === "admin") {
    const { data: roles } = await db
      .from("user_org_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("org_id", request.org_id);
    if (!(roles ?? []).some(r => WORK_ADMIN_ROLES.includes(r.role))) return { success: false, error: "Ikke autoriseret" };
  } else if (request.requested_by_user_id !== user.id) {
    return { success: false, error: "Ikke autoriseret" };
  }

  const now = new Date().toISOString();
  const asMember = viewerRole === "member";
  // Medlem markerer admin-beskeder læst; admin markerer medlem-beskeder læst.
  const { error } = await db
    .from("work_change_request_comments")
    .update(asMember ? { member_read_at: now } : { admin_read_at: now })
    .eq("request_id", requestId)
    .eq("author_role", asMember ? "admin" : "member")
    .is(asMember ? "member_read_at" : "admin_read_at", null);

  if (error) return { success: false, error: error.message };

  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/admin/vaerker");
  return { success: true };
}

// Admin-svar på en værk-request UDEN at ændre status (kan bruges på enhver request,
// også godkendte/beskeder). Godkend/afvis håndteres separat af reviewWorkDataCorrection.
export async function addAdminWorkRequestComment(params: { requestId: string; message: string }) {
  const { supabase, user } = await currentUser();
  const admin = await assertAdminRole(supabase);
  if (!admin) throw new Error("Mangler adminrettigheder.");

  const message = cleanText(params.message);
  if (!message) throw new Error("Skriv en besked.");

  const db = createServiceClient();
  const { data: comment, error } = await db
    .from("work_change_request_comments")
    .insert({
      request_id: params.requestId,
      author_user_id: user.id,
      author_role: "admin",
      message,
      admin_read_at: new Date().toISOString(),
    })
    .select("id, author_role, message, created_at, member_read_at, admin_read_at")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/admin/vaerker");
  revalidatePath("/portal/mine-vaerker");
  return { success: true, comment };
}
