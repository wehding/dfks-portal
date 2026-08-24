import "server-only";

import { getDFIFilmDetails, searchDFIFilms } from "@/app/actions/dfi";
import { getTMDBWorkDetails, searchTMDBWithStatus } from "@/app/actions/tmdb";
import { cleanDfiTitle, extractDfiPremiereYear, mapDfiWorkType } from "@/lib/dfi-metadata";
import type { createServiceClient } from "@/lib/supabase/service";
import { isEligibleWorkShareRole, isMissingWorkCreditCacheSchemaError, normalizeCreditName, reconcileWorkCredits, resolveRightsHolderCreditMatch, type WorkCreditCandidate } from "@/lib/work-share-reconciliation";
import type { ReconciledWorkCredit } from "@/lib/work-share-reconciliation";
import { normalizeWorkEditorRole } from "@/lib/work-editor-roles";

type ServiceClient = ReturnType<typeof createServiceClient>;
type CreditSource = "dfi" | "tmdb";

const CREDIT_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

export type WorkCreditSourceState = {
  source: CreditSource;
  status: "missing" | "fresh" | "stale" | "refreshing" | "error";
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  errorCode: string | null;
};

type WorkCreditEvidenceRow = {
  source: CreditSource;
  sourceWorkId: string;
  externalPersonId: string | null;
  name: string;
  role: string;
};

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
  return isEligibleWorkShareRole(role);
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

function sourceErrorCode(source: CreditSource, error: unknown) {
  const message = error instanceof Error ? error.message.toLocaleLowerCase("da-DK") : "";
  if (message.includes("api_key") || message.includes("mangler")) return `${source}_configuration`;
  if (message.includes("timeout") || message.includes("abort")) return `${source}_timeout`;
  return `${source}_unavailable`;
}

