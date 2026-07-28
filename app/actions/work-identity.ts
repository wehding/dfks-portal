"use server";

import { revalidatePath } from "next/cache";
import { parseDfiEpisodeTitleInfo } from "@/lib/dfi-metadata";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { resolveWorkIdentity } from "@/lib/server/work-identity-resolver";
import {
  identityFingerprint,
  identityLevel,
  validImdbId,
  type IdentityCandidate,
  type IdentityResolution,
  type WorkIdentityInput,
} from "@/lib/work-identity";

type WorkRow = {
  id: string;
  org_id: string;
  title: string;
  type: string | null;
  year: number | null;
  alternative_titles: string[] | null;
  parent_work_id: string | null;
  season_number: number | null;
  episode_number: number | null;
  dfi_id: string | null;
  tmdb_id: string | number | null;
  imdb_id: string | null;
  wikidata_id: string | null;
  dfi_metadata: Record<string, unknown> | null;
};

export type WorkIdentityQueueItem = {
  id: string;
  title: string;
  type: string | null;
  year: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  imdbId: string | null;
  status: string;
  confidence: number | null;
  candidates: IdentityCandidate[];
  lastAttemptedAt: string | null;
  inheritedIdentity: boolean;
};

async function requireSuperadmin() {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin"]);
  if (!caller) throw new Error("Kun superadmin har adgang til IMDb-kontrol.");
  return caller;
}

function dfiChildForEpisode(parent: WorkRow | null, episodeNumber: number | null) {
  if (!parent?.dfi_metadata || !episodeNumber) return null;
  const children = Array.isArray(parent.dfi_metadata.Children) ? parent.dfi_metadata.Children : [];
  const rows = children.filter((child): child is Record<string, unknown> => Boolean(child && typeof child === "object"));
  return rows.find((child, index) => {
    const parsed = parseDfiEpisodeTitleInfo(typeof child.Title === "string" ? child.Title : null);
    return (parsed?.episodeNumber ?? index + 1) === episodeNumber;
  }) ?? null;
}

function childExternalValue(child: Record<string, unknown> | null, key: "Id" | "Title") {
  const value = child?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function workIdentityInput(work: WorkRow, parent: WorkRow | null): WorkIdentityInput {
  const isEpisode = Boolean(parent && work.episode_number);
  const child = dfiChildForEpisode(parent, work.episode_number);
  const childTitle = childExternalValue(child, "Title");
  const inherited = isEpisode ? {
    imdb: work.imdb_id === parent?.imdb_id,
    tmdb: String(work.tmdb_id ?? "") === String(parent?.tmdb_id ?? "") && work.tmdb_id != null,
    wikidata: work.wikidata_id === parent?.wikidata_id && work.wikidata_id != null,
    dfi: work.dfi_id === parent?.dfi_id && work.dfi_id != null,
  } : { imdb: false, tmdb: false, wikidata: false, dfi: false };

  return {
    workId: work.id,
    title: work.title,
    alternativeTitles: [...(work.alternative_titles ?? []), ...(childTitle ? [childTitle] : [])],
    year: work.year,
    type: work.type,
    imdbId: inherited.imdb ? null : work.imdb_id,
    tmdbId: inherited.tmdb ? null : work.tmdb_id,
    wikidataId: inherited.wikidata ? null : work.wikidata_id,
    dfiId: childExternalValue(child, "Id") ?? (inherited.dfi ? null : work.dfi_id),
    parent: parent ? {
      title: parent.title,
      imdbId: parent.imdb_id,
      tmdbId: parent.tmdb_id,
      wikidataId: parent.wikidata_id,
      dfiId: parent.dfi_id,
    } : null,
    seasonNumber: work.season_number,
    episodeNumber: work.episode_number,
  };
}

async function loadWork(db: ReturnType<typeof createServiceClient>, workId: string) {
  const { data, error } = await db.from("works")
    .select("id,org_id,title,type,year,alternative_titles,parent_work_id,season_number,episode_number,dfi_id,tmdb_id,imdb_id,wikidata_id,dfi_metadata")
    .eq("id", workId).single();
  if (error || !data) throw new Error(error?.message ?? "Værket blev ikke fundet.");
  const work = data as unknown as WorkRow;
  let parent: WorkRow | null = null;
  if (work.parent_work_id) {
    const parentResult = await db.from("works")
      .select("id,org_id,title,type,year,alternative_titles,parent_work_id,season_number,episode_number,dfi_id,tmdb_id,imdb_id,wikidata_id,dfi_metadata")
      .eq("id", work.parent_work_id).single();
    if (!parentResult.error && parentResult.data) parent = parentResult.data as unknown as WorkRow;
  }
  return { work, parent };
}

function externalIdType(input: WorkIdentityInput) {
  const level = identityLevel(input.type, input.parent);
  return level === "movie" ? "film_id" : level === "series" ? "series_id" : "episode_id";
}

async function findIdentityConflict(
  db: ReturnType<typeof createServiceClient>,
  workId: string,
  type: string,
  candidate: IdentityCandidate,
) {
  const ids = [
    ["imdb", candidate.imdbId],
    ["tmdb", candidate.tmdbId],
    ["wikidata", candidate.wikidataId],
    ["dfi", candidate.dfiId],
  ].filter((item): item is [string, string] => Boolean(item[1]));
  for (const [source, externalId] of ids) {
    const { data, error } = await db.from("work_external_ids").select("work_id")
      .eq("source", source).eq("external_id_type", type).eq("external_id", externalId)
      .neq("work_id", workId).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.work_id) return { source, externalId, workId: data.work_id as string };
  }
  return null;
}

