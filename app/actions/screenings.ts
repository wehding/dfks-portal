"use server";

/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy Supabase or external API payloads are normalized at this module boundary. */
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isScreeningSourceRowId } from "@/lib/screening-source-row";
import { revalidatePath } from "next/cache";
import { sendMemberNotification } from "@/lib/member-notifications";
import { resolveOrgId } from "@/lib/org";
import { normalizeScreeningTitle } from "@/lib/screening-utils";
import type { FilterRule } from "@/lib/streaming-types";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

const ADMIN_ROLES = ["superadmin", "admin", "org-admin", "jurist"];

async function findScreeningSourceMatch(db: ReturnType<typeof createServiceClient>, params: {
  orgId: string; title: string; channel: string; screeningDate: string; season?: number | null; episode?: number | null;
}) {
  const normalizedTitle = normalizeScreeningTitle(params.title);
  const { data } = await db.from("screening_source_rows")
    .select("id,title,channel,screening_date,season,episode")
    .eq("org_id", params.orgId)
    .eq("normalized_title", normalizedTitle)
    .limit(50);
  const candidates = (data ?? []).map(row => {
    let score = 60;
    if (row.screening_date === params.screeningDate) score += 20;
    if (row.channel && normalizeScreeningTitle(row.channel) === normalizeScreeningTitle(params.channel)) score += 10;
    if (params.season != null && row.season === params.season) score += 5;
    if (params.episode != null && row.episode === params.episode) score += 5;
    return { row, score };
  }).sort((a, b) => b.score - a.score);
  return candidates[0]?.score >= 80 ? candidates[0] : null;
}

async function currentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function isUserAdmin(userId: string, orgId?: string | null) {
  const db = createServiceClient();
  let query = db
    .from("user_org_roles")
    .select("role")
    .eq("user_id", userId);
  if (orgId) {
    query = query.eq("org_id", orgId);
  }
  const { data } = await query;
  return (data ?? []).some(row => ADMIN_ROLES.includes(row.role));
}

async function userOrgId(userId: string) {
  const db = createServiceClient();
  return resolveOrgId(db, userId);
}

export async function fetchMemberScreeningOptions() {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke autoriseret", works: [], broadcasters: [] };
  const db = createServiceClient();
  const orgId = await userOrgId(user.id);
  if (!orgId) return { success: false, error: "Ingen organisation", works: [], broadcasters: [] };
  const { data: holder } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).maybeSingle();
  const [{ data: assignments }, { data: broadcasters }] = await Promise.all([
    holder ? db.from("work_assignments").select("works(id,title,type,year)").eq("rights_holder_id", holder.id).eq("org_id", orgId) : Promise.resolve({ data: [] }),
    db.from("broadcasters").select("id,name,logo_path").or(`org_id.is.null,org_id.eq.${orgId}`).order("name"),
  ]);
  const assignmentWorks = (assignments ?? []).flatMap(row => Array.isArray(row.works) ? row.works : row.works ? [row.works] : []);
  const works = Array.from(new Map(assignmentWorks.map(work => [work.id, work])).values());
  await recordSensitiveFlow({
    actor: { userId: user.id, orgId, role: "member", source: "portal" }, action: "read",
    component: "portal.screening_options", entityType: "screening_option", targetMemberUuid: holder?.id ?? null,
    purposeCode: "screening_claim", legalBasis: "gdpr_art_6_1_b",
    dataCategories: ["work_data", "membership_data"], counts: { works: works.length, broadcasters: broadcasters?.length ?? 0 },
  });
  return { success: true, works, broadcasters: broadcasters ?? [] };
}