export async function getWorkCreditSourceStates(db: ServiceClient, params: { orgId: string; workIds: string[] }) {
  if (!params.workIds.length) return new Map<string, WorkCreditSourceState[]>();
  const { data, error } = await db.from("work_credit_source_syncs")
    .select("work_id,source,status,last_success_at,last_attempt_at,last_error_code,lease_expires_at")
    .eq("org_id", params.orgId).in("work_id", params.workIds);
  if (error) {
    if (isMissingWorkCreditCacheSchemaError(error)) {
      return new Map(params.workIds.map(workId => [workId, (["dfi", "tmdb"] as const).map(source => ({
        source, status: "missing" as const, lastSuccessAt: null, lastAttemptAt: null, errorCode: null,
      }))]));
    }
    throw new Error(error.message);
  }
  const byWork = new Map<string, WorkCreditSourceState[]>();
  for (const workId of params.workIds) byWork.set(workId, []);
  for (const row of data ?? []) {
    const successTime = row.last_success_at ? new Date(row.last_success_at).getTime() : 0;
    const leaseActive = row.status === "refreshing" && Boolean(row.lease_expires_at) && new Date(row.lease_expires_at).getTime() > Date.now();
    const status: WorkCreditSourceState["status"] = leaseActive
      ? "refreshing"
      : row.status === "error"
        ? "error"
        : successTime && Date.now() - successTime <= CREDIT_CACHE_MS
          ? "fresh"
          : successTime ? "stale" : "missing";
    byWork.get(row.work_id)?.push({
      source: row.source as CreditSource,
      status,
      lastSuccessAt: row.last_success_at,
      lastAttemptAt: row.last_attempt_at,
      errorCode: row.last_error_code,
    });
  }
  for (const states of byWork.values()) {
    for (const source of ["dfi", "tmdb"] as const) {
      if (!states.some(state => state.source === source)) states.push({ source, status: "missing", lastSuccessAt: null, lastAttemptAt: null, errorCode: null });
    }
    states.sort((left, right) => left.source.localeCompare(right.source));
  }
  return byWork;
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

async function collectDfiEvidence(work: Record<string, unknown>): Promise<WorkCreditEvidenceRow[]> {
  let dfiId = work.dfi_id ? String(work.dfi_id) : null;
  if (!dfiId && work.year && work.type) {
    const result = await searchDFIFilms(String(work.title));
    if (!result.success) {
      if (result.error === "Ingen film fundet.") return [];
      throw new Error(result.error ?? "DFI kunne ikke kontaktes.");
    }
    const matches = (result.results ?? []).filter(candidate => {
      const row = candidate as unknown as Record<string, unknown>;
      return titleMatches([cleanDfiTitle(candidate.Title ?? candidate.DanishTitle), String(row.OriginalTitle ?? "")], [String(work.title), String(work.dfi_original_title ?? "")])
        && extractDfiPremiereYear(candidate) === work.year
        && workTypeMatches(String(work.type), mapDfiWorkType(candidate.Category, candidate.Type));
    });
    if (matches.length !== 1) return [];
    dfiId = String(matches[0].Id);
  }
  if (!dfiId) return [];
  let metadata: unknown = work.dfi_metadata;
  const details = await getDFIFilmDetails(Number(dfiId));
  if (details.success && details.film) metadata = details.film;
  else if (!metadata) throw new Error(details.error ?? "DFI-detaljer kunne ikke hentes.");
  return extractDfiEditorCredits(metadata).map(credit => ({
    source: "dfi", sourceWorkId: dfiId, externalPersonId: credit.externalPersonId, name: credit.name, role: credit.role,
  }));
}

async function collectTmdbEvidence(work: Record<string, unknown>): Promise<WorkCreditEvidenceRow[]> {
  if (!process.env.TMDB_API_KEY) throw new Error("TMDB_API_KEY mangler");
  let tmdbId = work.tmdb_id ? String(work.tmdb_id) : null;
  if (!tmdbId && work.year && work.type) {
    const result = await searchTMDBWithStatus(String(work.title));
    if (!result.success) throw new Error(result.error);
    const matches = result.results.filter(candidate => {
      const row = candidate as unknown as Record<string, unknown>;
      const date = String(row.release_date ?? row.first_air_date ?? "");
      return titleMatches([String(row.title ?? ""), String(row.name ?? ""), String(row.original_title ?? ""), String(row.original_name ?? "")], [String(work.title), String(work.dfi_original_title ?? "")])
        && Number(date.slice(0, 4)) === work.year
        && workTypeMatches(String(work.type), String(row.media_type ?? ""));
    });
    if (matches.length !== 1) return [];
    tmdbId = String(matches[0].id);
  }
  if (!tmdbId) return [];
  const mediaType = String(work.type ?? "").toLocaleLowerCase("da-DK").includes("serie") ? "tv" : "movie";
  const details = await getTMDBWorkDetails(Number(tmdbId), mediaType);
  if (!details.success) throw new Error(details.error ?? "TMDb-detaljer kunne ikke hentes.");
  return Array.isArray(details.details?.editors) ? details.details.editors.flatMap((name: unknown) => typeof name === "string" && name.trim()
    ? [{ source: "tmdb" as const, sourceWorkId: tmdbId, externalPersonId: null, name: name.trim(), role: "Klipper" }]
    : []) : [];
}

async function replaceSourceEvidence(db: ServiceClient, params: { orgId: string; workId: string; source: CreditSource; evidence: WorkCreditEvidenceRow[] }) {
  const { error } = await db.rpc("replace_work_credit_evidence", {
    p_org_id: params.orgId,
    p_work_id: params.workId,
    p_source: params.source,
    p_rows: params.evidence.map(row => ({
      source_work_id: row.sourceWorkId,
      external_person_id: row.externalPersonId ?? "",
      credited_name: row.name,
      normalized_name: normalizeCreditName(row.name),
      credited_role: row.role,
    })),
  });
  if (error) throw new Error(error.message);
}

export async function refreshWorkCreditEvidence(db: ServiceClient, params: {
  orgId: string;
  workId: string;
  force?: boolean;
}) {
  const { data: work, error } = await db.from("works")
    .select("id,title,dfi_original_title,year,type,dfi_id,tmdb_id,dfi_metadata")
    .eq("id", params.workId)
    .maybeSingle();
  if (error || !work) throw new Error(error?.message ?? "Værket findes ikke.");
  const startedAt = performance.now();
  const outcomes = await Promise.all((["dfi", "tmdb"] as const).map(async source => {
    const { data: claimed, error: claimError } = await db.rpc("claim_work_credit_source_refresh", {
      p_org_id: params.orgId, p_work_id: params.workId, p_source: source, p_force: params.force === true,
    });
    if (claimError) {
      if (isMissingWorkCreditCacheSchemaError(claimError)) {
        return { source, outcome: "migration_pending" as const, count: 0 };
      }
      throw new Error(claimError.message);
    }
    if (!claimed) return { source, outcome: "cached" as const, count: 0 };
    const sourceStartedAt = performance.now();
    try {
      const evidence = source === "dfi"
        ? await collectDfiEvidence(work as unknown as Record<string, unknown>)
        : await collectTmdbEvidence(work as unknown as Record<string, unknown>);
      await replaceSourceEvidence(db, { orgId: params.orgId, workId: params.workId, source, evidence });
      const { error: syncError } = await db.from("work_credit_source_syncs").update({
        status: "ready", last_success_at: new Date().toISOString(), lease_expires_at: null,
        next_retry_at: null, last_error_code: null, updated_at: new Date().toISOString(),
      }).eq("org_id", params.orgId).eq("work_id", params.workId).eq("source", source);
      if (syncError) throw new Error(syncError.message);
      console.info("[work-credit-refresh]", { source, outcome: "updated", count: evidence.length, durationMs: Math.round(performance.now() - sourceStartedAt) });
      return { source, outcome: "updated" as const, count: evidence.length };
    } catch (sourceError) {
      const code = sourceErrorCode(source, sourceError);
      await db.from("work_credit_source_syncs").update({
        status: "error", lease_expires_at: null, next_retry_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        last_error_code: code, updated_at: new Date().toISOString(),
      }).eq("org_id", params.orgId).eq("work_id", params.workId).eq("source", source);
      console.warn("[work-credit-refresh]", { source, outcome: "error", errorCode: code, durationMs: Math.round(performance.now() - sourceStartedAt) });
      return { source, outcome: "error" as const, count: 0, errorCode: code };
    }
  }));
  console.info("[work-credit-refresh]", { outcome: "complete", durationMs: Math.round(performance.now() - startedAt), sources: outcomes.map(row => `${row.source}:${row.outcome}`) });
  return outcomes;
}

export async function buildReconciledWorkCredits(db: ServiceClient, params: {
  orgId: string;
  workId: string;
  caseId: string;
  seasonNumber?: number | null;
}) {
  const assignmentWorkIds = [params.workId];
  if (params.seasonNumber != null) {
    const { data: seasonWorks, error: seasonError } = await db.from("works")
      .select("id")
      .eq("parent_work_id", params.workId)
      .eq("season_number", params.seasonNumber);
    if (seasonError) throw new Error(seasonError.message);
    assignmentWorkIds.push(...(seasonWorks ?? []).map(row => row.id));
  }
  const [{ data: assignments }, { data: participants }, { data: evidence }] = await Promise.all([
    db.from("work_assignments").select("rights_holder_id,role,share_percent,rettighedshavere(full_name)")
      .eq("org_id", params.orgId).in("work_id", assignmentWorkIds).not("rights_holder_id", "is", null),
    db.from("work_share_participants").select("rights_holder_id,proposed_name,role,proposed_percent,rettighedshavere!work_share_participants_rights_holder_id_fkey(full_name)")
      .eq("case_id", params.caseId).is("excluded_at", null),
    db.from("work_credit_evidence").select("source,external_person_id,credited_name,credited_role")
      .eq("org_id", params.orgId).eq("work_id", params.workId),
  ]);

  const candidates: WorkCreditCandidate[] = [];
  for (const row of assignments ?? []) {
    if (!isEligibleWorkShareRole(row.role)) continue;
    const holder = row.rettighedshavere as unknown as { full_name?: string } | null;
    if (holder?.full_name) candidates.push({ name: holder.full_name, role: row.role, source: "local", rightsHolderId: row.rights_holder_id, proposedPercent: row.share_percent });
  }
  for (const row of participants ?? []) {
    if (!isEligibleWorkShareRole(row.role)) continue;
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
  for (const row of evidence ?? []) {
    if (!isEligibleWorkShareRole(row.credited_role)) continue;
    candidates.push({ name: row.credited_name, role: row.credited_role, source: row.source as "dfi" | "tmdb", externalPersonId: row.external_person_id ? `${row.source}:${row.external_person_id}` : null });
  }
  return reconcileWorkCredits(candidates);
}

export type MatchedWorkCredit = ReconciledWorkCredit & {
  matchType: "existing" | "external_id" | "exact_name" | "unmatched" | "conflict";
};

function normalizeNameClaim(value: string) {
  return value.toLocaleLowerCase("da-DK").trim().replace(/\s+/g, " ");
}

export async function matchWorkCreditsToRightsHolders(db: ServiceClient, params: {
  orgId: string;
  credits: ReconciledWorkCredit[];
}): Promise<MatchedWorkCredit[]> {
  const parsedExternalIds = params.credits.flatMap(credit => credit.externalPersonIds.flatMap(value => {
    const separator = value.indexOf(":");
    if (separator < 1) return [];
    const source = value.slice(0, separator);
    const externalId = value.slice(separator + 1);
    return (source === "dfi" || source === "tmdb") && externalId ? [{ source, externalId }] : [];
  }));
  const claimNames = [...new Set(params.credits.map(credit => normalizeNameClaim(credit.name)).filter(Boolean))];
  const [{ data: claims, error: claimError }, { data: identities, error: identityError }] = await Promise.all([
    claimNames.length
      ? db.from("rights_holder_name_claims").select("normalized_name,rights_holder_id").in("normalized_name", claimNames)
      : Promise.resolve({ data: [], error: null }),
    parsedExternalIds.length
      ? db.from("rights_holder_external_identities").select("source,external_id,rights_holder_id")
        .in("source", [...new Set(parsedExternalIds.map(row => row.source))])
        .in("external_id", [...new Set(parsedExternalIds.map(row => row.externalId))])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (claimError || identityError) throw new Error(claimError?.message ?? identityError?.message ?? "Rettighedshavermatch fejlede.");
  const candidateHolderIds = [...new Set([
    ...(claims ?? []).map(row => row.rights_holder_id),
    ...(identities ?? []).map(row => row.rights_holder_id),
    ...params.credits.flatMap(credit => credit.rightsHolderId ? [credit.rightsHolderId] : []),
  ])];
  const { data: affiliations, error: affiliationError } = candidateHolderIds.length
    ? await db.from("org_affiliations").select("rights_holder_id").eq("org_id", params.orgId).in("rights_holder_id", candidateHolderIds)
    : { data: [], error: null };
  if (affiliationError) throw new Error(affiliationError.message);
  const allowed = new Set((affiliations ?? []).map(row => row.rights_holder_id));
  const holderIdsByClaimName = new Map<string, Set<string>>();
  for (const claim of claims ?? []) {
    if (!allowed.has(claim.rights_holder_id)) continue;
    const holders = holderIdsByClaimName.get(claim.normalized_name) ?? new Set<string>();
    holders.add(claim.rights_holder_id);
    holderIdsByClaimName.set(claim.normalized_name, holders);
  }

  return params.credits.map(credit => {
    const externalMatches = new Set<string>();
    for (const externalValue of credit.externalPersonIds) {
      const separator = externalValue.indexOf(":");
      if (separator < 1) continue;
      const source = externalValue.slice(0, separator);
      const externalId = externalValue.slice(separator + 1);
      for (const identity of identities ?? []) {
        if (identity.source === source && identity.external_id === externalId && allowed.has(identity.rights_holder_id)) externalMatches.add(identity.rights_holder_id);
      }
    }
    const nameMatches = holderIdsByClaimName.get(normalizeNameClaim(credit.name)) ?? new Set<string>();
    const match = resolveRightsHolderCreditMatch({
      existingRightsHolderId: credit.rightsHolderId,
      externalRightsHolderIds: externalMatches,
      exactNameRightsHolderIds: nameMatches,
    });
    return { ...credit, rightsHolderId: match.rightsHolderId, matchType: match.matchType };
  });
}