function safeCandidates(candidates: IdentityCandidate[]) {
  return candidates.slice(0, 10).map(candidate => ({
    imdbId: candidate.imdbId,
    tmdbId: candidate.tmdbId ?? null,
    wikidataId: candidate.wikidataId ?? null,
    dfiId: candidate.dfiId ?? null,
    title: candidate.title.slice(0, 300),
    year: candidate.year ?? null,
    type: candidate.type ?? null,
    confidence: candidate.confidence,
    sources: candidate.sources,
    matchedBy: candidate.matchedBy,
  }));
}

async function persistResolution(
  db: ReturnType<typeof createServiceClient>,
  workId: string,
  input: WorkIdentityInput,
  resolution: IdentityResolution,
  reviewedBy?: string | null,
) {
  const { error } = await db.from("work_identity_resolutions").upsert({
    work_id: workId,
    status: resolution.status,
    input_fingerprint: identityFingerprint(input),
    confidence: resolution.confidence,
    candidates: safeCandidates(resolution.candidates),
    sources: resolution.sources,
    error_code: resolution.errorCode ?? null,
    last_attempted_at: new Date().toISOString(),
    reviewed_by: reviewedBy ?? null,
    reviewed_at: reviewedBy ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "work_id" });
  if (error) throw new Error(error.message);
}

function generatedEpisodeTitle(work: WorkRow) {
  return /\s[-–—]\sS\d{2}E\d{2}\s*$/i.test(work.title.trim());
}