export async function fetchMemberScreeningClaims() {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke autoriseret" };

  const db = createServiceClient();
  const orgId = await userOrgId(user.id);
  const { data: holder } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).maybeSingle();
  const { data: claims, error } = await db
    .from("screening_claims")
    .select(`
      *,
      works(type),
      screening_claim_comments(*)
    `)
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Fejl ved hentning af visningskrav:", error);
    return { success: false, error: error.message };
  }

  // Sorter kommentarer kronologisk
  const processed = (claims ?? []).map(c => ({
    ...c,
    screening_claim_comments: (c.screening_claim_comments ?? []).sort(
      (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ),
  }));

  await recordSensitiveFlow({
    actor: { userId: user.id, orgId, role: "member", source: "portal" }, action: "read",
    component: "portal.screening_claims", entityType: "screening_claim", targetMemberUuid: holder?.id ?? null,
    purposeCode: "screening_claim", legalBasis: "gdpr_art_6_1_b",
    dataCategories: ["screening_data", "message_data"], counts: { results: processed.length },
  });

  return { success: true, claims: processed };
}

export async function createScreeningClaim(params: {
  workId: string;
  broadcasterId?: string | null;
  title: string;
  channel: string;
  screeningDate: string;
  note?: string;
  season?: number | null;
  episode?: number | null;
  initialComment?: string;
}) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke autoriseret" };

  const db = createServiceClient();
  const orgId = await userOrgId(user.id);
  if (!orgId) return { success: false, error: "Ingen organisation" };
  const { data: holder } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).maybeSingle();
  const { data: assignment } = holder ? await db.from("work_assignments").select("id").eq("org_id", orgId).eq("rights_holder_id", holder.id).eq("work_id", params.workId).maybeSingle() : { data: null };
  if (!assignment) return { success: false, error: "Du kan kun indberette visninger på dine egne værker" };
  
  const sourceMatch = await findScreeningSourceMatch(db, {
    orgId, title: params.title, channel: params.channel, screeningDate: params.screeningDate,
    season: params.season, episode: params.episode,
  });

  // Opret krav
  const { data: claim, error } = await db
    .from("screening_claims")
    .insert({
      profile_id: user.id,
      org_id: orgId,
      work_id: params.workId,
      broadcaster_id: params.broadcasterId ?? null,
      title: params.title,
      channel: params.channel,
      screening_date: params.screeningDate,
      season: params.season ?? null,
      episode: params.episode ?? null,
      status: "pending",
      note: params.note?.trim() || null,
      source_match_status: sourceMatch ? "found" : "not_found",
      source_row_id: sourceMatch?.row.id ?? null,
      source_match_score: sourceMatch?.score ?? null,
      source_checked_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !claim) {
    console.error("Fejl ved oprettelse af visningskrav:", error);
    return { success: false, error: error?.message ?? "Kunne ikke oprette indberetning" };
  }

  // Hvis der er en indledende kommentar, opret den
  if (params.initialComment?.trim()) {
    const { error: commentErr } = await db
      .from("screening_claim_comments")
      .insert({
        claim_id: claim.id,
        author_user_id: user.id,
        author_role: "member",
        message: params.initialComment.trim(),
      });

    if (commentErr) {
      console.error("Fejl ved oprettelse af indledende kommentar:", commentErr);
      await db.from("screening_claims").delete().eq("id", claim.id);
      return { success: false, error: commentErr.message };
    }
  }

  revalidatePath("/portal/mine-visninger");
  return { success: true, claim };
}

