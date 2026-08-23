import "server-only";

import { getDFIFilmDetails, searchDFIFilms } from "@/app/actions/dfi";
import { getTMDBWorkDetails, searchTMDB } from "@/app/actions/tmdb";
import { cleanDfiTitle, extractDfiPremiereYear, mapDfiWorkType } from "@/lib/dfi-metadata";
import type { createServiceClient } from "@/lib/supabase/service";
import { normalizeCreditName, reconcileWorkCredits, type WorkCreditCandidate } from "@/lib/work-share-reconciliation";
import { normalizeWorkEditorRole } from "@/lib/work-editor-roles";

type ServiceClient = ReturnType<typeof createServiceClient>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function isEditorRole(role: string | null) {
  const normalized = normalizeCreditName(role ?? "");
  return normalized.includes("klip") || normalized.includes("edit");
}

function workTypeMatches(workType: string | null, candidateType: string | null) {
  const workIsSeries = normalizeCreditName(workType ?? "").includes("serie");
  const candidateIsSeries = normalizeCreditName(candidateType ?? "").includes("serie") || candidateType === "tv";
  return workIsSeries === candidateIsSeries;
}

function titleMatches(candidateTitles: Array<string | null | undefined>, workTitles: Array<string | null | undefined>) {
  const candidates = new Set(candidateTitles.map(value => normalizeCreditName(value ?? "")).filter(Boolean));
  return workTitles.some(value => candidates.has(normalizeCreditName(value ?? "")));
}

export function extractDfiEditorCredits(metadata: unknown) {
  const root = record(metadata);
  const rows = Array.isArray(root?.PersonCredits) ? root.PersonCredits : [];
  return rows.flatMap(value => {
    const row = record(value);
    if (!row) return [];
    const role = text(row, ["Description", "Function", "Credit", "Role", "Type"]);
    const name = text(row, ["Name", "FullName", "PersonName"]);
    if (!name || !isEditorRole(role)) return [];
    return [{
      name,
      role: normalizeWorkEditorRole(role || "Klipper"),
      externalPersonId: text(row, ["PersonId", "PersonID", "Id", "ID"]),
    }];
  });
}

export async function refreshWorkCreditEvidence(db: ServiceClient, params: {
  orgId: string;
  workId: string;
}) {
  const { data: work, error } = await db.from("works")
    .select("id,title,dfi_original_title,year,type,dfi_id,tmdb_id,dfi_metadata")
    .eq("id", params.workId)
    .maybeSingle();
  if (error || !work) throw new Error(error?.message ?? "Værket findes ikke.");

  const evidence: Array<{
    source: "dfi" | "tmdb";
    sourceWorkId: string;
    externalPersonId: string | null;
    name: string;
    role: string;
  }> = [];
  const refreshedSources = new Set<"dfi" | "tmdb">();

  let dfiId = work.dfi_id ? String(work.dfi_id) : null;
  if (!dfiId && work.year && work.type) {
    const result = await searchDFIFilms(work.title).catch(() => null);
    const matches = result?.success ? (result.results ?? []).filter(candidate => {
      const row = candidate as unknown as Record<string, unknown>;
      return titleMatches([cleanDfiTitle(candidate.Title ?? candidate.DanishTitle), String(row.OriginalTitle ?? "")], [work.title, work.dfi_original_title])
        && extractDfiPremiereYear(candidate) === work.year
        && workTypeMatches(work.type, mapDfiWorkType(candidate.Category, candidate.Type));
    }) : [];
    if (matches.length === 1) dfiId = String(matches[0].Id);
  }

  if (dfiId) {
    let metadata: unknown = work.dfi_metadata;
    const details = await getDFIFilmDetails(Number(dfiId)).catch(() => null);
    if (details?.success && details.film) {
      metadata = details.film;
      refreshedSources.add("dfi");
    }
    for (const credit of extractDfiEditorCredits(metadata)) {
      evidence.push({ source: "dfi", sourceWorkId: dfiId, externalPersonId: credit.externalPersonId, name: credit.name, role: credit.role });
    }
  }

  let tmdbId = work.tmdb_id ? String(work.tmdb_id) : null;
  if (!tmdbId && work.year && work.type) {
    const result = await searchTMDB(work.title).catch(() => []);
    const matches = result.filter(candidate => {
      const row = candidate as unknown as Record<string, unknown>;
      const date = String(row.release_date ?? row.first_air_date ?? "");
      return titleMatches([String(row.title ?? ""), String(row.name ?? ""), String(row.original_title ?? ""), String(row.original_name ?? "")], [work.title, work.dfi_original_title])
        && Number(date.slice(0, 4)) === work.year
        && workTypeMatches(work.type, String(row.media_type ?? ""));
    });
    if (matches.length === 1) tmdbId = String(matches[0].id);
  }

  if (tmdbId) {
    const mediaType = String(work.type ?? "").toLocaleLowerCase("da-DK").includes("serie") ? "tv" : "movie";
    const details = await getTMDBWorkDetails(Number(tmdbId), mediaType).catch(() => null);
    if (details?.success && Array.isArray(details.details?.editors)) {
      refreshedSources.add("tmdb");
      for (const name of details.details.editors) {
        if (typeof name === "string" && name.trim()) evidence.push({ source: "tmdb", sourceWorkId: tmdbId, externalPersonId: null, name: name.trim(), role: "Klipper" });
      }
    }
  }

  for (const source of refreshedSources) {
    const { error: deleteError } = await db.from("work_credit_evidence")
      .delete().eq("org_id", params.orgId).eq("work_id", params.workId).eq("source", source);
    if (deleteError) throw new Error(deleteError.message);
  }

  if (evidence.length) {
    const { error: upsertError } = await db.from("work_credit_evidence").upsert(evidence.map(row => ({
      org_id: params.orgId,
      work_id: params.workId,
      source: row.source,
      source_work_id: row.sourceWorkId,
      external_person_id: row.externalPersonId ?? "",
      credited_name: row.name,
      normalized_name: normalizeCreditName(row.name),
      credited_role: row.role,
      fetched_at: new Date().toISOString(),
    })), { onConflict: "org_id,work_id,source,source_work_id,external_person_id,normalized_name" });
    if (upsertError) throw new Error(upsertError.message);
  }

  return evidence;
}