async function applyCandidate(params: {
  db: ReturnType<typeof createServiceClient>;
  work: WorkRow;
  parent: WorkRow | null;
  input: WorkIdentityInput;
  candidate: IdentityCandidate;
  actor: { userId: string; orgId: string; role: string };
  manual: boolean;
}) {
  const { db, work, parent, input, candidate, actor, manual } = params;
  const idType = externalIdType(input);
  const conflict = await findIdentityConflict(db, work.id, idType, candidate);
  if (conflict) return { applied: false as const, conflict };

  const isEpisode = idType === "episode_id";
  const updates: Record<string, unknown> = { imdb_id: candidate.imdbId };
  if (candidate.wikidataId) updates.wikidata_id = candidate.wikidataId;
  else if (isEpisode && work.wikidata_id === parent?.wikidata_id) updates.wikidata_id = null;
  if (candidate.dfiId) updates.dfi_id = candidate.dfiId;
  else if (isEpisode && work.dfi_id === parent?.dfi_id) updates.dfi_id = null;
  if (!isEpisode && candidate.tmdbId) updates.tmdb_id = candidate.tmdbId;
  else if (isEpisode && String(work.tmdb_id ?? "") === String(parent?.tmdb_id ?? "") && work.tmdb_id != null) updates.tmdb_id = null;
  if (isEpisode && generatedEpisodeTitle(work) && candidate.title.trim()) {
    const season = String(work.season_number ?? 1).padStart(2, "0");
    const episode = String(work.episode_number ?? 1).padStart(2, "0");
    updates.title = `${parent?.title ?? work.title} - S${season}E${episode}: ${candidate.title.trim()}`;
  }

  const updateResult = await db.from("works").update(updates).eq("id", work.id);
  if (updateResult.error) throw new Error(updateResult.error.message);

  const externalRows = [
    ["imdb", candidate.imdbId],
    ["tmdb", candidate.tmdbId],
    ["wikidata", candidate.wikidataId],
    ["dfi", candidate.dfiId],
  ].filter((item): item is [string, string] => Boolean(item[1])).map(([source, externalId]) => ({
    org_id: work.org_id,
    work_id: work.id,
    source,
    external_id_type: idType,
    external_id: externalId,
  }));
  if (externalRows.length) {
    const identityResult = await db.from("work_external_ids").upsert(externalRows, {
      onConflict: "source,external_id_type,external_id",
    });
    if (identityResult.error) throw new Error(identityResult.error.message);
  }

  await recordAuditEvent({
    context: { actorUserId: actor.userId, actorOrgId: actor.orgId, actorRole: actor.role, source: "admin", mode: "summary" },
    action: "sync",
    entityType: "works",
    entityId: work.id,
    entityLabel: work.title,
    orgIds: [work.org_id],
    changes: [{ field: "external_identity", old: work.imdb_id ? "Eksisterende IMDb-ID" : null, new: candidate.imdbId }],
    metadata: { sources: candidate.sources, confidence: candidate.confidence, manual },
  });
  return { applied: true as const };
}

async function resolveOne(workId: string, actor: { userId: string; orgId: string; role: string }, manualCandidate?: IdentityCandidate) {
  const db = createServiceClient({ audit: {
    actorUserId: actor.userId,
    actorOrgId: actor.orgId,
    actorRole: actor.role,
    source: "admin",
    correlationId: crypto.randomUUID(),
    mode: "summary",
  } });
  const { work, parent } = await loadWork(db, workId);
  const input = workIdentityInput(work, parent);
  const resolution = manualCandidate
    ? { status: "matched" as const, confidence: manualCandidate.confidence, candidates: [manualCandidate], sources: manualCandidate.sources }
    : await resolveWorkIdentity(input);
  const candidate = resolution.status === "matched" ? resolution.candidates[0] : null;
  if (candidate) {
    const applied = await applyCandidate({ db, work, parent, input, candidate, actor, manual: Boolean(manualCandidate) });
    if (!applied.applied) {
      const conflictResolution: IdentityResolution = { ...resolution, status: "review_required", errorCode: `conflict_${applied.conflict.source}` };
      await persistResolution(db, workId, input, conflictResolution, manualCandidate ? actor.userId : null);
      return conflictResolution;
    }
  }
  await persistResolution(db, workId, input, resolution, manualCandidate ? actor.userId : null);
  return resolution;
}

export async function listWorkIdentityQueue(): Promise<WorkIdentityQueueItem[]> {
  await requireSuperadmin();
  const db = createServiceClient();
  const [{ data: works, error }, { data: resolutions, error: resolutionError }] = await Promise.all([
    db.from("works").select("id,title,type,year,parent_work_id,season_number,episode_number,imdb_id,tmdb_id,dfi_id,wikidata_id").order("created_at", { ascending: false }).limit(1000),
    db.from("work_identity_resolutions").select("work_id,status,confidence,candidates,last_attempted_at"),
  ]);
  if (error) throw new Error(error.message);
  if (resolutionError) throw new Error(resolutionError.message);
  const rows = (works ?? []) as unknown as Array<WorkRow>;
  const byId = new Map(rows.map(work => [work.id, work]));
  const resolutionByWork = new Map((resolutions ?? []).map(row => [row.work_id as string, row]));
  return rows.map(work => {
    const parent = work.parent_work_id ? byId.get(work.parent_work_id) : null;
    const inheritedIdentity = Boolean(parent && (
      (work.imdb_id && work.imdb_id === parent.imdb_id)
      || (work.dfi_id && work.dfi_id === parent.dfi_id)
      || (work.tmdb_id && String(work.tmdb_id) === String(parent.tmdb_id))
      || (work.wikidata_id && work.wikidata_id === parent.wikidata_id)
    ));
    const resolution = resolutionByWork.get(work.id);
    return {
      id: work.id,
      title: work.title,
      type: work.type,
      year: work.year,
      seasonNumber: work.season_number,
      episodeNumber: work.episode_number,
      imdbId: work.imdb_id,
      status: String(resolution?.status ?? (work.imdb_id && !inheritedIdentity ? "matched" : "unresolved")),
      confidence: typeof resolution?.confidence === "number" ? resolution.confidence : null,
      candidates: Array.isArray(resolution?.candidates) ? resolution.candidates as unknown as IdentityCandidate[] : [],
      lastAttemptedAt: typeof resolution?.last_attempted_at === "string" ? resolution.last_attempted_at : null,
      inheritedIdentity,
    };
  }).filter(item => item.status !== "matched" || item.inheritedIdentity);
}