export async function importScreeningSourceRows(params: {
  source: string;
  batchKey: string;
  rows: Array<{
    title: string; channel?: string; screeningDate?: string; season?: number; episode?: number;
    productionYear?: number; duration?: number; viewCount?: number;
    productionCountries?: string[]; directors?: string[]; primaryDirector?: string; genre?: string; category?: string;
    description?: string; productionCompanies?: string[]; imdbId?: string;
    broadcastTime?: string; listingId?: string; seriesId?: string; episodeId?: string;
    originalTitle?: string; episodeTitle?: string; actors?: string; editorialLink?: string;
    broadcastTitle?: string;
  }>;
}) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke autoriseret" };
  const orgId = await userOrgId(user.id);
  if (!orgId || !(await isUserAdmin(user.id, orgId))) return { success: false, error: "Ikke autoriseret" };
  const db = createServiceClient();
  const rows = params.rows.filter(row => row.title.trim()).map(row => ({
    org_id: orgId,
    source: params.source,
    batch_key: params.batchKey,
    title: row.title.trim(),
    normalized_title: normalizeScreeningTitle(row.title),
    channel: row.channel?.trim() || null,
    screening_date: row.screeningDate || null,
    season: row.season ?? null,
    episode: row.episode ?? null,
    production_year: row.productionYear ?? null,
    duration_minutes: row.duration ?? null,
    view_count: row.viewCount ?? null,
    production_countries: row.productionCountries?.length ? row.productionCountries : null,
    directors: row.directors?.length ? row.directors : null,
    primary_director: row.primaryDirector?.trim() || null,
    genre: row.genre?.trim() || null,
    category: row.category?.trim() || null,
    description: row.description?.trim() || null,
    production_companies: row.productionCompanies?.length ? row.productionCompanies : null,
    imdb_id: row.imdbId?.trim() || null,
    broadcast_time: row.broadcastTime?.trim() || null,
    listing_id: row.listingId?.trim() || null,
    series_id: row.seriesId?.trim() || null,
    episode_id: row.episodeId?.trim() || null,
    original_title: row.originalTitle?.trim() || null,
    episode_title: row.episodeTitle?.trim() || null,
    actors: row.actors?.trim() || null,
    editorial_link: row.editorialLink?.trim() || null,
    broadcast_title: row.broadcastTitle?.trim() || null,
  }));
  const chunkSize = 1000;
  for (let index = 0; index < rows.length; index += chunkSize) {
    // upsert (ikke insert) — rækker med samme org_id/source/listing_id opdateres
    // i stedet for at duplikere, ved genimport af samme kildefil. Rækker uden
    // listing_id (null) rammer aldrig konflikten og indsættes som normalt.
    const { error } = await db.from("screening_source_rows")
      .upsert(rows.slice(index, index + chunkSize), { onConflict: "org_id,source,listing_id" });
    if (error) return { success: false, error: error.message };
  }
  revalidatePath("/admin/aftalelicens");
  return { success: true, count: rows.length };
}