export async function buildReconciledWorkCredits(db: ServiceClient, params: {
  orgId: string;
  workId: string;
  caseId: string;
}) {
  const [{ data: assignments }, { data: participants }, { data: evidence }] = await Promise.all([
    db.from("work_assignments").select("rights_holder_id,role,share_percent,rettighedshavere(full_name)")
      .eq("org_id", params.orgId).eq("work_id", params.workId).not("rights_holder_id", "is", null),
    db.from("work_share_participants").select("rights_holder_id,proposed_name,role,proposed_percent,rettighedshavere!work_share_participants_rights_holder_id_fkey(full_name)")
      .eq("case_id", params.caseId).is("excluded_at", null),
    db.from("work_credit_evidence").select("source,external_person_id,credited_name,credited_role")
      .eq("org_id", params.orgId).eq("work_id", params.workId),
  ]);

  const candidates: WorkCreditCandidate[] = [];
  for (const row of assignments ?? []) {
    const holder = row.rettighedshavere as unknown as { full_name?: string } | null;
    if (holder?.full_name) candidates.push({ name: holder.full_name, role: row.role, source: "local", rightsHolderId: row.rights_holder_id, proposedPercent: row.share_percent });
  }
  for (const row of participants ?? []) {
    const holder = row.rettighedshavere as unknown as { full_name?: string } | null;
    const name = holder?.full_name ?? row.proposed_name;
    if (!name) continue;
    // DFI/TMDb tags are always rebuilt from the evidence snapshot below, so a
    // refreshed source cannot be kept alive by its own old participant tag.
    const sources = [row.rights_holder_id ? "local" : "member"];
    for (const source of sources) {
      if (["local", "member", "dfi", "tmdb"].includes(source)) candidates.push({ name, role: row.role, source: source as WorkCreditCandidate["source"], rightsHolderId: row.rights_holder_id, proposedPercent: row.proposed_percent });
    }
  }
  for (const row of evidence ?? []) candidates.push({ name: row.credited_name, role: row.credited_role, source: row.source as "dfi" | "tmdb", externalPersonId: row.external_person_id ? `${row.source}:${row.external_person_id}` : null });
  return reconcileWorkCredits(candidates);
}