async function mapWithConcurrency<T>(values: string[], concurrency: number, worker: (value: string) => Promise<T>) {
  const results: T[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await worker(values[index]);
    }
  }));
  return results;
}

export async function scanWorkIdentities(workIds: string[]) {
  const actor = await requireSuperadmin();
  const ids = Array.from(new Set(workIds)).filter(id => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100);
  if (!ids.length) return { success: false, error: "Vælg mindst ét værk." };
  const results = await mapWithConcurrency(ids, 3, async id => {
    try { return { id, resolution: await resolveOne(id, actor) }; }
    catch { return { id, resolution: { status: "error" as const, confidence: null, candidates: [], sources: [], errorCode: "internal" } }; }
  });
  revalidatePath("/admin/imdb-kontrol");
  return { success: true, results };
}

export async function approveWorkIdentityCandidate(workId: string, imdbId: string) {
  const actor = await requireSuperadmin();
  const db = createServiceClient();
  const { data, error } = await db.from("work_identity_resolutions").select("candidates").eq("work_id", workId).single();
  if (error || !data) return { success: false, error: "Kandidaten blev ikke fundet." };
  const candidate = (Array.isArray(data.candidates) ? data.candidates : []).find((item: unknown) => {
    return Boolean(item && typeof item === "object" && (item as { imdbId?: unknown }).imdbId === imdbId);
  }) as IdentityCandidate | undefined;
  if (!candidate || !validImdbId(candidate.imdbId)) return { success: false, error: "Kandidaten er ugyldig." };
  await resolveOne(workId, actor, { ...candidate, confidence: 100, matchedBy: Array.from(new Set([...candidate.matchedBy, "manual_approval"])) });
  revalidatePath("/admin/imdb-kontrol");
  return { success: true };
}

export async function rejectWorkIdentityCandidates(workId: string) {
  const actor = await requireSuperadmin();
  const db = createServiceClient();
  const { work, parent } = await loadWork(db, workId);
  const input = workIdentityInput(work, parent);
  await persistResolution(db, workId, input, { status: "not_found", confidence: null, candidates: [], sources: [] }, actor.userId);
  revalidatePath("/admin/imdb-kontrol");
  return { success: true };
}

export async function setManualWorkImdbId(workId: string, imdbId: string) {
  const actor = await requireSuperadmin();
  const normalizedId = imdbId.trim().toLowerCase();
  if (!validImdbId(normalizedId)) return { success: false, error: "IMDb-ID skal have formatet tt efterfulgt af 7–10 cifre." };
  const db = createServiceClient();
  const { work, parent } = await loadWork(db, workId);
  const input = workIdentityInput(work, parent);
  const candidate: IdentityCandidate = {
    imdbId: normalizedId,
    title: work.title,
    year: work.year,
    type: identityLevel(input.type, input.parent),
    tmdbId: null,
    wikidataId: null,
    dfiId: input.dfiId ?? null,
    confidence: 100,
    sources: ["manual"],
    matchedBy: ["manual_entry"],
  };
  const result = await resolveOne(workId, actor, candidate);
  if (result.status !== "matched") return { success: false, error: "IMDb-ID’et er allerede knyttet til et andet værk." };
  revalidatePath("/admin/imdb-kontrol");
  return { success: true };
}