export async function addScreeningClaimComment(params: {
  claimId: string;
  message: string;
  authorRole: "member" | "admin";
}) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke autoriseret" };

  const db = createServiceClient();

  const { data: claim } = await db.from("screening_claims").select("profile_id,org_id").eq("id", params.claimId).single();
  if (!claim) return { success: false, error: "Indberetningen findes ikke" };
  const adminOrgId = params.authorRole === "admin" ? await userOrgId(user.id) : null;
  const admin = params.authorRole === "admin" && await isUserAdmin(user.id, claim.org_id) && adminOrgId === claim.org_id;
  const member = params.authorRole === "member" && claim.profile_id === user.id;
  if (!admin && !member) return { success: false, error: "Ikke autoriseret til dette krav" };
  if (!params.message.trim()) return { success: false, error: "Skriv en besked" };

  const { data: comment, error } = await db
    .from("screening_claim_comments")
    .insert({
      claim_id: params.claimId,
      author_user_id: user.id,
      author_role: params.authorRole,
      message: params.message.trim(),
      member_read_at: params.authorRole === "member" ? new Date().toISOString() : null,
      admin_read_at: params.authorRole === "admin" ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (error) {
    console.error("Fejl ved tilføjelse af kommentar:", error);
    return { success: false, error: error.message };
  }

  if (params.authorRole === "admin") {
    const { data: holder } = await db.from("rettighedshavere").select("id,org_affiliations!inner(org_id)").eq("user_id", claim.profile_id).eq("org_affiliations.org_id", claim.org_id).maybeSingle();
    if (holder) {
      try {
        await sendMemberNotification({ eventKey: `screening-comment:${comment.id}`, eventType: "screening_admin_reply", orgId: claim.org_id, rightsHolderId: holder.id, category: "transactional", subject: "DFKS har svaret på din visningsindberetning", bodyText: "Der er kommet et nyt svar til din visningsindberetning i portalen.", path: `/portal/mine-visninger?claim=${params.claimId}`, entityType: "screening_claim", entityId: params.claimId });
      } catch (notificationError) {
        console.error("[notification] visningssvar kunne ikke sendes", notificationError);
      }
    }
  }

  revalidatePath("/portal/mine-visninger");
  revalidatePath("/admin/aftalelicens");
  return { success: true, comment };
}

export async function markScreeningClaimCommentsRead(claimId: string, role: "member" | "admin") {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke autoriseret" };

  const db = createServiceClient();
  const { data: claim } = await db.from("screening_claims").select("profile_id,org_id").eq("id", claimId).single();
  if (!claim) return { success: false, error: "Indberetningen findes ikke" };
  if (role === "member" && claim.profile_id !== user.id) return { success: false, error: "Ikke autoriseret" };
  if (role === "admin") {
    const orgId = await userOrgId(user.id);
    if (!(await isUserAdmin(user.id, claim.org_id)) || orgId !== claim.org_id) return { success: false, error: "Ikke autoriseret" };
  }
  const now = new Date().toISOString();

  const updateField = role === "member" ? "member_read_at" : "admin_read_at";
  const searchRole = role === "member" ? "admin" : "member";

  const { error } = await db
    .from("screening_claim_comments")
    .update({ [updateField]: now })
    .eq("claim_id", claimId)
    .eq("author_role", searchRole)
    .is(updateField, null);

  if (error) {
    console.error("Fejl ved markering af kommentarer som læst:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function fetchAdminScreeningClaims() {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke autoriseret" };

  const orgId = await userOrgId(user.id);
  if (!orgId) return { success: false, error: "Ingen organisation" };
  const isAdmin = await isUserAdmin(user.id, orgId);
  if (!isAdmin) return { success: false, error: "Ikke autoriseret som admin" };

  const db = createServiceClient();
  
  // Hent alle krav og koble med profil og kommentarer
  const { data: claims, error } = await db
    .from("screening_claims")
    .select(`
      *,
      works(type),
      screening_claim_comments(*)
    `)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Fejl ved hentning af admin visningskrav:", error);
    return { success: false, error: error.message };
  }

  // Sorter kommentarer kronologisk
  const processed = (claims ?? []).map(c => ({
    ...c,
    screening_claim_comments: (c.screening_claim_comments ?? []).sort(
      (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ),
  }));

  return { success: true, claims: processed };
}

export async function updateScreeningClaimStatus(claimId: string, status: "approved" | "rejected") {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke autoriseret" };

  const orgId = await userOrgId(user.id);
  if (!orgId) return { success: false, error: "Ingen organisation" };
  const isAdmin = await isUserAdmin(user.id, orgId);
  if (!isAdmin) return { success: false, error: "Ikke autoriseret som admin" };

  const db = createServiceClient();
  const { error } = await db
    .from("screening_claims")
    .update({ status, reviewed_by: user.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", claimId)
    .eq("org_id", orgId);

  if (error) {
    console.error("Fejl ved opdatering af kravstatus:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/portal/mine-visninger");
  revalidatePath("/admin/aftalelicens");
  return { success: true };
}

// ── Aftalelicens batch-historik ─────────────────────────────────────────
// Erstatter den tidligere localStorage-baserede batch-liste (dfks_batches) —
// se migration 20260820180000_aftalelicens_batches.sql for baggrund.

export async function createAftalelicensBatch(batch: {
  id: string; kilde: string; year: number; totalRows: number; filteredRows: number;
  status: "imported" | "sorting" | "weighted" | "completed"; notes?: string;
}) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const orgId = await userOrgId(user.id);
  if (!orgId) return { success: false, error: "Ingen organisation" };
  const isAdmin = await isUserAdmin(user.id, orgId);
  if (!isAdmin) return { success: false, error: "Ikke autoriseret som admin" };

  const db = createServiceClient();
  const { error } = await db.from("aftalelicens_batches").insert({
    id: batch.id,
    org_id: orgId,
    kilde: batch.kilde,
    year: batch.year,
    uploaded_by: user.id,
    total_rows: batch.totalRows,
    filtered_rows: batch.filteredRows,
    status: batch.status,
    notes: batch.notes ?? null,
  });

  if (error) {
    console.error("Fejl ved oprettelse af aftalelicens-batch:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/admin/aftalelicens");
  return { success: true };
}

export async function fetchAftalelicensBatches() {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind", batches: [] as const };
  const orgId = await userOrgId(user.id);
  if (!orgId) return { success: false, error: "Ingen organisation", batches: [] as const };
  const isAdmin = await isUserAdmin(user.id, orgId);
  if (!isAdmin) return { success: false, error: "Ikke autoriseret som admin", batches: [] as const };

  const db = createServiceClient();
  const { data, error } = await db
    .from("aftalelicens_batches")
    .select("id, kilde, year, uploaded_at, uploaded_by, total_rows, filtered_rows, status, notes")
    .eq("org_id", orgId)
    .order("uploaded_at", { ascending: false });

  if (error) {
    console.error("Fejl ved hentning af aftalelicens-batches:", error);
    return { success: false, error: error.message, batches: [] as const };
  }

  return { success: true, batches: data ?? [] };
}

export async function fetchAftalelicensBatch(id: string) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind", batch: null };
  const orgId = await userOrgId(user.id);
  if (!orgId) return { success: false, error: "Ingen organisation", batch: null };
  const isAdmin = await isUserAdmin(user.id, orgId);
  if (!isAdmin) return { success: false, error: "Ikke autoriseret som admin", batch: null };

  const db = createServiceClient();
  const { data, error } = await db
    .from("aftalelicens_batches")
    .select("id, kilde, year, uploaded_at, uploaded_by, total_rows, filtered_rows, status, notes")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Fejl ved hentning af aftalelicens-batch:", error);
    return { success: false, error: error.message, batch: null };
  }

  return { success: true, batch: data ?? null };
}

export async function fetchScreeningSourceRowsForBatch(batchKey: string) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind", rows: [] as const };
  const isAdmin = await isUserAdmin(user.id);
  if (!isAdmin) return { success: false, error: "Ikke autoriseret som admin", rows: [] as const };
  const orgId = await userOrgId(user.id);
  if (!orgId) return { success: false, error: "Ingen organisation", rows: [] as const };

  const db = createServiceClient();
  const { data, error } = await db
    .from("screening_source_rows")
    .select("id, title, normalized_title, channel, screening_date, broadcast_time, duration_minutes, view_count, season, episode, episode_id, episode_title, production_year, category, genre, description, production_countries, directors, actors, sort_status, vaerk_type, sorted_by, sorted_at")
    .eq("org_id", orgId)
    .eq("batch_key", batchKey)
    .order("screening_date")

  if (error) {
    console.error("Fejl ved hentning af screening_source_rows for batch:", error);
    return { success: false, error: error.message, rows: [] as const };
  }

  return { success: true, rows: data ?? [] };
}

type BatchFilterConfig = { localRules: FilterRule[]; disabledGlobalRuleIds: string[] };

function normalizeBatchFilterConfig(value: unknown): BatchFilterConfig {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const localRules = Array.isArray(raw.localRules) ? raw.localRules.flatMap((row): FilterRule[] => {
    if (!row || typeof row !== "object") return [];
    const rule = row as Record<string, unknown>;
    const type = rule.type;
    if (typeof rule.id !== "string" || typeof rule.name !== "string" || typeof rule.value !== "string"
      || !["title_keyword", "title_regex", "channel"].includes(String(type))) return [];
    return [{
      id: rule.id,
      name: rule.name.trim(),
      type: type as FilterRule["type"],
      value: rule.value.trim(),
      active: rule.active !== false,
      createdAt: typeof rule.createdAt === "string" ? rule.createdAt : new Date().toISOString(),
      scope: "local",
    }];
  }).filter(rule => rule.name && rule.value).slice(0, 500) : [];
  const disabledGlobalRuleIds = Array.isArray(raw.disabledGlobalRuleIds)
    ? Array.from(new Set(raw.disabledGlobalRuleIds.filter((id): id is string => typeof id === "string"))).slice(0, 500)
    : [];
  return { localRules, disabledGlobalRuleIds };
}

export async function getAftalelicensBatchFilterConfig(batchKey: string) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke autoriseret", config: normalizeBatchFilterConfig(null) };
  const orgId = await userOrgId(user.id);
  if (!orgId || !(await isUserAdmin(user.id, orgId))) return { success: false, error: "Ikke autoriseret", config: normalizeBatchFilterConfig(null) };
  const db = createServiceClient();
  const { data, error } = await db.from("aftalelicens_batches").select("filter_config").eq("id", batchKey).eq("org_id", orgId).maybeSingle();
  if (error || !data) return { success: false, error: error?.message ?? "Datasættet blev ikke fundet", config: normalizeBatchFilterConfig(null) };
  return { success: true, config: normalizeBatchFilterConfig(data.filter_config) };
}

export async function updateAftalelicensBatchFilterConfig(batchKey: string, config: BatchFilterConfig) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke autoriseret" };
  const orgId = await userOrgId(user.id);
  if (!orgId || !(await isUserAdmin(user.id, orgId))) return { success: false, error: "Ikke autoriseret" };
  const normalized = normalizeBatchFilterConfig(config);
  const db = createServiceClient();
  const { data, error } = await db.from("aftalelicens_batches")
    .update({ filter_config: normalized })
    .eq("id", batchKey)
    .eq("org_id", orgId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { success: false, error: error?.message ?? "Datasættet blev ikke fundet" };
  revalidatePath(`/admin/aftalelicens/${batchKey}`);
  return { success: true, config: normalized };
}

export type ScreeningSourceRowSortUpdate = {
  id: string;
  sortStatus: "pending" | "approved" | "rejected" | "flagged";
  vaerkType: string | null;
  sortedBy: string | null;
};

export async function updateScreeningSourceRowSortStates(updates: ScreeningSourceRowSortUpdate[]) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind", failedIds: updates.map(update => update.id) };
  const orgId = await userOrgId(user.id);
  if (!orgId) return { success: false, error: "Ingen organisation", failedIds: updates.map(update => update.id) };
  const isAdmin = await isUserAdmin(user.id, orgId);
  if (!isAdmin) return { success: false, error: "Ikke autoriseret som admin", failedIds: updates.map(update => update.id) };

  const uniqueUpdates = Array.from(new Map(updates.map(update => [update.id, update])).values());
  if (uniqueUpdates.length === 0) return { success: true, failedIds: [] as string[] };
  const invalidIds = uniqueUpdates.filter(update => !isScreeningSourceRowId(update.id)).map(update => update.id);
  if (invalidIds.length > 0) {
    return { success: false, error: "En eller flere sorteringsrækker er ugyldige", failedIds: invalidIds };
  }
  if (uniqueUpdates.length > 2_000) {
    return { success: false, error: "For mange sorteringsændringer på én gang", failedIds: uniqueUpdates.map(update => update.id) };
  }

  const db = createServiceClient();
  const failedIds: string[] = [];
  const chunkSize = 50;

  for (let index = 0; index < uniqueUpdates.length; index += chunkSize) {
    const chunk = uniqueUpdates.slice(index, index + chunkSize);
    const results = await Promise.all(chunk.map(update => db
      .from("screening_source_rows")
      .update({
        sort_status: update.sortStatus,
        vaerk_type: update.vaerkType,
        sorted_by: update.sortedBy,
        sorted_at: update.sortStatus === "pending" ? null : new Date().toISOString(),
      })
      .eq("id", update.id)
      .eq("org_id", orgId)
      .select("id")
      .maybeSingle()));

    results.forEach((result, resultIndex) => {
      if (result.error || !result.data) {
        failedIds.push(chunk[resultIndex].id);
        console.error("Fejl ved gem af sorteringsstatus:", result.error ?? { id: chunk[resultIndex].id, reason: "Rækken blev ikke fundet" });
      }
    });
  }

  if (failedIds.length > 0) {
    return { success: false, error: `${failedIds.length} sorteringsændring(er) kunne ikke gemmes`, failedIds };
  }

  return { success: true, failedIds: [] as string[] };
}

// ── Værk-/kontrakt-data til aftalelicens-matching ────────────────────────
// Erstatter tidligere mockWorks/mockContracts i autoMatch()/buildWorkIndex()/
// buildContractIndex()/findFuzzyMatches() — parring af sorterede titler mod
// egne, registrerede værker og validerede kontrakter skal ske mod rigtig
// data, ikke eksempeldata.

export type MatchingWorkRow = { id: string; title: string; type?: string; year?: number; duration_minutes?: number };
export type MatchingContractRow = { id: string; userId?: string; userName: string; title: string; category?: string; creditedRoles: string[]; duration?: number; premiereYear?: number };

export async function fetchWorksAndContractsForMatching() {
  const user = await currentUser();
  const empty = { works: [] as MatchingWorkRow[], contracts: [] as MatchingContractRow[] };
  if (!user) return { success: false, error: "Ikke logget ind", ...empty };
  const orgId = await userOrgId(user.id);
  if (!orgId) return { success: false, error: "Ingen organisation", ...empty };
  const isAdmin = await isUserAdmin(user.id, orgId);
  if (!isAdmin) return { success: false, error: "Ikke autoriseret som admin", ...empty };

  const db = createServiceClient();

  const { data: works, error: worksError } = await db
    .from("works")
    .select("id, title, type, year, duration_minutes")
    .eq("org_id", orgId);
  if (worksError) {
    console.error("Fejl ved hentning af works til matching:", worksError);
    return { success: false, error: worksError.message, ...empty };
  }

  const { data: contractRows, error: contractsError } = await db
    .from("contracts")
    .select(`
      id, rights_holder_id, work_id,
      works ( title, type, year, duration_minutes ),
      rettighedshavere ( full_name ),
      contract_validations ( extracted_data )
    `)
    .eq("org_id", orgId)
    .in("status", ["valideret", "arkiveret"])
    .not("work_id", "is", null);
  if (contractsError) {
    console.error("Fejl ved hentning af contracts til matching:", contractsError);
    return { success: false, error: contractsError.message, ...empty };
  }

  const contracts = (contractRows ?? []).map(c => {
    const work = Array.isArray(c.works) ? c.works[0] : c.works;
    const rh = Array.isArray(c.rettighedshavere) ? c.rettighedshavere[0] : c.rettighedshavere;
    const validation = Array.isArray(c.contract_validations) ? c.contract_validations[0] : c.contract_validations;
    const extracted = (validation?.extracted_data ?? {}) as Record<string, unknown>;
    const creditedRolesRaw = extracted.creditedRoles ?? extracted.creditedFunction;
    const creditedRoles = typeof creditedRolesRaw === "string"
      ? creditedRolesRaw.split(/[,/]/).map(s => s.trim()).filter(Boolean)
      : Array.isArray(creditedRolesRaw) ? creditedRolesRaw as string[] : [];
    return {
      id: c.id,
      userId: c.rights_holder_id,
      userName: rh?.full_name ?? "Ukendt",
      title: work?.title ?? "",
      category: work?.type,
      creditedRoles,
      duration: work?.duration_minutes,
      premiereYear: work?.year,
    };
  }).filter(c => c.title);

  return {
    success: true,
    works: (works ?? []).map(w => ({
      id: w.id, title: w.title,
      type: w.type ?? undefined, year: w.year ?? undefined, duration_minutes: w.duration_minutes ?? undefined,
    })),
    contracts: contracts.map(c => ({
      ...c,
      userId: c.userId ?? undefined, category: c.category ?? undefined,
      duration: c.duration ?? undefined, premiereYear: c.premiereYear ?? undefined,
    })),
  };
}
