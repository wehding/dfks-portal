"use server";

/* eslint-disable @typescript-eslint/no-explicit-any -- Admin list rows from dynamic Supabase joins are normalized at this module boundary. */
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { headers } from "next/headers";
import { tjekNavn } from "@/lib/rettighedshaver-tjek";
import type { ProductionCompanySelection } from "@/lib/production-companies";
import { syncContractProducerRelations } from "@/lib/server/production-company-relations";
import { mergeContractWorkData, type LinkedContractWorkData } from "@/lib/contract-work-data";
import { applyApprovedAgreementRoyalty } from "@/lib/agreement-royalty-server";
import { isUuid } from "@/lib/uuid";
import { resolveDefaultRole } from "@/lib/branding";
import { buildCompleteEpisodeOptions, episodeOptionsFromLocalChildren, mergeEpisodeOptionsByPriority, parseLocalEpisodeCode } from "@/lib/series-episodes";
import { resolveExternalSeriesEpisodesForTitle } from "@/app/actions/member-works";
import { sendMemberNotification } from "@/lib/member-notifications";
import { effectiveCopydanStatus, normalizeTriState, weeklySalaryWithPersonalSupplement } from "@/lib/contract-list-status";
import { resolveSeriesScopeTarget, upsertMemberSeriesEpisodeScope } from "@/lib/server/member-series-episode-scopes";
import { auditHeadersContext } from "@/lib/audit-access-server";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { normalizeWorkEditorRole } from "@/lib/work-editor-roles";
import { extractWordText } from "@/lib/word-text";
import { extractPdfTextWithLayout } from "@/lib/pdf-parse";
import { buildPdfLayout } from "@/lib/contract-layout";
import type { ContractLayout } from "@/lib/contract-layout";
import { matchCitationToClause } from "@/lib/contract-layout-store";
import { findContractTypeEvidence, type StoredContractFieldEvidence } from "@/lib/contract-workbench";
import { mergeContractEvidence, resolveNativeLayoutEvidence, resolveSpatialV3Evidence, sanitizeStoredContractEvidence } from "@/lib/contract-field-evidence";
import { parseVerifiedSpatialV3Artifact } from "@/lib/server/contract-spatial-artifact";
import { hasActiveMemberContractOwnership, type MemberOrgAffiliation } from "@/lib/member-contract-access";
import { createHash, randomUUID } from "node:crypto";

import { requireMemberContext, requireOrgId } from "@/lib/org";
import { getContractImportStatesForOrg } from "@/lib/server/contract-import-state";
import { createListLoadTimer } from "@/lib/server/list-load-timing";
import { getRequestAppAccessContext } from "@/lib/server/request-app-access-context";
import type { ListPageResult } from "@/lib/list-query";
const BUCKET = "kontrakter"; // samme bucket som admin-validering
const MAX_CONTRACT_UPLOAD_BYTES = 25 * 1024 * 1024;
const SIGNED_UPLOAD_TOMBSTONE_MS = 135 * 60 * 1000;

type ContractExtractData = {
  contractType?: string | null;
  isFreelanceContract?: boolean | null;
  overenskomst?: string | null;
  contractDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

type MemberUploadIdentity = {
  ownerId: string;
  orgId: string;
  rightsHolderId: string;
  uploadIntentId: string;
  contractId: string;
  storagePath: string;
};

type ClaimedMemberUploadIdentity = MemberUploadIdentity & {
  finalizationToken: string;
  requestHash: string;
};

type MemberUploadFinalizationClaim = {
  outcome: "claimed" | "in_progress" | "already_finalized" | "recovery_required";
  finalization_token: string | null;
  contract_id: string;
};

const ADMIN_ROLES = ["superadmin", "admin", "org-admin", "jurist"];

function documentExtension(path: string | null | undefined) {
  const clean = (path ?? "").split("?")[0]?.split("#")[0]?.toLowerCase() ?? "";
  const match = clean.match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function stableRequestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableRequestValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableRequestValue(entry)]),
    );
  }
  return value;
}

function memberUploadRequestHash(kind: "legacy" | "guided", filePath: string, payload: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(stableRequestValue({ version: 1, kind, filePath, payload })))
    .digest("hex");
}

async function claimMemberUploadFinalization(
  db: ReturnType<typeof createServiceClient>,
  identity: MemberUploadIdentity,
  requestHash: string,
) {
  const claimToken = randomUUID();
  const claimParams = {
    p_owner_id: identity.ownerId,
    p_org_id: identity.orgId,
    p_rights_holder_id: identity.rightsHolderId,
    p_upload_intent_id: identity.uploadIntentId,
    p_contract_id: identity.contractId,
    p_storage_path: identity.storagePath,
    p_request_hash: requestHash,
    p_finalization_token: claimToken,
  };
  let result = await db.rpc("claim_member_uploaded_contract_finalization", claimParams);
  if (result.error || !result.data) {
    // Reuse the caller-generated token. If the first transaction committed but
    // its response was lost, this retry regains the same lease rather than
    // stranding the upload in an ambiguous in-progress state.
    result = await db.rpc("claim_member_uploaded_contract_finalization", claimParams);
  }
  const row = (Array.isArray(result.data) ? result.data[0] : result.data) as MemberUploadFinalizationClaim | null;
  if (result.error || !row?.outcome) {
    return { success: false as const, error: result.error?.message ?? "Uploaden kunne ikke færdiggøres." };
  }
  if (row.outcome === "in_progress") {
    return {
      success: false as const,
      inProgress: true as const,
      error: "Kontrakten er allerede ved at blive færdiggjort. Vent et øjeblik og prøv igen.",
    };
  }
  if (row.outcome === "recovery_required") {
    return {
      success: false as const,
      recoveryRequired: true as const,
      error: "Uploaden blev bevaret sikkert, men kræver kontrol hos DFKS, før den kan færdiggøres.",
    };
  }
  if (row.outcome === "already_finalized") {
    return { success: true as const, alreadyFinalized: true as const, identity: null };
  }
  if (!row.finalization_token) {
    return { success: false as const, error: "Uploadens sikre færdiggørelsestoken mangler." };
  }
  return {
    success: true as const,
    alreadyFinalized: false as const,
    identity: {
      ...identity,
      finalizationToken: row.finalization_token,
      requestHash,
    } satisfies ClaimedMemberUploadIdentity,
  };
}

async function currentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function rollbackMemberUploadedContract(
  db: ReturnType<typeof createServiceClient>,
  identity: ClaimedMemberUploadIdentity,
) {
  const result = await db.rpc("rollback_member_uploaded_contract", {
    p_owner_id: identity.ownerId,
    p_org_id: identity.orgId,
    p_rights_holder_id: identity.rightsHolderId,
    p_upload_intent_id: identity.uploadIntentId,
    p_contract_id: identity.contractId,
    p_storage_path: identity.storagePath,
    p_finalization_token: identity.finalizationToken,
  });
  return {
    confirmed: !result.error && result.data === true,
    error: result.error,
  };
}

async function rollbackMemberUploadOrReport(
  db: ReturnType<typeof createServiceClient>,
  identity: ClaimedMemberUploadIdentity,
  originalError: string,
) {
  const rollback = await rollbackMemberUploadedContract(db, identity);
  if (rollback.confirmed) return { success: false as const, error: originalError };

  console.error("Sikker rollback af medlemskontrakt kunne ikke bekræftes", {
    reason: rollback.error?.code ?? "not_confirmed",
  });
  return {
    success: false as const,
    error: "Kontrakten kunne ikke færdiggøres. Originalfilen er bevaret sikkert, så DFKS kan kontrollere uploaden.",
  };
}

async function assertAdminForOrg(db: ReturnType<typeof createServiceClient>, userId: string, orgId: string) {
  const { data } = await db
    .from("user_org_roles")
    .select("role,org_id")
    .eq("user_id", userId);
  return (data ?? []).some(row => row.role === "superadmin"
    || (row.org_id === orgId && ADMIN_ROLES.includes(row.role)));
}

async function contractValidationBlocker(
  db: ReturnType<typeof createServiceClient>,
  contract: { id: string; work_id: string | null; rights_holder_id: string | null },
) {
  if (!contract.work_id) return "Kontrakten skal have et tilknyttet værk.";
  if (!contract.rights_holder_id) return "Kontrakten skal have en tilknyttet rettighedshaver.";
  const { data: work } = await db.from("works").select("id,type,parent_work_id,season_number").eq("id", contract.work_id).maybeSingle();
  if (!String(work?.type ?? "").includes("serie")) return null;
  const { data: contractScope } = await db.from("contracts")
    .select("org_id,season_number,episode_scope_id")
    .eq("id", contract.id).maybeSingle();
  const seriesWorkId = work?.parent_work_id ?? work?.id;
  const seasonNumber = contractScope?.season_number ?? work?.season_number ?? 1;
  let scopeQuery = db.from("member_series_episode_scopes").select("id,status").eq("status", "confirmed");
  if (contractScope?.episode_scope_id) scopeQuery = scopeQuery.eq("id", contractScope.episode_scope_id);
  else scopeQuery = scopeQuery
    .eq("org_id", contractScope?.org_id)
    .eq("rights_holder_id", contract.rights_holder_id)
    .eq("series_work_id", seriesWorkId)
    .eq("season_number", seasonNumber);
  const { data: sharedScope } = await scopeQuery.maybeSingle();
  if (sharedScope) return null;
  const { data: confirmation } = await db.from("contract_episode_confirmations")
    .select("id").eq("contract_id", contract.id).is("invalidated_at", null).maybeSingle();
  return confirmation ? null : "Rettighedshaveren skal bekræfte sæson og afsnit, før seriekontrakten kan valideres.";
}

type SeriesEpisodeWork = { id: string; title: string | null; season_number: number | null; episode_number: number | null; parent_work_id: string | null };

export type AdminContractsPageParams = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  type?: string;
  rightsHolderId?: string | null;
  sortKey?: "production" | "rightsHolder" | "employer" | "type" | "overenskomst" | "period" | "status";
  sortDir?: "asc" | "desc";
  includeLookups?: boolean;
  includeSummary?: boolean;
};

function clampPageSize(value: number | undefined) {
  if (!value || Number.isNaN(value)) return 20;
  return Math.min(Math.max(Math.floor(value), 10), 200);
}

function normalizeSearch(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function uniqueIds(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function intersectIds(base: Set<string> | null, next: Iterable<string>) {
  const nextSet = new Set(next);
  if (!base) return nextSet;
  return new Set([...base].filter(id => nextSet.has(id)));
}

function normalizeAdminContractLookups(results: any[] | null) {
  if (!results) return undefined;
  const [employersResult, rightsHoldersResult, worksResult] = results;
  const rightsHolders = (rightsHoldersResult?.data ?? [])
    .map((row: any) => Array.isArray(row.rettighedshavere) ? row.rettighedshavere[0] : row.rettighedshavere)
    .filter((holder: any) => Boolean(holder?.id && holder?.full_name))
    .sort((left: any, right: any) => left.full_name.localeCompare(right.full_name, "da-DK"));
  return {
    employers: employersResult?.data ?? [],
    rightsHolders,
    works: worksResult?.data ?? [],
  };
}

// Henter alle afsnit-værker for en serie (selve serien + dens børneværker) i en org.
// parentId valideres som UUID før strenginterpolation i .or(...) (defense-in-depth mod filter-injection).
async function fetchSeriesEpisodeWorks(
  db: ReturnType<typeof createServiceClient>,
  orgId: string,
  parentId: string,
): Promise<{ episodeWorks: SeriesEpisodeWork[]; error: string | null }> {
  if (!isUuid(parentId)) return { episodeWorks: [], error: null };
  const { data: relatedWorks, error } = await db
    .from("works")
    .select("id, title, season_number, episode_number, parent_work_id")
    .eq("org_id", orgId)
    .or(`id.eq.${parentId},parent_work_id.eq.${parentId}`);
  if (error) return { episodeWorks: [], error: error.message };
  const episodeWorks = ((relatedWorks ?? []) as SeriesEpisodeWork[]).filter(item => item.episode_number != null || parseLocalEpisodeCode(item.title));
  return { episodeWorks, error: null };
}

async function matchingAdminContractIds(
  db: ReturnType<typeof createServiceClient>,
  orgId: string,
  params: AdminContractsPageParams,
) {
  let ids: Set<string> | null = null;
  const q = normalizeSearch(params.search);

  if (q) {
    const like = `%${q}%`;
    const matches = new Set<string>();
    if (isUuid(q)) {
      const { data, error } = await db.from("contracts").select("id").eq("org_id", orgId).eq("id", q).limit(1);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) matches.add(row.id);
    }
    const directColumns = ["working_title", "type", "overenskomst", "status", "document_processing_status"];
    const directResults = await Promise.all(directColumns.map(column =>
      db.from("contracts").select("id").eq("org_id", orgId).ilike(column, like).limit(5000)
    ));
    for (const result of directResults) {
      if (result.error) throw new Error(result.error.message);
      for (const row of result.data ?? []) matches.add(row.id);
    }

    const numeric = Number(q);
    if (Number.isFinite(numeric)) {
      const { data, error } = await db
        .from("contracts")
        .select("id")
        .eq("org_id", orgId)
        .or(`contract_date.ilike.%${numeric}%,start_date.ilike.%${numeric}%,end_date.ilike.%${numeric}%`)
        .limit(5000);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) matches.add(row.id);
    }

    const [{ data: holders, error: holdersError }, { data: employers, error: employersError }, { data: works, error: worksError }] = await Promise.all([
      db.from("rettighedshavere").select("id").eq("org_id", orgId).ilike("full_name", like).limit(5000),
      db.from("employers").select("id").eq("org_id", orgId).ilike("name", like).limit(5000),
      db.from("works").select("id").eq("org_id", orgId).ilike("title", like).limit(5000),
    ]);
    if (holdersError) throw new Error(holdersError.message);
    if (employersError) throw new Error(employersError.message);
    if (worksError) throw new Error(worksError.message);

    const holderIds = uniqueIds((holders ?? []).map(row => row.id));
    const employerIds = uniqueIds((employers ?? []).map(row => row.id));
    const workIds = uniqueIds((works ?? []).map(row => row.id));
    const relationResults = await Promise.all([
      holderIds.length ? db.from("contracts").select("id").eq("org_id", orgId).in("rights_holder_id", holderIds).limit(5000) : Promise.resolve({ data: [], error: null }),
      employerIds.length ? db.from("contracts").select("id").eq("org_id", orgId).in("employer_id", employerIds).limit(5000) : Promise.resolve({ data: [], error: null }),
      workIds.length ? db.from("contracts").select("id").eq("org_id", orgId).in("work_id", workIds).limit(5000) : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of relationResults) {
      if (result.error) throw new Error(result.error.message);
      for (const row of result.data ?? []) matches.add(row.id);
    }

    if (q.includes("mangler") && q.includes("værk")) {
      const { data, error } = await db.from("contracts").select("id").eq("org_id", orgId).is("work_id", null).limit(5000);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) matches.add(row.id);
    }
    if (q.includes("mangler") && (q.includes("ejer") || q.includes("rettighedshaver"))) {
      const { data, error } = await db.from("contracts").select("id").eq("org_id", orgId).is("rights_holder_id", null).limit(5000);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) matches.add(row.id);
    }

    ids = intersectIds(ids, matches);
  }

  if (params.rightsHolderId) {
    const { data, error } = await db.from("contracts").select("id").eq("org_id", orgId).eq("rights_holder_id", params.rightsHolderId).limit(5000);
    if (error) throw new Error(error.message);
    ids = intersectIds(ids, (data ?? []).map(row => row.id));
  }

  if (params.status === "beskeder") {
    const { data, error } = await db
      .from("contract_comments")
      .select("contract_id")
      .eq("author_role", "member")
      .is("admin_read_at", null)
      .limit(5000);
    if (error) throw new Error(error.message);
    ids = intersectIds(ids, (data ?? []).map(row => row.contract_id));
  } else if (params.status === "missingOwner") {
    const { data, error } = await db.from("contracts").select("id").eq("org_id", orgId).is("rights_holder_id", null).limit(5000);
    if (error) throw new Error(error.message);
    ids = intersectIds(ids, (data ?? []).map(row => row.id));
  } else if (params.status === "missingWork") {
    const { data, error } = await db.from("contracts").select("id").eq("org_id", orgId).is("work_id", null).neq("status", "valideret").limit(5000);
    if (error) throw new Error(error.message);
    ids = intersectIds(ids, (data ?? []).map(row => row.id));
  } else if (params.status === "validationPending") {
    const { data, error } = await db.from("contracts").select("id").eq("org_id", orgId).not("work_id", "is", null).not("rights_holder_id", "is", null).neq("status", "valideret").limit(5000);
    if (error) throw new Error(error.message);
    ids = intersectIds(ids, (data ?? []).map(row => row.id));
  } else if (params.status === "validationRecommended") {
    const { data, error } = await db
      .from("contract_validations")
      .select("contract_id, has_credit_clause, has_overenskomst_incorporation")
      .or("has_credit_clause.eq.false,has_overenskomst_incorporation.eq.false")
      .limit(5000);
    if (error) throw new Error(error.message);
    ids = intersectIds(ids, (data ?? []).map(row => row.contract_id));
  } else if (params.status === "documentProcessing") {
    const { data, error } = await db.from("contracts").select("id").eq("org_id", orgId).in("document_processing_status", ["pending", "processing"]).limit(5000);
    if (error) throw new Error(error.message);
    ids = intersectIds(ids, (data ?? []).map(row => row.id));
  } else if (params.status === "documentReady") {
    const { data, error } = await db.from("contracts").select("id").eq("org_id", orgId).in("document_processing_status", ["ready", "not_required"]).limit(5000);
    if (error) throw new Error(error.message);
    ids = intersectIds(ids, (data ?? []).map(row => row.id));
  } else if (params.status === "documentNeedsReview") {
    const { data, error } = await db.from("contracts").select("id").eq("org_id", orgId).eq("document_processing_status", "needs_review").limit(5000);
    if (error) throw new Error(error.message);
    ids = intersectIds(ids, (data ?? []).map(row => row.id));
  } else if (params.status === "documentFailed") {
    const { data, error } = await db.from("contracts").select("id").eq("org_id", orgId).eq("document_processing_status", "failed").limit(5000);
    if (error) throw new Error(error.message);
    ids = intersectIds(ids, (data ?? []).map(row => row.id));
  }

  return ids;
}

export async function fetchAdminContractsPage(params: AdminContractsPageParams = {}) {
  const timer = createListLoadTimer("admin-contracts");
  const session = await createClient();
  const caller = await assertAdminRole(session, ADMIN_ROLES);
  if (!caller) return { success: false, error: "Ikke autoriseret", contracts: [], totalCount: 0, totalAllCount: 0 };
  timer.mark("access");

  const db = createServiceClient();
  const orgId = caller.orgId;
  const includeLookups = params.includeLookups === true;
  const includeSummary = params.includeSummary !== false;
  const lookupsPromise = includeLookups
    ? Promise.all([
        db.from("employers").select("id,name,parent_id,dfi_company_id").eq("org_id", orgId).order("name"),
        db.from("org_affiliations").select("rettighedshavere(id,full_name)").eq("org_id", orgId),
        db.from("works").select("id,title,year,poster_url").eq("org_id", orgId).order("title").limit(500),
      ])
    : Promise.resolve(null);
  const pageSize = clampPageSize(params.pageSize);
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const matchedIds = await matchingAdminContractIds(db, orgId, params);
  timer.mark("matching");
  if (matchedIds && matchedIds.size === 0) {
    const [{ count: totalAllCount }, lookupResults] = await Promise.all([
      includeSummary
        ? db.from("contracts").select("id", { count: "exact", head: true }).eq("org_id", orgId).is("superseded_by_contract_id", null)
        : Promise.resolve({ count: null }),
      lookupsPromise,
    ]);
    const lookups = normalizeAdminContractLookups(lookupResults);
    const timing = timer.finish({ rowCount: 0, page, includeLookups, includeSummary });
    return { success: true, contracts: [], totalCount: 0, totalAllCount: totalAllCount ?? undefined, stats: includeSummary ? { total: totalAllCount ?? 0, validerede: 0, kladder: 0 } : undefined, lookups, context: { orgId, role: caller.role }, timing };
  }

  const selectFields = `
    id, type, overenskomst, status, pdf_url, original_view_pdf_url, processed_pdf_url,
    document_processing_status, document_processing_error_code, superseded_by_contract_id,
    contract_date, start_date, end_date, created_at,
    employer_id, rights_holder_id, working_title,
    season_number, episode_numbers,
    employers (name),
    rettighedshavere (full_name),
    works (id, title, type, poster_url),
    contract_validations (has_credit_clause, has_overenskomst_incorporation)
  `;
  let countQuery = db.from("contracts").select("id", { count: "exact", head: true }).eq("org_id", orgId).is("superseded_by_contract_id", null);
  let listQuery = db.from("contracts").select(selectFields).eq("org_id", orgId).is("superseded_by_contract_id", null);
  const applyFilters = (query: any) => {
    let next = query;
    if (matchedIds) next = next.in("id", [...matchedIds]);
    if (params.status && !["all", "beskeder", "missingOwner", "missingWork", "validationPending", "validationRecommended", "documentProcessing", "documentReady", "documentNeedsReview", "documentFailed"].includes(params.status)) next = next.eq("status", params.status);
    if (params.type && params.type !== "all") next = next.eq("type", params.type);
    return next;
  };
  countQuery = applyFilters(countQuery);
  listQuery = applyFilters(listQuery);

  const ascending = params.sortDir !== "desc";
  if (params.sortKey === "rightsHolder") listQuery = listQuery.order("rights_holder_id", { ascending });
  else if (params.sortKey === "employer") listQuery = listQuery.order("employer_id", { ascending });
  else if (params.sortKey === "type") listQuery = listQuery.order("type", { ascending });
  else if (params.sortKey === "overenskomst") listQuery = listQuery.order("overenskomst", { ascending });
  else if (params.sortKey === "status") listQuery = listQuery.order("status", { ascending });
  else if (params.sortKey === "period") listQuery = listQuery.order("start_date", { ascending, nullsFirst: false }).order("contract_date", { ascending, nullsFirst: false });
  else listQuery = listQuery.order("created_at", { ascending: false });

  const [{ count, error: countError }, { data, error }, { count: totalAllCount }, { count: validatedCount }, { count: draftCount }, lookupResults] = await Promise.all([
    countQuery,
    listQuery.range(from, to),
    includeSummary
      ? db.from("contracts").select("id", { count: "exact", head: true }).eq("org_id", orgId).is("superseded_by_contract_id", null)
      : Promise.resolve({ count: null }),
    includeSummary
      ? db.from("contracts").select("id", { count: "exact", head: true }).eq("org_id", orgId).is("superseded_by_contract_id", null).eq("status", "valideret")
      : Promise.resolve({ count: null }),
    includeSummary
      ? db.from("contracts").select("id", { count: "exact", head: true }).eq("org_id", orgId).is("superseded_by_contract_id", null).eq("status", "kladde")
      : Promise.resolve({ count: null }),
    lookupsPromise,
  ]);
  if (countError) return { success: false, error: countError.message, contracts: [], totalCount: 0, totalAllCount: 0 };
  if (error) return { success: false, error: error.message, contracts: [], totalCount: 0, totalAllCount: 0 };
  timer.mark("list");

  const rawContracts = (data ?? []) as any[];
  const contractIds = rawContracts.map(row => row.id);
  const [commentsResult, jobsResult, importStates] = await Promise.all([
    contractIds.length
      ? db.from("contract_comments").select("id, contract_id, author_role, message, created_at, member_read_at, admin_read_at").in("contract_id", contractIds).eq("author_role", "member").is("admin_read_at", null).order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    contractIds.length
      ? db.from("contract_ai_jobs").select("contract_id, status, error_message, created_at").in("contract_id", contractIds).is("attachment_id", null).order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    getContractImportStatesForOrg(db, orgId, contractIds),
  ]);
  if (commentsResult.error) return { success: false, error: commentsResult.error.message, contracts: [], totalCount: 0, totalAllCount: 0 };
  if (jobsResult.error) return { success: false, error: jobsResult.error.message, contracts: [], totalCount: 0, totalAllCount: 0 };

  const commentsByContract: Record<string, Array<Record<string, unknown>>> = {};
  for (const comment of commentsResult.data ?? []) {
    if (!commentsByContract[comment.contract_id]) commentsByContract[comment.contract_id] = [];
    commentsByContract[comment.contract_id].push(comment);
  }
  const latestJobByContract: Record<string, { status: string; error_message: string | null; created_at: string }> = {};
  for (const job of jobsResult.data ?? []) {
    if (!latestJobByContract[job.contract_id]) latestJobByContract[job.contract_id] = job;
  }
  const contracts = rawContracts.map(row => {
    const validation = Array.isArray(row.contract_validations) ? row.contract_validations[0] : row.contract_validations;
    return {
      id: row.id,
      type: row.type,
      overenskomst: row.overenskomst,
      status: row.status,
      pdf_url: row.pdf_url,
      processed_pdf_url: row.processed_pdf_url ?? null,
      document_processing_status: row.document_processing_status ?? "pending",
      document_processing_error_code: row.document_processing_error_code ?? null,
      superseded_by_contract_id: row.superseded_by_contract_id ?? null,
      previous_version_count: 0,
      contract_date: row.contract_date,
      start_date: row.start_date,
      end_date: row.end_date,
      created_at: row.created_at,
      employer_id: row.employer_id ?? null,
      employer_name: row.employers?.name ?? null,
      rights_holder_id: row.rights_holder_id ?? null,
      rights_holder_name: row.rettighedshavere?.full_name ?? null,
      work_id: row.works?.id ?? null,
      working_title: row.working_title ?? null,
      work_title: row.works?.title ?? null,
      work_poster_url: row.works?.poster_url ?? null,
      season_number: row.season_number ?? null,
      episode_numbers: row.episode_numbers ?? null,
      contract_comments: commentsByContract[row.id] ?? [],
      contract_attachments: [],
      validation_data: null,
      validation_has_credit_clause: validation?.has_credit_clause ?? null,
      validation_has_overenskomst_incorporation: validation?.has_overenskomst_incorporation ?? null,
      ai_job_status: latestJobByContract[row.id]?.status ?? null,
      ai_job_error: latestJobByContract[row.id]?.error_message ?? null,
      import_status: importStates.success ? importStates.states[row.id] ?? null : null,
    };
  });
  timer.mark("row-details");
  const timing = timer.finish({ rowCount: contracts.length, page, includeLookups, includeSummary });
  const lookups = normalizeAdminContractLookups(lookupResults);

  return {
    success: true,
    contracts,
    totalCount: count ?? contracts.length,
    totalAllCount: includeSummary ? totalAllCount ?? count ?? contracts.length : undefined,
    stats: includeSummary ? { total: totalAllCount ?? count ?? contracts.length, validerede: validatedCount ?? 0, kladder: draftCount ?? 0 } : undefined,
    lookups,
    context: { orgId, role: caller.role },
    timing,
  };
}

export async function uploadMemberContract(formData: FormData) {
  const supabase = await createClient();
  const db = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil fundet" };

  const memberContext = await requireMemberContext(db, user.id);
  const orgId = memberContext.orgId;
  if (memberContext.rightsHolderId !== rh.id) return { success: false, error: "Ingen rettighedshaverprofil i den aktive organisation" };

  const file = formData.get("file") as File | null;
  if (!file) return { success: false, error: "Ingen fil modtaget" };
  if (file.size > MAX_CONTRACT_UPLOAD_BYTES) {
    return { success: false, error: "Filen er for stor. Maksimum er 25 MB." };
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["pdf", "doc", "docx", "txt"].includes(ext)) {
    return { success: false, error: "Filformat ikke understøttet — brug PDF, DOC, DOCX eller TXT" };
  }

  const pdfUrl = `${orgId}/${user.id}/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { data: uploadIntent, error: uploadIntentError } = await db.rpc("create_contract_upload_intent", {
    p_owner_id: user.id,
    p_org_id: orgId,
    p_rights_holder_id: rh.id,
    p_storage_path: pdfUrl,
    p_expected_size: file.size,
  });
  if (uploadIntentError || !uploadIntent?.id) {
    return { success: false, error: "Kunne ikke klargøre en sikker upload" };
  }

  const { error: storageErr } = await db.storage
    .from(BUCKET)
    .upload(pdfUrl, buffer, { contentType: file.type || "application/octet-stream" });

  if (storageErr) {
    console.error("Storage upload fejl:", storageErr);
    await db.from("contract_upload_intents")
      .update({ expires_at: new Date().toISOString() })
      .eq("id", uploadIntent.id)
      .eq("owner_id", user.id)
      .is("contract_id", null);
    return { success: false, error: "Kunne ikke uploade filen" };
  }

  // Kald eksisterende AI-extract route (genbruger al Claude-logik)
  let aiData: ContractExtractData = {};
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const extractForm = new FormData();
    extractForm.append("file", new Blob([buffer], { type: file.type }), file.name);

    const res = await fetch(`${baseUrl}/api/contracts/extract`, {
      method: "POST",
      body: extractForm,
    });

    if (res.ok) {
      aiData = await res.json() as ContractExtractData;
    } else {
      console.warn("Extract route returnerede:", res.status);
    }
  } catch (err: unknown) {
    console.error("AI-udtræk fejl:", err instanceof Error ? err.message : err);
    // Fortsæt uden AI-data — kontrakten gemmes stadig
  }

  const createParams = {
    p_owner_id: user.id,
    p_org_id: orgId,
    p_rights_holder_id: rh.id,
    p_upload_intent_id: uploadIntent.id,
    p_storage_path: pdfUrl,
    p_uploaded_size: file.size,
    p_working_title: file.name.replace(/\.[^.]+$/, ""),
    p_work_id: null,
    p_season_number: null,
    p_episode_numbers: null,
    p_defer_ai_job: false,
  };
  let createResult = await db.rpc("create_member_uploaded_contract", createParams);

  if (createResult.error || !createResult.data) {
    // The RPC is idempotent and row-locks the intent. A retry therefore
    // resolves an uncertain/lost response without racing a committed upload.
    createResult = await db.rpc("create_member_uploaded_contract", createParams);
  }
  const contract = createResult.data;
  if (createResult.error || !contract) {
    console.error("DB insert fejl:", createResult.error?.code ?? "unknown");
    // Never remove the object after an uncertain database result. The
    // token-safe tombstone cleanup owns orphan removal after the intent expires.
    return { success: false, error: "Kunne ikke gemme kontrakten" };
  }

  const contractMetadata = {
    type: aiData.contractType === "leverandør" || aiData.isFreelanceContract ? "leverandør" : "a-løn",
    overenskomst: aiData.overenskomst ?? null,
    contract_date: aiData.contractDate?.substring(0, 10) ?? null,
    start_date: aiData.startDate?.substring(0, 10) ?? null,
    end_date: aiData.endDate?.substring(0, 10) ?? null,
  };
  const uploadIdentity: MemberUploadIdentity = {
    ownerId: user.id,
    orgId,
    rightsHolderId: rh.id,
    uploadIntentId: uploadIntent.id,
    contractId: contract.id,
    storagePath: pdfUrl,
  };
  const requestHash = memberUploadRequestHash("legacy", pdfUrl, {
    workingTitle: file.name.replace(/\.[^.]+$/, ""),
    contractMetadata,
  });
  const claim = await claimMemberUploadFinalization(db, uploadIdentity, requestHash);
  if (!claim.success) return { success: false, error: claim.error };
  if (!claim.alreadyFinalized && claim.identity) {
    const finishParams = {
      p_owner_id: user.id,
      p_org_id: orgId,
      p_rights_holder_id: rh.id,
      p_upload_intent_id: uploadIntent.id,
      p_contract_id: contract.id,
      p_storage_path: pdfUrl,
      p_finalization_token: claim.identity.finalizationToken,
      p_request_hash: requestHash,
      p_validation_notes: null,
      p_contract_metadata: contractMetadata,
      p_series_work_id: null,
      p_scope_season_number: null,
      p_scope_status: null,
      p_scope_episode_numbers: null,
      p_scope_covers_whole_season: false,
    };
    let finalized = await db.rpc("finish_member_uploaded_contract_finalization", finishParams);
    if (finalized.error || !finalized.data) {
      finalized = await db.rpc("finish_member_uploaded_contract_finalization", finishParams);
    }
    if (finalized.error || !finalized.data) {
      return rollbackMemberUploadOrReport(
        db,
        claim.identity,
        "Kontrakten kunne ikke færdiggøres.",
      );
    }
  }

  revalidatePath("/portal/mine-kontrakter");
  return { success: true, contractId: contract.id, aiData };
}

export async function saveUploadedContract(params: {
  filePath: string;
  workTitle?: string;
  workId?: string;
  productionType: string;
  roles: string[];
  duration?: number;
  premiereDate?: string;
  season?: number;
  episodes?: { number: number; role: string }[];
  coversWholeSeason?: boolean;
  episodeSelectionConfirmed?: boolean;
  deferAiJob?: boolean;
  producerSelections?: ProductionCompanySelection[];
}) {
  const db = createServiceClient();
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id, full_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil fundet" };

  const memberContext = await requireMemberContext(db, user.id);
  const orgId = memberContext.orgId;
  if (memberContext.rightsHolderId !== rh.id) return { success: false, error: "Ingen rettighedshaverprofil i den aktive organisation" };
  const expectedPrefix = `${orgId}/${user.id}/`;
  if (!params.filePath.startsWith(expectedPrefix)
    || params.filePath.slice(expectedPrefix.length).includes("/")) {
    return { success: false, error: "Filstien tilhører ikke din upload" };
  }
  const extension = documentExtension(params.filePath);
  if (!["pdf", "doc", "docx", "txt"].includes(extension)) {
    return { success: false, error: "Filformat ikke understøttet — brug PDF, DOC, DOCX eller TXT" };
  }
  const filePath = params.filePath;
  const { data: pendingIntent, error: intentLookupError } = await db
    .from("contract_upload_intents")
    .select("id,org_id,rights_holder_id,expected_size,expires_at,consumed_at,contract_id")
    .eq("owner_id", user.id)
    .eq("storage_path", filePath)
    .maybeSingle();
  if (intentLookupError || !pendingIntent
    || pendingIntent.org_id !== orgId
    || pendingIntent.rights_holder_id !== rh.id
    || (!pendingIntent.contract_id && (
      Boolean(pendingIntent.consumed_at)
      || new Date(pendingIntent.expires_at).getTime() <= Date.now()
    ))) {
    return { success: false, error: "Uploadtilladelsen er udløbet eller allerede brugt" };
  }
  const uploaded = await db.storage.from(BUCKET).info(filePath);
  const uploadedSize = uploaded.data?.size;
  if (uploaded.error || typeof uploadedSize !== "number" || uploadedSize <= 0) {
    return { success: false, error: "Den uploadede kontrakt blev ikke fundet" };
  }
  if (uploadedSize > MAX_CONTRACT_UPLOAD_BYTES) {
    if (!pendingIntent.contract_id) await db.storage.from(BUCKET).remove([filePath]);
    return { success: false, error: "Filen er for stor. Maksimum er 25 MB." };
  }
  if (uploadedSize !== Number(pendingIntent.expected_size)) {
    if (!pendingIntent.contract_id) {
      await db.storage.from(BUCKET).remove([filePath]);
      await db.from("contract_upload_intents")
        .update({ expires_at: new Date().toISOString() })
        .eq("id", pendingIntent.id)
        .eq("owner_id", user.id)
        .is("contract_id", null);
    }
    return { success: false, error: "Den uploadede fil svarer ikke til den klargjorte upload" };
  }
  const episodeNumbers = params.season && params.episodeSelectionConfirmed
    ? params.coversWholeSeason
      ? []
      : params.episodes?.map(episode => episode.number)
        .filter(number => Number.isInteger(number) && number > 0) ?? []
    : null;
  const atomicCreateParams = {
    p_owner_id: user.id,
    p_org_id: orgId,
    p_rights_holder_id: rh.id,
    p_upload_intent_id: pendingIntent.id,
    p_storage_path: filePath,
    p_uploaded_size: uploadedSize,
    p_working_title: params.workTitle || null,
    p_work_id: params.workId ?? null,
    p_season_number: params.season ?? null,
    p_episode_numbers: episodeNumbers,
    p_defer_ai_job: Boolean(params.deferAiJob),
  };
  let atomicCreate = await db.rpc("create_member_uploaded_contract", atomicCreateParams);

  if (atomicCreate.error || !atomicCreate.data) {
    // Serialise recovery through the same intent row lock. The RPC returns an
    // existing committed contract on a lost response and never duplicates jobs.
    atomicCreate = await db.rpc("create_member_uploaded_contract", atomicCreateParams);
  }
  const saved = atomicCreate.data;
  if (atomicCreate.error || !saved) {
    // Unknown database outcomes never authorize Storage deletion. The
    // unlinked intent/tombstone cleanup will remove true orphans safely.
    return { success: false, error: "Kunne ikke gemme kontrakten og starte den automatiske behandling" };
  }

  const uploadIdentity: MemberUploadIdentity = {
    ownerId: user.id,
    orgId,
    rightsHolderId: rh.id,
    uploadIntentId: pendingIntent.id,
    contractId: saved.id,
    storagePath: filePath,
  };
  const requestHash = memberUploadRequestHash("guided", filePath, {
    workTitle: params.workTitle,
    workId: params.workId,
    productionType: params.productionType,
    roles: params.roles,
    duration: params.duration,
    premiereDate: params.premiereDate,
    season: params.season,
    episodes: params.episodes,
    coversWholeSeason: params.coversWholeSeason,
    episodeSelectionConfirmed: params.episodeSelectionConfirmed,
    deferAiJob: params.deferAiJob,
    producerSelections: params.producerSelections,
  });
  const claim = await claimMemberUploadFinalization(db, uploadIdentity, requestHash);
  if (!claim.success) return { success: false, error: claim.error };
  if (claim.alreadyFinalized || !claim.identity) {
    if (!filePath.toLowerCase().endsWith(".pdf") && !params.deferAiJob) {
      triggerContractAiJobProcessing(orgId);
    }
    revalidatePath("/portal/mine-kontrakter");
    return { success: true, contract: saved };
  }

  let scopeTarget: Awaited<ReturnType<typeof resolveSeriesScopeTarget>> = null;
  if (params.workId && params.season) {
    scopeTarget = await resolveSeriesScopeTarget(db, params.workId, params.season);
  }

  if (params.producerSelections?.length) {
    try {
      await syncContractProducerRelations(db, saved.id, params.producerSelections, "member_upload");
    } catch (producerError) {
      return rollbackMemberUploadOrReport(
        db,
        claim.identity,
        producerError instanceof Error ? producerError.message : "Producenten kunne ikke tilknyttes kontrakten",
      );
    }
  }

  const selectedEpisodes = [...new Set((params.episodes ?? [])
    .map(episode => episode.number)
    .filter(number => Number.isInteger(number) && number > 0))]
    .sort((left, right) => left - right);
  const confirmedScope = Boolean(
    scopeTarget
    && params.episodeSelectionConfirmed
    && (params.coversWholeSeason || selectedEpisodes.length > 0),
  );
  const validationNotes = {
    memberName: rh.full_name,
    workTitle: params.workTitle,
    workId: params.workId,
    productionType: params.productionType || undefined,
    creditedRoles: params.roles,
    duration: params.duration,
    premiereDate: params.premiereDate,
    season: params.season,
    episodes: params.episodes,
    submittedByMember: true,
  };
  const finishParams = {
    p_owner_id: user.id,
    p_org_id: orgId,
    p_rights_holder_id: rh.id,
    p_upload_intent_id: pendingIntent.id,
    p_contract_id: saved.id,
    p_storage_path: filePath,
    p_finalization_token: claim.identity.finalizationToken,
    p_request_hash: requestHash,
    p_validation_notes: validationNotes,
    p_contract_metadata: {},
    p_series_work_id: scopeTarget?.seriesWorkId ?? null,
    p_scope_season_number: scopeTarget?.seasonNumber ?? null,
    p_scope_status: scopeTarget ? confirmedScope ? "confirmed" : "pending" : null,
    p_scope_episode_numbers: scopeTarget && confirmedScope && !params.coversWholeSeason
      ? selectedEpisodes
      : [],
    p_scope_covers_whole_season: Boolean(scopeTarget && confirmedScope && params.coversWholeSeason),
  };
  let finalization = await db.rpc("finish_member_uploaded_contract_finalization", finishParams);
  if (finalization.error || !finalization.data) {
    // Completion itself is idempotent. Retry once before attempting a
    // token-bound rollback so a lost successful response cannot delete data.
    finalization = await db.rpc("finish_member_uploaded_contract_finalization", finishParams);
  }
  if (finalization.error || !finalization.data) {
    return rollbackMemberUploadOrReport(
      db,
      claim.identity,
      finalization.error?.message ?? "Kontrakten kunne ikke færdiggøres.",
    );
  }

  if (!filePath.toLowerCase().endsWith(".pdf") && !params.deferAiJob) {
    triggerContractAiJobProcessing(orgId);
  }

  revalidatePath("/portal/mine-kontrakter");
  return { success: true, contract: finalization.data };
}

export async function prepareMemberContractUpload(params: {
  fileName: string;
  fileSize: number;
}) {
  const user = await currentUser();
  if (!user) return { success: false as const, error: "Ikke logget ind" };
  if (!Number.isSafeInteger(params.fileSize) || params.fileSize <= 0) {
    return { success: false as const, error: "Ingen fil modtaget" };
  }
  if (params.fileSize > MAX_CONTRACT_UPLOAD_BYTES) {
    return { success: false as const, error: "Filen er for stor. Maksimum er 25 MB." };
  }
  const extension = documentExtension(params.fileName);
  if (!["pdf", "doc", "docx", "txt"].includes(extension)) {
    return { success: false as const, error: "Filformat ikke understøttet — brug PDF, DOC, DOCX eller TXT" };
  }

  const db = createServiceClient();
  const memberContext = await requireMemberContext(db, user.id);
  if (!memberContext.rightsHolderId) {
    return { success: false as const, error: "Ingen rettighedshaverprofil i den aktive organisation" };
  }
  const filePath = `${memberContext.orgId}/${user.id}/${randomUUID()}.${extension}`;
  const { data: intent, error: intentError } = await db.rpc("create_contract_upload_intent", {
    p_owner_id: user.id,
    p_org_id: memberContext.orgId,
    p_rights_holder_id: memberContext.rightsHolderId,
    p_storage_path: filePath,
    p_expected_size: params.fileSize,
  });
  if (intentError || !intent?.id) {
    return { success: false as const, error: "For mange samtidige uploads. Vent et øjeblik og prøv igen." };
  }
  const signed = await db.storage.from(BUCKET).createSignedUploadUrl(filePath);
  if (signed.error || !signed.data?.token) {
    await db.from("contract_upload_intents")
      .update({ expires_at: new Date().toISOString() })
      .eq("id", intent.id)
      .eq("owner_id", user.id)
      .is("contract_id", null);
    return { success: false as const, error: "Kunne ikke klargøre en sikker upload" };
  }
  const purgeAfter = new Date(Date.now() + SIGNED_UPLOAD_TOMBSTONE_MS).toISOString();
  const extendedTombstone = await db.from("contract_upload_intents")
    .update({ purge_after: purgeAfter })
    .eq("id", intent.id)
    .eq("owner_id", user.id)
    .is("contract_id", null)
    .select("id")
    .maybeSingle();
  if (extendedTombstone.error || !extendedTombstone.data?.id) {
    await db.from("contract_upload_intents")
      .update({ expires_at: new Date().toISOString() })
      .eq("id", intent.id)
      .eq("owner_id", user.id)
      .is("contract_id", null);
    return { success: false as const, error: "Kunne ikke klargøre en sikker upload" };
  }
  return {
    success: true as const,
    filePath,
    uploadToken: signed.data.token,
  };
}

export async function queueUploadedContractAiJob(contractId: string) {
  const db = createServiceClient();
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  if (!isUuid(contractId)) return { success: false, error: "Ugyldig kontrakt" };

  const { data: rh } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).maybeSingle();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil fundet" };
  const memberContext = await requireMemberContext(db, user.id);
  const orgId = memberContext.orgId;
  if (memberContext.rightsHolderId !== rh.id) return { success: false, error: "Ingen rettighedshaverprofil i den aktive organisation" };
  const { data: contract } = await db
    .from("contracts")
    .select("id,pdf_url")
    .eq("id", contractId)
    .eq("org_id", orgId)
    .eq("rights_holder_id", rh.id)
    .maybeSingle();
  if (!contract) return { success: false, error: "Kontrakten blev ikke fundet" };

  if (contract.pdf_url?.toLowerCase().endsWith(".pdf")) {
    const { data, error } = await db.rpc("queue_or_retry_member_contract_document_job", {
      p_owner_id: user.id,
      p_org_id: orgId,
      p_rights_holder_id: rh.id,
      p_contract_id: contractId,
    });
    const result = (Array.isArray(data) ? data[0] : data) as {
      outcome?: "queued" | "requeued" | "already_queued" | "already_processed";
    } | null;
    if (error || !result?.outcome) {
      return { success: false, error: "Dokumentbehandlingen kunne ikke sættes i kø" };
    }
    return {
      success: true,
      alreadyQueued: result.outcome === "already_queued",
      alreadyProcessed: result.outcome === "already_processed",
      requeued: result.outcome === "requeued",
    };
  }

  const { data: existing } = await db
    .from("contract_ai_jobs")
    .select("id")
    .eq("contract_id", contractId)
    .in("status", ["queued", "processing", "retry_wait", "blocked", "error"])
    .limit(1)
    .maybeSingle();
  if (existing) return { success: true, alreadyQueued: true };

  const { error } = await db.from("contract_ai_jobs").insert({
    contract_id: contractId,
    org_id: orgId,
    status: "queued",
    priority: 0,
  });
  if (error) return { success: false, error: error.message };
  triggerContractAiJobProcessing(orgId);
  return { success: true, alreadyQueued: false };
}

// Udløs jobkøen med det samme, så auto-kobling af kontrakt→værk ikke venter på
// det daglige cron-job. Kører direkte i baggrunden via after().
function triggerContractAiJobProcessing(orgId: string) {
  after(async () => {
    try {
      const { processPendingContractJobs } = await import("@/lib/server/contract-import-processor");
      await processPendingContractJobs(orgId);
    } catch (e) {
      console.error("[contract-job] Baggrundsaflæsning fejlede:", e);
    }
  });
}

export async function fetchMemberContractsList() {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind", contracts: [] };

  const db = createServiceClient();
  const memberContext = await requireMemberContext(db, user.id);
  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil fundet", contracts: [] };
  if (memberContext.rightsHolderId !== rh.id) return { success: false, error: "Ingen rettighedshaverprofil i den aktive organisation", contracts: [] };

  const { data, error } = await db
    .from("contracts")
    .select("id, type, overenskomst, status, contract_date, start_date, end_date, pdf_url, work_id, working_title, created_at, works(id, title, year, type), employers(id, name), contract_validations(has_credit_clause, has_overenskomst_incorporation, validated_at)")
    .eq("org_id", memberContext.orgId)
    .eq("rights_holder_id", rh.id)
    .order("created_at", { ascending: false });

  if (error) return { success: false, error: error.message, contracts: [] };
  const orgId = await requireOrgId(db, user.id);
  await recordAuditEvent({
    context: auditHeadersContext(await headers(), { userId: user.id, orgId, role: "member" }, "portal", "portal.contracts.list"),
    action: "read",
    entityType: "contracts",
    entityLabel: "Mine kontrakter",
    targetMemberUuid: rh.id,
    purposeCode: "member_self_service",
    legalBasis: "GDPR Art. 6(1)(b)",
    dataCategories: ["contract_data", "salary_data", "message_data"],
    orgIds: [orgId],
    metadata: { resultCount: data?.length ?? 0 },
  });
  return { success: true, contracts: data ?? [] };
}

export async function fetchMemberContractsForWorks(params: { rightsHolderId: string; workIds: string[] }) {
  const context = await getRequestAppAccessContext();
  if (!context?.rightsHolderId || context.rightsHolderId !== params.rightsHolderId) {
    return { success: false as const, error: "Du kan kun se dine egne kontrakter.", contracts: [] };
  }
  const workIds = [...new Set(params.workIds.filter(isUuid))].slice(0, 100);
  if (!workIds.length) return { success: true as const, contracts: [] };

  const db = createServiceClient();
  const { data, error } = await db.from("contracts")
    .select("id,type,overenskomst,status,contract_date,start_date,end_date,pdf_url,processed_pdf_url,work_id,working_title,season_number,episode_numbers,created_at,works(id,title,year,type),employers(id,name),contract_validations(has_credit_clause,has_overenskomst_incorporation,validated_at)")
    .eq("org_id", context.orgId)
    .eq("rights_holder_id", context.rightsHolderId)
    .is("superseded_by_contract_id", null)
    .in("work_id", workIds)
    .order("created_at", { ascending: false });
  if (error) return { success: false as const, error: error.message, contracts: [] };

  return {
    success: true as const,
    contracts: (data ?? []).map(contract => ({
      ...contract,
      works: Array.isArray(contract.works) ? contract.works[0] ?? null : contract.works,
      employers: Array.isArray(contract.employers) ? contract.employers[0] ?? null : contract.employers,
      contract_attachments: [],
      contract_comments: [],
    })),
  };
}

export type MemberContractsPageParams = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  workType?: string;
  sortKey?: "title" | "employer" | "overenskomst" | "rights" | "status" | "date";
  sortDir?: "asc" | "desc";
};

type MemberContractListRow = {
  id: string;
  type: string | null;
  overenskomst: string | null;
  status: string;
  contract_date: string | null;
  start_date: string | null;
  end_date: string | null;
  pdf_url: string | null;
  processed_pdf_url: string | null;
  work_id: string | null;
  working_title: string | null;
  season_number: number | null;
  episode_numbers: number[] | null;
  created_at: string | null;
  works: unknown;
  employers: unknown;
  contract_validations: unknown;
  contract_attachments: never[];
  contract_comments: Array<{
    id: string;
    author_role: "admin";
    message: string;
    created_at: string;
    member_read_at: null;
    admin_read_at: string | null;
  }>;
  episode_confirmed: boolean;
};

export async function fetchMemberContractsPage(
  params: MemberContractsPageParams = {},
): Promise<{ success: true; result: ListPageResult<MemberContractListRow> } | { success: false; error: string }> {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const db = createServiceClient();
  const context = await requireMemberContext(db, user.id).catch(() => null);
  if (!context?.rightsHolderId) return { success: false, error: "Ingen rettighedshaverprofil i den aktive organisation" };

  const pageSize = [20, 50, 100].includes(Number(params.pageSize)) ? Number(params.pageSize) : 20;
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const from = (page - 1) * pageSize;
  const search = params.search?.trim() ?? "";
  let matchedIds: Set<string> | null = null;
  let hasEmptyMatch = false;

  const narrowTo = (ids: Iterable<string>) => {
    const next = new Set(ids);
    matchedIds = matchedIds === null ? next : new Set([...matchedIds].filter(id => next.has(id)));
    hasEmptyMatch = matchedIds.size === 0;
  };

  if (search) {
    const like = `%${search.replace(/[,%()]/g, " ")}%`;
    const [worksResult, employersResult, directResult] = await Promise.all([
      db.from("works").select("id").ilike("title", like).limit(500),
      db.from("employers").select("id").ilike("name", like).limit(500),
      db.from("contracts")
        .select("id")
        .eq("org_id", context.orgId)
        .eq("rights_holder_id", context.rightsHolderId)
        .or(`working_title.ilike.${like},overenskomst.ilike.${like}`)
        .limit(1000),
    ]);
    const error = worksResult.error ?? employersResult.error ?? directResult.error;
    if (error) return { success: false, error: error.message };
    const ids = new Set((directResult.data ?? []).map(row => row.id));
    const workIds = (worksResult.data ?? []).map(row => row.id);
    const employerIds = (employersResult.data ?? []).map(row => row.id);
    const related = await Promise.all([
      workIds.length
        ? db.from("contracts").select("id").eq("org_id", context.orgId).eq("rights_holder_id", context.rightsHolderId).in("work_id", workIds).limit(1000)
        : Promise.resolve({ data: [], error: null }),
      employerIds.length
        ? db.from("contracts").select("id").eq("org_id", context.orgId).eq("rights_holder_id", context.rightsHolderId).in("employer_id", employerIds).limit(1000)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of related) {
      if (result.error) return { success: false, error: result.error.message };
      for (const row of result.data ?? []) ids.add(row.id);
    }
    narrowTo(ids);
  }

  if (params.workType && params.workType !== "all") {
    const { data: works, error } = await db.from("works").select("id").eq("type", params.workType).limit(2000);
    if (error) return { success: false, error: error.message };
    const workIds = (works ?? []).map(row => row.id);
    if (!workIds.length) narrowTo([]);
    else {
      const { data, error: contractError } = await db.from("contracts")
        .select("id")
        .eq("org_id", context.orgId)
        .eq("rights_holder_id", context.rightsHolderId)
        .in("work_id", workIds)
        .limit(2000);
      if (contractError) return { success: false, error: contractError.message };
      narrowTo((data ?? []).map(row => row.id));
    }
  }

  if (params.status === "messages") {
    const { data, error } = await db.from("contract_comments")
      .select("contract_id,contracts!inner(org_id,rights_holder_id)")
      .eq("author_role", "admin")
      .is("member_read_at", null)
      .eq("contracts.org_id", context.orgId)
      .eq("contracts.rights_holder_id", context.rightsHolderId)
      .limit(2000);
    if (error) return { success: false, error: error.message };
    narrowTo((data ?? []).map(row => row.contract_id));
  }

  const base = () => db.from("contracts")
    .select("id", { count: "exact", head: true })
    .eq("org_id", context.orgId)
    .eq("rights_holder_id", context.rightsHolderId)
    .is("superseded_by_contract_id", null);
  const apply = (query: any) => {
    let next = query;
    if (matchedIds !== null) next = next.in("id", [...matchedIds]);
    if (params.status === "linked") next = next.not("work_id", "is", null);
    else if (params.status === "missingWork") next = next.is("work_id", null);
    else if (params.status === "missingDocument") next = next.is("pdf_url", null);
    else if (params.status && !["all", "messages", "actionRequired"].includes(params.status)) next = next.eq("status", params.status);
    return next;
  };

  if (hasEmptyMatch) {
    const { count: totalCount } = await base();
    return { success: true, result: { rows: [], page: 1, pageSize, filteredCount: 0, totalCount: totalCount ?? 0, hasNextPage: false } };
  }

  const countQuery = apply(base());
  let listQuery = apply(db.from("contracts").select(`
    id,type,overenskomst,status,contract_date,start_date,end_date,pdf_url,processed_pdf_url,
    work_id,working_title,season_number,episode_numbers,created_at,
    works(id,title,year,type),employers(id,name),
    contract_validations(has_credit_clause,has_overenskomst_incorporation,validated_at)
  `).eq("org_id", context.orgId).eq("rights_holder_id", context.rightsHolderId).is("superseded_by_contract_id", null));

  const ascending = params.sortDir === "asc";
  if (params.sortKey === "overenskomst") listQuery = listQuery.order("overenskomst", { ascending }).order("id", { ascending: true });
  else if (params.sortKey === "status") listQuery = listQuery.order("status", { ascending }).order("id", { ascending: true });
  else listQuery = listQuery.order("created_at", { ascending: params.sortKey === "date" ? ascending : false }).order("id", { ascending: true });

  const [countResult, totalResult, listResult] = await Promise.all([
    countQuery,
    base(),
    listQuery.range(from, from + pageSize - 1),
  ]);
  const queryError = countResult.error ?? totalResult.error ?? listResult.error;
  if (queryError) return { success: false, error: queryError.message };

  const rawRows = (listResult.data ?? []) as unknown as Array<Omit<MemberContractListRow, "contract_comments" | "contract_attachments" | "episode_confirmed">>;
  const ids = rawRows.map(row => row.id);
  const [commentsResult, confirmationsResult] = await Promise.all([
    ids.length
      ? db.from("contract_comments").select("id,contract_id,created_at,member_read_at,admin_read_at").in("contract_id", ids).eq("author_role", "admin").is("member_read_at", null).order("created_at")
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? db.from("contract_episode_confirmations").select("contract_id").in("contract_id", ids).is("invalidated_at", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const detailError = commentsResult.error ?? confirmationsResult.error;
  if (detailError) return { success: false, error: detailError.message };
  const confirmed = new Set((confirmationsResult.data ?? []).map(row => row.contract_id));
  const comments = new Map<string, MemberContractListRow["contract_comments"]>();
  for (const row of commentsResult.data ?? []) {
    const values = comments.get(row.contract_id) ?? [];
    values.push({ ...row, author_role: "admin", message: "", member_read_at: null });
    comments.set(row.contract_id, values);
  }
  const rows = rawRows.map(row => ({
    ...row,
    contract_attachments: [] as never[],
    contract_comments: comments.get(row.id) ?? [],
    episode_confirmed: confirmed.has(row.id),
  }));
  const filteredCount = countResult.count ?? 0;
  await recordAuditEvent({
    context: auditHeadersContext(await headers(), { userId: user.id, orgId: context.orgId, role: "member" }, "portal", "portal.contracts.list"),
    action: "read",
    entityType: "contracts",
    entityLabel: "Mine kontrakter",
    targetMemberUuid: context.rightsHolderId,
    purposeCode: "member_self_service",
    legalBasis: "GDPR Art. 6(1)(b)",
    dataCategories: ["contract_data", "salary_data", "message_data"],
    orgIds: [context.orgId],
    metadata: { resultCount: rows.length, page, pageSize },
  });
  return {
    success: true,
    result: {
      rows,
      page,
      pageSize,
      filteredCount,
      totalCount: totalResult.count ?? filteredCount,
      hasNextPage: from + rows.length < filteredCount,
    },
  };
}

export async function linkContractToWork(
  contractId: string,
  workId: string | null,
  scope?: { seasonNumber?: number | null; episodeNumbers?: number[] | null; coversWholeSeason?: boolean; episodeSelectionConfirmed?: boolean }
) {
  const supabase = await createClient();
  const db = createServiceClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const { data: rh } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).single();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil" };

  // Kontrakten skal tilhøre medlemmet
  const { data: contract } = await db
    .from("contracts")
    .select("id, org_id, rights_holder_id")
    .eq("id", contractId)
    .eq("rights_holder_id", rh.id)
    .maybeSingle();
  if (!contract) return { success: false, error: "Kontrakt ikke fundet" };

  // Værket skal findes og tilhøre samme org som kontrakten
  if (workId) {
    const { data: work } = await db.from("works").select("id, org_id").eq("id", workId).maybeSingle();
    if (!work || work.org_id !== contract.org_id) {
      return { success: false, error: "Værket findes ikke i din organisation" };
    }
  }

  let episodeScopeId: string | null = null;
  let resolvedSeasonNumber: number | null = null;
  let resolvedEpisodeNumbers: number[] | null = null;
  if (workId) {
    const target = await resolveSeriesScopeTarget(db, workId, scope?.seasonNumber);
    if (target) {
      const episodes = scope?.episodeNumbers ?? [];
      const confirmed = Boolean(scope?.episodeSelectionConfirmed && (scope.coversWholeSeason || episodes.length > 0));
      const scopeResult = await upsertMemberSeriesEpisodeScope(db, {
        orgId: contract.org_id,
        rightsHolderId: rh.id,
        seriesWorkId: target.seriesWorkId,
        seasonNumber: target.seasonNumber,
        status: confirmed ? "confirmed" : "pending",
        episodeNumbers: episodes,
        coversWholeSeason: confirmed && scope?.coversWholeSeason,
        source: "contract_link",
      });
      if (!scopeResult.success) return scopeResult;
      episodeScopeId = scopeResult.scope.id;
      resolvedSeasonNumber = scopeResult.scope.season_number;
      resolvedEpisodeNumbers = scopeResult.scope.status === "confirmed"
        ? scopeResult.scope.covers_whole_season ? [] : scopeResult.scope.episode_numbers
        : null;
    }
  }
  const { error } = await db
    .from("contracts")
    .update({
      work_id: workId,
      episode_scope_id: episodeScopeId,
      season_number: workId ? resolvedSeasonNumber : null,
      episode_numbers: workId ? resolvedEpisodeNumbers : null,
    })
    .eq("id", contractId)
    .eq("rights_holder_id", rh.id);

  if (error) return { success: false, error: error.message };
  if (!workId) {
    const { error: confirmationError } = await db
      .from("contract_episode_confirmations")
      .update({ invalidated_at: new Date().toISOString() })
      .eq("contract_id", contractId)
      .eq("rights_holder_id", rh.id)
      .is("invalidated_at", null);
    if (confirmationError) {
      console.error("Kunne ikke ugyldiggøre kontraktens afsnitsbekræftelse", { contractId, error: confirmationError.message });
      return { success: false, error: "Værktilknytningen blev fjernet, men afsnitsbekræftelsen kunne ikke ryddes. Prøv igen." };
    }
  }
  revalidatePath("/portal/mine-kontrakter");
  revalidatePath("/portal/mine-vaerker");
  return { success: true };
}

export async function fetchMemberContractDetail(contractId: string) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const db = createServiceClient();
  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil fundet" };

  const { data, error } = await db
    .from("contracts")
    .select("id, org_id, type, overenskomst, status, contract_date, start_date, end_date, pdf_url, work_id, working_title, season_number, episode_numbers, created_at, works(id, title, year, type), employers(id, name), contract_validations(has_credit_clause, has_overenskomst_incorporation, notes, extracted_data, validated_at), contract_attachments(id, type, title, pdf_url, created_at, ai_status, ai_result), contract_comments(id, author_role, message, created_at, member_read_at, admin_read_at)")
    .eq("id", contractId)
    .eq("rights_holder_id", rh.id)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "Kontrakten blev ikke fundet." };
  await recordAuditEvent({
    context: auditHeadersContext(await headers(), { userId: user.id, orgId: data.org_id, role: "member" }, "portal", "portal.contracts.detail"),
    action: "read",
    entityType: "contracts",
    entityId: contractId,
    entityLabel: data.working_title ?? "Egen kontrakt",
    targetMemberUuid: rh.id,
    purposeCode: "member_self_service",
    legalBasis: "GDPR Art. 6(1)(b)",
    dataCategories: ["contract_data", "salary_data", "message_data", "ai_analysis"],
    orgIds: [data.org_id],
  });
  return { success: true, contract: data };
}

export async function getContractSignedUrl(pdfUrl: string) {
  const user = await currentUser();
  if (!user) return { url: null, error: "Ikke logget ind" };
  const db = createServiceClient();
  const { data: memberProfiles } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id);
  const memberProfileIds = (memberProfiles ?? []).map(profile => profile.id);
  const { data: memberAffiliations } = memberProfileIds.length > 0
    ? await db
      .from("org_affiliations")
      .select("org_id,rights_holder_id,valid_from,valid_to")
      .in("rights_holder_id", memberProfileIds)
    : { data: [] as MemberOrgAffiliation[] };
  const today = new Date().toISOString().slice(0, 10);
  const ownsContractInOrg = (rightsHolderId: string | null, orgId: string) => hasActiveMemberContractOwnership({
    profileIds: memberProfileIds,
    affiliations: memberAffiliations ?? [],
    rightsHolderId,
    orgId,
    date: today,
  });

  let { data: contract } = await db
    .from("contracts")
    .select("id, org_id, rights_holder_id, pdf_url")
    .eq("pdf_url", pdfUrl)
    .maybeSingle();
  if (!contract) {
    const processed = await db
      .from("contracts")
      .select("id, org_id, rights_holder_id, pdf_url")
      .eq("processed_pdf_url", pdfUrl)
      .maybeSingle();
    contract = processed.data;
  }

  let auditOrgId: string;
  let targetMemberUuid: string | null;
  let entityId: string | null = null;
  let isOwnContract = false;
  if (contract) {
    auditOrgId = contract.org_id;
    targetMemberUuid = contract.rights_holder_id;
    entityId = contract.id;
    isOwnContract = ownsContractInOrg(contract.rights_holder_id, contract.org_id);
    if (!isOwnContract) {
      const isAdmin = await assertAdminForOrg(db, user.id, contract.org_id);
      if (!isAdmin) return { url: null, error: "Ikke autoriseret" };
    }
  } else {
    const { data: attachment } = await db
      .from("contract_attachments")
      .select("pdf_url, contracts(id, org_id, rights_holder_id)")
      .eq("pdf_url", pdfUrl)
      .maybeSingle();
    const relation = (attachment as { contracts?: { org_id: string; rights_holder_id: string | null } | { org_id: string; rights_holder_id: string | null }[] | null } | null)?.contracts;
    const owner = Array.isArray(relation) ? relation[0] : relation;
    if (!owner) return { url: null, error: "Fil ikke fundet" };
    auditOrgId = owner.org_id;
    targetMemberUuid = owner.rights_holder_id;
    isOwnContract = ownsContractInOrg(owner.rights_holder_id, owner.org_id);
    if (!isOwnContract) {
      const isAdmin = await assertAdminForOrg(db, user.id, owner.org_id);
      if (!isAdmin) return { url: null, error: "Ikke autoriseret" };
    }
  }

  const { data } = await db.storage.from(BUCKET).createSignedUrl(pdfUrl, 3600);
  if (data?.signedUrl) {
    await recordAuditEvent({
      context: auditHeadersContext(await headers(), { userId: user.id, orgId: auditOrgId, role: isOwnContract ? "member" : "admin" }, isOwnContract ? "portal" : "admin", "contracts.document-download"),
      action: "download",
      entityType: "contracts",
      entityId,
      entityLabel: "Kontraktdokument",
      targetMemberUuid,
      purposeCode: isOwnContract ? "member_self_service" : "contract_case_management",
      legalBasis: "GDPR Art. 6(1)(b) og 6(1)(f)",
      dataCategories: ["contract_data", "salary_data"],
      orgIds: [auditOrgId],
    });
  }
  return { url: data?.signedUrl ?? null };
}

export async function getContractDocumentPreview(contractId: string) {
  const user = await currentUser();
  if (!user) return { kind: "none" as const, error: "Ikke logget ind" };
  const db = createServiceClient();
  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!rh) return { kind: "none" as const, error: "Ingen rettighedshaver-profil" };

  const { data: contract } = await db
    .from("contracts")
    .select("id, org_id, rights_holder_id, working_title, pdf_url, processed_pdf_url")
    .eq("id", contractId)
    .maybeSingle();
  if (!contract) return { kind: "none" as const, error: "Kontrakt ikke fundet" };
  if (contract.rights_holder_id !== rh.id) {
    const isAdmin = await assertAdminForOrg(db, user.id, contract.org_id);
    if (!isAdmin) return { kind: "none" as const, error: "Ikke autoriseret" };
  }

  const path = contract.processed_pdf_url ?? contract.pdf_url;
  if (!path) return { kind: "none" as const, error: "Kontrakten har ikke et dokument" };
  const extension = documentExtension(path);
  const fileName = path.split("/").pop() ?? "kontrakt";

  await recordAuditEvent({
    context: auditHeadersContext(await headers(), { userId: user.id, orgId: contract.org_id, role: contract.rights_holder_id === rh.id ? "member" : "admin" }, contract.rights_holder_id === rh.id ? "portal" : "admin", "contracts.document-preview"),
    action: "read",
    entityType: "contracts",
    entityId: contract.id,
    entityLabel: contract.working_title ?? "Kontraktdokument",
    targetMemberUuid: contract.rights_holder_id,
    purposeCode: contract.rights_holder_id === rh.id ? "member_self_service" : "contract_case_management",
    legalBasis: "GDPR Art. 6(1)(b) og 6(1)(f)",
    dataCategories: ["contract_data", "salary_data"],
    orgIds: [contract.org_id],
  });

  if (extension === "pdf") {
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 3600, { download: false });
    if (error || !data?.signedUrl) return { kind: "none" as const, error: "Kunne ikke oprette preview-link" };
    return { kind: "pdf" as const, url: data.signedUrl, fileName };
  }

  if (extension === "doc" || extension === "docx") {
    const { data, error } = await db.storage.from(BUCKET).download(path);
    if (error || !data) return { kind: "none" as const, error: "Kunne ikke hente Word-dokumentet" };
    try {
      const text = await extractWordText(Buffer.from(await data.arrayBuffer()), fileName);
      return { kind: "word" as const, text, fileName };
    } catch (error) {
      console.error("[member-contracts] Word-preview fejlede", error);
      return { kind: "none" as const, error: "Word-dokumentet kunne ikke vises som tekst" };
    }
  }

  return { kind: "unsupported" as const, fileName, error: "Dokumenttypen kan ikke forhåndsvises automatisk" };
}

export async function deleteMemberContract(contractId: string) {
  const supabase = await createClient();
  const db = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil" };

  const { data: contract } = await db
    .from("contracts")
    .select("pdf_url, original_view_pdf_url, processed_pdf_url, document_spatial_data_path, rights_holder_id")
    .eq("id", contractId)
    .single();

  if (!contract) return { success: false, error: "Kontrakt ikke fundet" };
  if (contract.rights_holder_id !== rh.id) return { success: false, error: "Ikke autoriseret" };

  // Slet altid databaserækken først. Hvis storage slettes først og database-
  // sletningen fejler, står brugeren ellers med en kontrakt uden dokument.
  const [{ data: attachments }, { data: documentJobs }] = await Promise.all([
    db.from("contract_attachments").select("pdf_url").eq("contract_id", contractId),
    db.from("contract_document_jobs")
      .select("output_storage_path,original_view_storage_path,spatial_data_path")
      .eq("contract_id", contractId),
  ]);
  const storagePaths = [...new Set([
    contract.pdf_url,
    contract.original_view_pdf_url,
    contract.processed_pdf_url,
    contract.document_spatial_data_path,
    ...((attachments ?? []).map(a => a.pdf_url)),
    ...((documentJobs ?? []).flatMap(job => [job.output_storage_path, job.original_view_storage_path, job.spatial_data_path])),
  ].filter((p): p is string => Boolean(p)))];
  const { error: deleteError } = await db.from("contracts").delete().eq("id", contractId);
  if (deleteError) {
    console.error("[member-contracts] contract delete failed", deleteError.code);
    return { success: false, error: "Kontrakten kunne ikke slettes." };
  }
  let cleanupWarning: string | undefined;
  if (storagePaths.length > 0) {
    const { error: storageError } = await db.storage.from(BUCKET).remove(storagePaths);
    if (storageError) {
      console.error("[member-contracts] post-delete storage cleanup failed", storageError.name);
      cleanupWarning = "Kontrakten er slettet, men en fil afventer teknisk oprydning.";
    }
  }

  revalidatePath("/portal/mine-kontrakter");
  return { success: true, warning: cleanupWarning };
}

export async function getContractValidation(contractId: string, includeEpisodes = true) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient();
  const { data: contract } = await db
    .from("contracts")
    .select(`
      id, org_id, type, overenskomst, contract_date, start_date, end_date,
      working_title, rights_holder_id,
      employers(name), rettighedshavere(full_name),
      works(
        id, title, type, year, duration_minutes, season_count, season_number,
        episode_count, episode_number, parent_work_id, genre, director,
        production_companies, production_countries, description,
        dfi_id, tmdb_id, imdb_id
      )
    `)
    .eq("id", contractId)
    .single();
  if (!contract) return { success: false, error: "Kontrakt ikke fundet" };
  if (!(await assertAdminForOrg(db, user.id, contract.org_id))) return { success: false, error: "Ikke autoriseret" };
  const { data } = await db
    .from("contract_validations")
    .select("extracted_data")
    .eq("contract_id", contractId)
    .maybeSingle();

  const relatedWork = Array.isArray(contract.works) ? contract.works[0] : contract.works;
  const employer = Array.isArray(contract.employers) ? contract.employers[0] : contract.employers;
  const rightsHolder = Array.isArray(contract.rettighedshavere) ? contract.rettighedshavere[0] : contract.rettighedshavere;
  const parsedEpisode = parseLocalEpisodeCode(relatedWork?.title);
  const work: LinkedContractWorkData | null = relatedWork ? {
    ...relatedWork,
    season_number: relatedWork.season_number ?? parsedEpisode?.seasonNumber ?? null,
    episode_number: relatedWork.episode_number ?? parsedEpisode?.episodeNumber ?? null,
  } : null;
  let extractedData = mergeContractWorkData({
    extractedData: (data?.extracted_data ?? null) as Record<string, unknown> | null,
    contract,
    work,
    employerName: employer?.name ?? null,
    rightsHolderName: rightsHolder?.full_name ?? null,
  });
  try {
    extractedData = (await applyApprovedAgreementRoyalty(extractedData)).data;
  } catch (error) {
    console.warn("[contract-validation] Royaltyreglen kunne ikke anvendes", error instanceof Error ? error.message : error);
  }

  const linkedEpisodes: Array<{ id: string; title: string; seasonNumber: number; episodeNumber: number; role: string | null }> = [];
  const episodeOptions: Array<{ id: string; title: string; seasonNumber: number; episodeNumber: number }> = [];
  if (includeEpisodes && relatedWork && contract.rights_holder_id) {
    const parentId = relatedWork.parent_work_id ?? relatedWork.id;
    const { episodeWorks } = await fetchSeriesEpisodeWorks(db, contract.org_id, parentId);
    const episodeIds = episodeWorks.map(item => item.id);
    const { data: assignments } = episodeIds.length > 0
      ? await db
        .from("work_assignments")
        .select("work_id, role")
        .eq("org_id", contract.org_id)
        .eq("rights_holder_id", contract.rights_holder_id)
        .in("work_id", episodeIds)
      : { data: [] as Array<{ work_id: string; role: string | null }> };
    const roleByWork = new Map((assignments ?? []).map(item => [item.work_id, item.role]));

    for (const episode of episodeWorks) {
      const parsed = parseLocalEpisodeCode(episode.title);
      const seasonNumber = episode.season_number ?? parsed?.seasonNumber;
      const episodeNumber = episode.episode_number ?? parsed?.episodeNumber;
      if (seasonNumber == null || episodeNumber == null) continue;
      episodeOptions.push({ id: episode.id, title: episode.title ?? "", seasonNumber, episodeNumber });
      const isDirectContractEpisode = episode.id === relatedWork.id;
      if (!isDirectContractEpisode && !roleByWork.has(episode.id)) continue;
      linkedEpisodes.push({
        id: episode.id,
        title: episode.title ?? "",
        seasonNumber,
        episodeNumber,
        role: roleByWork.get(episode.id) ?? null,
      });
    }
    linkedEpisodes.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
    episodeOptions.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  }

  const isSeriesWork = relatedWork?.type === "tv-serie" || relatedWork?.type === "dokumentar-serie" || Boolean(relatedWork?.parent_work_id);
  // hasSavedValidation afspejler om der faktisk findes gemte valideringsdata FØR merge med værkets
  // fallback-felter — så UI kan skelne "endnu ingen validering" fra "felter fyldt fra det linkede værk".
  const hasSavedValidation = Boolean(data?.extracted_data && Object.keys(data.extracted_data as Record<string, unknown>).length > 0);
  await recordAuditEvent({
    context: auditHeadersContext(await headers(), { userId: user.id, orgId: contract.org_id, role: "admin" }, "admin", "admin.contracts.validation"),
    action: "read",
    entityType: "contracts",
    entityId: contractId,
    entityLabel: valueText((contract as { working_title?: unknown }).working_title, "Kontraktvalidering"),
    targetMemberUuid: contract.rights_holder_id,
    purposeCode: "contract_validation",
    legalBasis: "GDPR Art. 6(1)(b) og 6(1)(f)",
    dataCategories: ["contract_data", "salary_data", "ai_analysis"],
    orgIds: [contract.org_id],
    metadata: { includeEpisodes },
  });
  return {
    success: true,
    extractedData,
    linkedEpisodes,
    episodeOptions,
    isSeriesWork,
    hasSavedValidation,
    workIdentifiers: {
      dfiId: work?.dfi_id ?? null,
      tmdbId: work?.tmdb_id ?? null,
      imdbId: work?.imdb_id ?? null,
    },
  };
}

export type ContractValidationSectionKey = "approval" | "rights" | "dates" | "salary" | "series" | "signature" | "ids" | "work";

const CONTRACT_VALIDATION_SECTION_FIELDS: Record<ContractValidationSectionKey, readonly string[]> = {
  approval: [
    "copydan", "svod", "hasCreditClause", "royalty", "royaltyPercent",
    "royaltySourceType", "royaltyResolutionReason", "royaltyAgreementCode",
    "royaltyAgreementTitle", "royaltyAgreementSection", "royaltyTag", "_royaltyResolution",
    "signatureStatus", "signatureDate", "contractDate", "_sources", "_lockedFields",
  ],
  rights: [
    "copydan", "svod", "agreementReferenceStatus", "collectiveAgreement",
    "collectiveAgreementByReference", "hasOverenskomstIncorporation", "rightsNotApplicable",
    "royalty", "royaltyPercent", "aiDataMiningClause", "futureRightsReservation",
    "rightsOverview", "distribution", "hasCreditClause", "_sources", "_lockedFields",
  ],
  dates: ["contractDate", "startDate", "endDate", "_sources", "_lockedFields"],
  salary: [
    "salary", "salaryUnit", "salarySourceType", "salaryConfidence", "salaryNote",
    "needsManualSalaryReview", "workingDays", "workingWeeks",
    "contractType", "isFreelanceContract", "agreementEmploymentForm",
    "pensionPercent", "pensionSupplement", "pensionStatus", "pensionEmployerPercent",
    "pensionEmployeePercent", "pensionTotalPercent", "pensionBasis", "pensionBasisAmount",
    "pensionAgreementCode", "pensionAgreementTitle", "pensionAgreementSection",
    "pensionAgreementSourceUrl", "pensionSourceType", "pensionEvidence", "pensionConfidence", "pensionTag",
    "personalSupplement", "otherSupplements",
    "holidayPayRate", "betaRate", "_sources", "_lockedFields",
  ],
  series: ["seasonNumber", "episodeNumber", "episodeCount", "seasonCount", "_sources", "_lockedFields"],
  signature: ["signatureStatus", "signatureMethod", "signatureDate", "signatureEvidence", "signaturePage", "_sources", "_lockedFields"],
  ids: ["dfiId", "tmdbId", "imdbId"],
  work: [
    "workTitle", "director", "duration", "premiereYear", "genre", "description",
    "productionCountries", "creditedFunction", "creditedRoles", "productionType",
    "_sources", "_lockedFields",
  ],
};

function pickValidationFields(data: Record<string, unknown>, fields: readonly string[]) {
  return Object.fromEntries(fields.filter(key => key in data).map(key => [key, data[key]]));
}

function valueText(value: unknown, fallback = "Ukendt") {
  if (value == null || value === "") return fallback;
  if (Array.isArray(value)) return value.length ? value.join(", ") : fallback;
  return String(value);
}

export async function getContractValidationSummary(contractId: string) {
  const result = await getContractValidation(contractId, false);
  if (!result.success || !result.extractedData) return result;
  const data = result.extractedData;
  const weeklySalary = weeklySalaryWithPersonalSupplement(data);
  const copydan = effectiveCopydanStatus({
    overenskomst: valueText(data.overenskomst, ""),
    validation_data: data,
  });
  return {
    success: true,
    found: result.hasSavedValidation,
    isSeriesWork: result.isSeriesWork,
    summaries: {
      rights: { copydan, streaming: normalizeTriState(data.svod ?? (data.rightsOverview as Record<string, unknown> | undefined)?.streamingforbehold), signature: normalizeTriState(data.signatureStatus) },
      dates: valueText(data.contractDate, "Ingen kontraktdato"),
      salary: [
        weeklySalary ? `${Math.round(weeklySalary).toLocaleString("da-DK")} kr./uge inkl. tillæg` : "Løn ikke fundet",
        valueText(data.pensionTag, ""),
      ].filter(Boolean).join(" · "),
      series: `Sæson ${valueText(data.seasonNumber, "—")} · afsnit ${valueText(data.episodeNumber ?? data.episodeCount, "—")}`,
      signature: normalizeTriState(data.signatureStatus),
      ids: [result.workIdentifiers?.dfiId && `DFI ${result.workIdentifiers.dfiId}`, result.workIdentifiers?.tmdbId && `TMDB ${result.workIdentifiers.tmdbId}`, result.workIdentifiers?.imdbId && `IMDb ${result.workIdentifiers.imdbId}`].filter(Boolean).join(" · ") || "Ingen ID'er",
      work: valueText(data.workTitle, "Ingen værkstitel aflæst"),
    },
  };
}

export async function getContractValidationSection(params: { contractId: string; section: ContractValidationSectionKey }) {
  if (!CONTRACT_VALIDATION_SECTION_FIELDS[params.section]) return { success: false, error: "Ukendt sektion" };
  const result = await getContractValidation(params.contractId, params.section === "series");
  if (!result.success || !result.extractedData) return result;
  const sectionData = pickValidationFields(result.extractedData, CONTRACT_VALIDATION_SECTION_FIELDS[params.section]);
  if (params.section === "ids") {
    sectionData.dfiId = result.workIdentifiers?.dfiId ?? null;
    sectionData.tmdbId = result.workIdentifiers?.tmdbId ?? null;
    sectionData.imdbId = result.workIdentifiers?.imdbId ?? null;
  }
  if ((params.section === "rights" || params.section === "approval") && sectionData.agreementReferenceStatus == null) {
    sectionData.agreementReferenceStatus = [
      sectionData.collectiveAgreement,
      sectionData.collectiveAgreementByReference,
      sectionData.hasOverenskomstIncorporation,
    ].some(value => normalizeTriState(value) === "yes") ? "yes" : "unknown";
  }
  return {
    success: true,
    data: sectionData,
    linkedEpisodes: params.section === "series" ? result.linkedEpisodes : undefined,
    episodeOptions: params.section === "series" ? result.episodeOptions : undefined,
    isSeriesWork: result.isSeriesWork,
  };
}

export async function getAdminContractSeriesEpisodeOptions(params: { contractId: string; seasonNumber: number }) {
  const user = await currentUser();
  if (!user) return { success: false as const, error: "Ikke logget ind", options: [], selectedEpisodes: [] };
  const db = createServiceClient();
  const { data: contract } = await db.from("contracts")
    .select("id,org_id,rights_holder_id,work_id,episode_numbers,works(id,title,type,year,parent_work_id,episode_count,dfi_id,tmdb_id)")
    .eq("id", params.contractId)
    .maybeSingle();
  if (!contract || !(await assertAdminForOrg(db, user.id, contract.org_id))) {
    return { success: false as const, error: "Ikke autoriseret", options: [], selectedEpisodes: [] };
  }
  const relatedWork = Array.isArray(contract.works) ? contract.works[0] : contract.works;
  if (!relatedWork || !contract.work_id) {
    return { success: false as const, error: "Kontrakten mangler et tilknyttet serieværk", options: [], selectedEpisodes: [] };
  }
  const parentId = relatedWork.parent_work_id ?? relatedWork.id;
  const { data: parentWork } = relatedWork.parent_work_id
    ? await db.from("works").select("id,title,type,year,episode_count,dfi_id,tmdb_id").eq("id", parentId).eq("org_id", contract.org_id).maybeSingle()
    : { data: relatedWork };
  if (!parentWork) return { success: false as const, error: "Serien blev ikke fundet", options: [], selectedEpisodes: [] };

  const seasonNumber = Math.max(1, Math.floor(Number(params.seasonNumber) || 1));
  const { data: localChildren } = await db.from("works")
    .select("id,title,season_number,episode_number,parent_work_id")
    .eq("org_id", contract.org_id)
    .eq("parent_work_id", parentId)
    .eq("season_number", seasonNumber)
    .order("episode_number", { ascending: true });
  const external = await resolveExternalSeriesEpisodesForTitle({
    title: parentWork.title,
    year: parentWork.year,
    dfiId: parentWork.dfi_id == null ? null : String(parentWork.dfi_id),
    tmdbId: parentWork.tmdb_id == null ? null : Number(parentWork.tmdb_id),
    seasonNumber,
  });
  const localOptions = episodeOptionsFromLocalChildren(localChildren, seasonNumber);
  const merged = mergeEpisodeOptionsByPriority(localOptions, external.dfiEpisodeOptions, external.tmdbEpisodeOptions);
  const directSelection = Array.isArray(contract.episode_numbers)
    ? contract.episode_numbers.filter((number): number is number => Number.isInteger(number) && number > 0)
    : [];
  let selectedEpisodes = directSelection;
  if (selectedEpisodes.length === 0 && contract.rights_holder_id && (localChildren?.length ?? 0) > 0) {
    const childById = new Map((localChildren ?? []).map(child => [child.id, Number(child.episode_number)]));
    const { data: assignments } = await db.from("work_assignments")
      .select("work_id")
      .eq("org_id", contract.org_id)
      .eq("rights_holder_id", contract.rights_holder_id)
      .in("work_id", [...childById.keys()]);
    selectedEpisodes = (assignments ?? [])
      .map(assignment => childById.get(assignment.work_id) ?? 0)
      .filter(number => number > 0)
      .sort((left, right) => left - right);
  }
  const episodeCount = Math.max(
    Number(parentWork.episode_count ?? 0) || 0,
    external.episodeCount ?? 0,
    ...merged.map(option => option.number),
    ...selectedEpisodes,
    0,
  );
  const options = buildCompleteEpisodeOptions({ episodeCount, externalOptions: merged, localChildren, seasonNumber });
  return { success: true as const, options, selectedEpisodes, seasonNumber };
}

export async function saveContractValidationSection(params: {
  contractId: string;
  section: ContractValidationSectionKey;
  data: Record<string, unknown>;
  lockedFields?: string[];
}) {
  const allowed = CONTRACT_VALIDATION_SECTION_FIELDS[params.section];
  if (!allowed) return { success: false, error: "Ukendt sektion" };
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient();
  const { data: contract } = await db.from("contracts").select("id, org_id").eq("id", params.contractId).single();
  if (!contract || !(await assertAdminForOrg(db, user.id, contract.org_id))) return { success: false, error: "Ikke autoriseret" };
  const { data: existing } = await db.from("contract_validations").select("extracted_data").eq("contract_id", params.contractId).maybeSingle();
  const previous = (existing?.extracted_data ?? {}) as Record<string, unknown>;
  const patch = pickValidationFields(params.data, allowed.filter(key => !key.startsWith("_")));
  if (patch.rightsOverview && typeof patch.rightsOverview === "object") {
    patch.rightsOverview = {
      ...((previous.rightsOverview as Record<string, unknown> | undefined) ?? {}),
      ...(patch.rightsOverview as Record<string, unknown>),
    };
  }
  const sectionFieldSet = new Set(allowed.filter(key => !key.startsWith("_")));
  const previousLocks = Array.isArray(previous._lockedFields) ? previous._lockedFields.filter((key): key is string => typeof key === "string") : [];
  patch._lockedFields = [
    ...previousLocks.filter(key => !sectionFieldSet.has(key)),
    ...(params.lockedFields ?? []).filter(key => sectionFieldSet.has(key)),
  ];
  return saveContractValidation({ contractId: params.contractId, extractedData: patch });
}

export async function updateAdminContractEpisodeAssignments(params: {
  contractId: string;
  selectedWorkIds: string[];
}) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient();
  const { data: contract } = await db
    .from("contracts")
    .select("id, org_id, rights_holder_id, works(id, parent_work_id, type)")
    .eq("id", params.contractId)
    .single();
  if (!contract) return { success: false, error: "Kontrakt ikke fundet" };
  if (!(await assertAdminForOrg(db, user.id, contract.org_id))) return { success: false, error: "Ikke autoriseret" };
  if (!contract.rights_holder_id) return { success: false, error: "Kontrakten mangler et medlem" };

  const relatedWork = Array.isArray(contract.works) ? contract.works[0] : contract.works;
  if (!relatedWork) return { success: false, error: "Kontrakten mangler et værk" };
  const parentId = relatedWork.parent_work_id ?? relatedWork.id;
  const { episodeWorks, error: worksError } = await fetchSeriesEpisodeWorks(db, contract.org_id, parentId);
  if (worksError) return { success: false, error: worksError };
  const allowedIds = new Set(episodeWorks.map(item => item.id));
  const selectedIds = [...new Set(params.selectedWorkIds.filter(id => allowedIds.has(id)))];
  if (selectedIds.length !== new Set(params.selectedWorkIds).size) {
    return { success: false, error: "Et eller flere valgte afsnit tilhører ikke kontraktens serie" };
  }

  const episodeIds = [...allowedIds];
  const { data: existing, error: existingError } = episodeIds.length > 0
    ? await db
      .from("work_assignments")
      .select("id, work_id, role")
      .eq("org_id", contract.org_id)
      .eq("rights_holder_id", contract.rights_holder_id)
      .in("work_id", episodeIds)
    : { data: [], error: null };
  if (existingError) return { success: false, error: existingError.message };

  const selectedSet = new Set(selectedIds);
  const existingWorkIds = new Set((existing ?? []).map(item => item.work_id));
  const removeIds = (existing ?? []).filter(item => !selectedSet.has(item.work_id)).map(item => item.id);
  // Default-rolle udledes fra organisationens terminologi (fx "Klipper" for DFKS), ikke hardcodet.
  const { data: orgForRole } = await db.from("organisations").select("terminology").eq("id", contract.org_id).maybeSingle();
  const defaultRole = resolveDefaultRole(orgForRole ?? null);
  const role = normalizeWorkEditorRole((existing ?? []).find(item => item.role)?.role ?? defaultRole, defaultRole);
  const additions = selectedIds.filter(id => !existingWorkIds.has(id)).map(workId => ({
    org_id: contract.org_id,
    work_id: workId,
    rights_holder_id: contract.rights_holder_id,
    role,
  }));
  if (additions.length > 0) {
    const { error } = await db.from("work_assignments").upsert(additions, { onConflict: "work_id,rights_holder_id,role" });
    if (error) return { success: false, error: error.message };
  }
  if (removeIds.length > 0) {
    const { error } = await db.from("work_assignments").delete().in("id", removeIds);
    if (error) return { success: false, error: error.message };
  }

  const { error: contractError } = await db
    .from("contracts")
    .update({ work_id: selectedIds.length === 1 ? selectedIds[0] : parentId })
    .eq("id", contract.id)
    .eq("org_id", contract.org_id);
  if (contractError) return { success: false, error: contractError.message };

  revalidatePath("/admin/kontrakter");
  revalidatePath("/portal/mine-kontrakter");
  revalidatePath("/portal/mine-vaerker");
  return { success: true, selectedWorkIds: selectedIds };
}

export async function saveContractValidation(params: { contractId: string; extractedData: Record<string, unknown> }) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient();
  const { data: contract } = await db.from("contracts").select("id, org_id").eq("id", params.contractId).single();
  if (!contract) return { success: false, error: "Kontrakt ikke fundet" };
  if (!(await assertAdminForOrg(db, user.id, contract.org_id))) return { success: false, error: "Ikke autoriseret" };

  const ed = params.extractedData as Record<string, unknown>;

  // Editoren sender kun de felter den kender (GROUPS). Flet oven på den
  // eksisterende extracted_data, så øvrige nøgler (fx AI-kildecitater _sources,
  // hasTerminationClause, terminationDaysEditor/Producer, hasIndemnification)
  // ikke slettes ved hver gem.
  const { data: existing } = await db
    .from("contract_validations")
    .select("extracted_data")
    .eq("contract_id", params.contractId)
    .maybeSingle();
  const prevEd = (existing?.extracted_data ?? {}) as Record<string, unknown>;
  const mergedEd = { ...prevEd, ...ed };

  const writeDb = createServiceClient({ audit: {
    actorUserId: user.id,
    actorOrgId: contract.org_id,
    source: "admin",
    correlationId: crypto.randomUUID(),
  } });
  const { error } = await writeDb.from("contract_validations").upsert(
    {
      contract_id: params.contractId,
      org_id: contract.org_id,
      holiday_pay_rate: (mergedEd.holidayPayRate as number) ?? null,
      beta_rate: (mergedEd.betaRate as number) ?? null,
      has_overenskomst_incorporation: normalizeTriState(mergedEd.agreementReferenceStatus) === "yes"
        || !!mergedEd.collectiveAgreement
        || !!mergedEd.collectiveAgreementByReference
        || !!mergedEd.hasOverenskomstIncorporation,
      has_credit_clause: !!(mergedEd.creditedRoles || mergedEd.creditedFunction || mergedEd.hasCreditClause),
      notes: (mergedEd.specialNotes as string) ?? null,
      extracted_data: mergedEd,
      validated_by: user.id,
      validated_at: new Date().toISOString(),
    },
    { onConflict: "contract_id" }
  );
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/kontrakter");
  return { success: true };
}

export async function deleteAdminContractsPermanently(contractIds: string[]) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const ids = [...new Set(contractIds.filter(Boolean))];
  if (ids.length === 0) return { success: false, error: "Ingen kontrakter valgt" };

  const db = createServiceClient();
  const { data: rows, error: fetchErr } = await db
    .from("contracts")
    .select("id, org_id, pdf_url, original_view_pdf_url, processed_pdf_url, document_spatial_data_path")
    .in("id", ids);
  if (fetchErr) return { success: false, error: fetchErr.message };

  const found = rows ?? [];
  if (found.length === 0) return { success: false, error: "Ingen af kontrakterne blev fundet" };
  const [{ data: attachmentRows, error: attachmentFetchError }, { data: documentJobRows, error: documentJobFetchError }] = await Promise.all([
    db.from("contract_attachments").select("pdf_url").in("contract_id", found.map(row => row.id)),
    db.from("contract_document_jobs")
      .select("output_storage_path,original_view_storage_path,spatial_data_path")
      .in("contract_id", found.map(row => row.id)),
  ]);
  if (attachmentFetchError || documentJobFetchError) {
    console.error("[member-contracts] derivative paths could not be loaded", attachmentFetchError?.code ?? documentJobFetchError?.code);
    return { success: false, error: "Kontraktfilerne kunne ikke klargøres til sletning." };
  }

  // Admin skal have rettigheder i hver org kontrakterne tilhører
  const orgIds = [...new Set(found.map(row => row.org_id))];
  for (const orgId of orgIds) {
    if (!(await assertAdminForOrg(db, user.id, orgId))) return { success: false, error: "Ikke autoriseret" };
  }

  const actorOrgId = await requireOrgId(db, user.id);
  const writeDb = createServiceClient({ audit: {
    actorUserId: user.id,
    actorOrgId,
    source: "admin",
    correlationId: crypto.randomUUID(),
  } });

  // Masse-sletning af mere end 20 kontrakter kræver superadmin (server-side spærre)
  if (found.length > 20) {
    const { data: superRows } = await db
      .from("user_org_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "superadmin")
      .limit(1);
    if (!superRows || superRows.length === 0) {
      return { success: false, error: "Kun superadmin kan slette mere end 20 kontrakter ad gangen." };
    }
  }

  const foundIds = found.map(row => row.id);
  const { data: deletedCount, error: deleteError } = await writeDb.rpc("delete_contracts_atomic", { p_ids: foundIds });
  if (deleteError || Number(deletedCount) !== foundIds.length) {
    console.error("[member-contracts] atomic contract delete failed", deleteError?.code ?? "count_mismatch");
    return { success: false, error: "Kontrakterne kunne ikke slettes samlet." };
  }

  const pdfs = [...new Set([
    ...found.flatMap(row => [row.pdf_url, row.original_view_pdf_url, row.processed_pdf_url, row.document_spatial_data_path]),
    ...(attachmentRows ?? []).map(row => row.pdf_url),
    ...(documentJobRows ?? []).flatMap(row => [row.output_storage_path, row.original_view_storage_path, row.spatial_data_path]),
  ].filter((url): url is string => Boolean(url)))];
  let cleanupWarning: string | undefined;
  if (pdfs.length > 0) {
    const { error: storageError } = await writeDb.storage.from(BUCKET).remove(pdfs);
    if (storageError) {
      console.error("[member-contracts] bulk post-delete storage cleanup failed", storageError.name);
      cleanupWarning = "Kontrakterne er slettet, men enkelte filer afventer teknisk oprydning.";
    }
  }

  revalidatePath("/admin/kontrakter");
  return { success: true, deletedCount: foundIds.length, warning: cleanupWarning };
}

export async function addMemberContractComment(contractId: string, message: string) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const text = message.trim();
  if (!text) return { success: false, error: "Skriv en kommentar først." };

  const db = createServiceClient();
  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!rh) return { success: false, error: "Ingen rettighedshaver-profil" };

  const { data: contract } = await db
    .from("contracts")
    .select("id, org_id, rights_holder_id")
    .eq("id", contractId)
    .single();
  if (!contract || contract.rights_holder_id !== rh.id) return { success: false, error: "Kontrakt ikke fundet" };

  const writeDb = createServiceClient({ audit: {
    actorUserId: user.id,
    actorOrgId: contract.org_id,
    actorRole: "member",
    source: "portal",
    correlationId: crypto.randomUUID(),
  } });
  const { data: comment, error } = await writeDb
    .from("contract_comments")
    .insert({
      org_id: contract.org_id,
      contract_id: contract.id,
      author_user_id: user.id,
      author_role: "member",
      message: text,
      member_read_at: new Date().toISOString(),
    })
    .select("id, author_role, message, created_at, member_read_at, admin_read_at")
    .single();

  if (error || !comment) return { success: false, error: error?.message ?? "Kunne ikke gemme kommentaren" };
  revalidatePath("/portal/mine-kontrakter");
  revalidatePath("/admin/kontrakter");
  return { success: true, comment };
}

export async function addAdminContractComment(contractId: string, message: string) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const text = message.trim();
  if (!text) return { success: false, error: "Skriv et svar først." };

  const db = createServiceClient();
  const { data: contract } = await db
    .from("contracts")
    .select("id, org_id, rights_holder_id")
    .eq("id", contractId)
    .single();
  if (!contract) return { success: false, error: "Kontrakt ikke fundet" };
  if (!(await assertAdminForOrg(db, user.id, contract.org_id))) return { success: false, error: "Ikke autoriseret" };

  const writeDb = createServiceClient({ audit: {
    actorUserId: user.id,
    actorOrgId: contract.org_id,
    source: "admin",
    correlationId: crypto.randomUUID(),
  } });
  const { data: comment, error } = await writeDb
    .from("contract_comments")
    .insert({
      org_id: contract.org_id,
      contract_id: contract.id,
      author_user_id: user.id,
      author_role: "admin",
      message: text,
      admin_read_at: new Date().toISOString(),
      member_read_at: null,
    })
    .select("id, author_role, message, created_at, member_read_at, admin_read_at")
    .single();

  if (error || !comment) return { success: false, error: error?.message ?? "Kunne ikke gemme svaret" };
  if (contract.rights_holder_id) {
    try {
      await sendMemberNotification({
        eventKey: `contract-comment:${comment.id}`,
        eventType: "contract_admin_reply",
        orgId: contract.org_id,
        rightsHolderId: contract.rights_holder_id,
        category: "transactional",
        subject: "DFKS har svaret på din kontrakt",
        bodyText: "Der er kommet et nyt svar til din kontrakt i portalen.",
        path: `/portal/mine-kontrakter?contract=${contract.id}`,
        entityType: "contract",
        entityId: contract.id,
      });
    } catch (notificationError) {
      console.error("[notification] kontraktsvar kunne ikke sendes", notificationError);
    }
  }
  revalidatePath("/portal/mine-kontrakter");
  revalidatePath("/admin/kontrakter");
  return { success: true, comment };
}

export type AdminContractUpdate = {
  type?: string;
  overenskomst?: string | null;
  status?: string;
  contract_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  employer_id?: string | null;
  rights_holder_id?: string | null;
  work_id?: string | null;
  working_title?: string | null;
  season_number?: number | null;
  episode_numbers?: number[] | null;
  producer_selections?: ProductionCompanySelection[];
};

export async function queueAdminContractAiExtraction(contractId: string) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient();
  const orgId = await requireOrgId(db, user.id);
  if (!(await assertAdminForOrg(db, user.id, orgId))) return { success: false, error: "Ikke autoriseret" };
  const { data: contract, error: contractError } = await db.from("contracts")
    .select("id,pdf_url,document_processing_status")
    .eq("id", contractId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (contractError) return { success: false, error: contractError.message };
  if (!contract?.pdf_url) return { success: false, error: "Kontrakten mangler en fil" };
  if (contract.pdf_url.toLowerCase().endsWith(".pdf") && !["ready", "not_required"].includes(contract.document_processing_status ?? "")) {
    return { success: false, error: "PDF-behandlingen skal være færdig, før AI-aflæsningen kan startes" };
  }
  const { data: job, error } = await db.from("contract_ai_jobs").insert({
    contract_id: contract.id,
    org_id: orgId,
    status: "queued",
    priority: 0,
  }).select("id").single();
  if (error) return { success: false, error: error.message };
  return { success: true, jobId: job.id };
}

export async function fetchAdminContractEditorData(contractId: string) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient();
  const orgId = await requireOrgId(db, user.id);
  if (!(await assertAdminForOrg(db, user.id, orgId))) return { success: false, error: "Ikke autoriseret" };

  const [contractResult, rightsHoldersResult, worksResult, producerResult] = await Promise.all([
    db.from("contracts")
      .select("id,org_id,type,overenskomst,status,pdf_url,original_view_pdf_url,processed_pdf_url,layout_data,document_processing_status,document_processing_error_code,document_spatial_data_path,document_spatial_schema_version,document_spatial_accuracy,contract_date,start_date,end_date,employer_id,rights_holder_id,work_id,working_title,season_number,episode_numbers,employers(name),rettighedshavere(full_name),works(id,title,year,type,dfi_id,tmdb_id,imdb_id),contract_validations(id,extracted_data,has_credit_clause,has_overenskomst_incorporation),contract_comments(*),contract_attachments(*)")
      .eq("id", contractId)
      .eq("org_id", orgId)
      .maybeSingle(),
    db.from("rettighedshavere")
      .select("id,full_name,org_affiliations!inner(org_id)")
      .eq("org_affiliations.org_id", orgId)
      .order("full_name")
      .limit(1000),
    db.from("works")
      .select("id,title,year,type,dfi_id,tmdb_id,imdb_id")
      .eq("org_id", orgId)
      .order("title")
      .limit(1000),
    db.from("contract_employers")
      .select("employer_id,legal_entity_id,sort_order,employers(name),employer_legal_entities(legal_name,registration_number)")
      .eq("contract_id", contractId)
      .order("sort_order"),
  ]);

  if (contractResult.error) return { success: false, error: contractResult.error.message };
  if (!contractResult.data) return { success: false, error: "Kontrakten blev ikke fundet" };
  if (rightsHoldersResult.error) return { success: false, error: rightsHoldersResult.error.message };
  if (worksResult.error) return { success: false, error: worksResult.error.message };

  const contract = contractResult.data;
  const validation = Array.isArray(contract.contract_validations)
    ? contract.contract_validations[0]
    : contract.contract_validations;
  const relatedWork = Array.isArray(contract.works) ? contract.works[0] : contract.works;
  const employer = Array.isArray(contract.employers) ? contract.employers[0] : contract.employers;
  const rightsHolder = Array.isArray(contract.rettighedshavere) ? contract.rettighedshavere[0] : contract.rettighedshavere;
  let extractedData = mergeContractWorkData({
    extractedData: (validation?.extracted_data ?? {}) as Record<string, unknown>,
    contract,
    work: relatedWork,
    employerName: employer?.name ?? null,
    rightsHolderName: rightsHolder?.full_name ?? null,
  });
  try {
    extractedData = (await applyApprovedAgreementRoyalty(extractedData)).data;
  } catch (error) {
    console.warn("[contract-editor] Royaltyreglen kunne ikke anvendes", error instanceof Error ? error.message : error);
  }
  const sources = extractedData._sources && typeof extractedData._sources === "object"
    ? extractedData._sources as Record<string, string | null>
    : {};
  let layout = contract.layout_data as ContractLayout | null;
  const layoutPath = contract.processed_pdf_url ?? contract.pdf_url;
  if (!layout && layoutPath && documentExtension(layoutPath) === "pdf") {
    try {
      const { data: file } = await db.storage.from(BUCKET).download(layoutPath);
      if (file) {
        layout = buildPdfLayout(await extractPdfTextWithLayout(Buffer.from(await file.arrayBuffer())));
        await db.from("contracts").update({ layout_data: layout }).eq("id", contractId).eq("org_id", orgId);
      }
    } catch (error) {
      console.warn("[contract-editor] Layout kunne ikke bygges", error instanceof Error ? error.message : error);
    }
  }
  const addEvidence = (key: string, value: unknown) => {
    const quote = typeof value === "string" ? value.trim() : "";
    if (!quote || sources[key]) return;
    sources[key] = quote;
    sources[`${key}_clause_id`] = matchCitationToClause(quote, layout);
  };
  addEvidence("employerName", extractedData.employerName ?? extractedData.producerName);
  addEvidence("rightsHolderName", extractedData.rightsHolderName);
  addEvidence("director", extractedData.director);
  addEvidence("signatureEvidence", extractedData.signatureEvidence);
  if (typeof extractedData.signaturePage === "number" || typeof extractedData.signaturePage === "string") {
    sources.signatureEvidence_page = String(extractedData.signaturePage);
  }
  if (!sources.contractType) {
    const evidence = findContractTypeEvidence(contract.type, layout);
    if (evidence) {
      sources.contractType = evidence.quote;
      sources.contractType_focus = evidence.focusText;
      sources.contractType_clause_id = evidence.clauseId;
      sources.contractType_page = String(evidence.page);
    }
  }
  // Normalisér navigationen for alle kilder ét sted. Ældre AI-resultater har
  // ofte citatet, men mangler klausul-id og sidenummer.
  for (const [key, quote] of Object.entries({ ...sources })) {
    if (!quote || key.endsWith("_clause_id") || key.endsWith("_page")) continue;
    const clauseKey = `${key}_clause_id`;
    const pageKey = `${key}_page`;
    const clauseId = sources[clauseKey] ?? matchCitationToClause(quote, layout);
    if (!clauseId) continue;
    sources[clauseKey] = clauseId;
    const clause = layout?.clauses.find(item => item.id === clauseId);
    if (clause?.page && !sources[pageKey]) sources[pageKey] = String(clause.page);
  }
  const storedEvidence = sanitizeStoredContractEvidence(extractedData._evidence);
  const nativeEvidence = resolveNativeLayoutEvidence(sources, layout);
  let spatialEvidence: Record<string, StoredContractFieldEvidence> = {};
  if (
    contract.document_spatial_schema_version === "google-vision-spatial-v3"
    && Number(contract.document_spatial_accuracy ?? 0) >= 0.95
    && contract.document_spatial_data_path
  ) {
    try {
      const { data: spatialJob } = await db.from("contract_document_jobs")
        .select("spatial_data_path,spatial_sha256,spatial_schema_version,spatial_accuracy_score")
        .eq("contract_id", contractId)
        .eq("status", "completed")
        .eq("spatial_data_path", contract.document_spatial_data_path)
        .eq("spatial_schema_version", "google-vision-spatial-v3")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (spatialJob?.spatial_sha256 && Number(spatialJob.spatial_accuracy_score ?? 0) >= 0.95) {
        const { data: file, error: downloadError } = await db.storage.from(BUCKET).download(contract.document_spatial_data_path);
        if (downloadError || !file) throw downloadError ?? new Error("Spatial-artefaktet kunne ikke hentes");
        const artifact = parseVerifiedSpatialV3Artifact(Buffer.from(await file.arrayBuffer()), spatialJob.spatial_sha256);
        spatialEvidence = resolveSpatialV3Evidence(sources, artifact);
      }
    } catch (error) {
      console.warn("[contract-editor] Spatial v3 kunne ikke bruges", error instanceof Error ? error.message : error);
    }
  }
  const evidence = mergeContractEvidence(storedEvidence, nativeEvidence, spatialEvidence);
  if (validation?.id && JSON.stringify(storedEvidence) !== JSON.stringify(evidence)) {
    const nextExtractedData = { ...extractedData, _evidence: evidence };
    const { error: evidenceSaveError } = await db.from("contract_validations")
      .update({ extracted_data: nextExtractedData })
      .eq("id", validation.id)
      .eq("contract_id", contractId);
    if (evidenceSaveError) throw new Error(`Kildekoordinater kunne ikke gemmes: ${evidenceSaveError.message}`);
    extractedData = nextExtractedData;
  }
  const signedUrl = async (path: string | null) => {
    if (!path) return null;
    const { data } = await db.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
    return data?.signedUrl ?? null;
  };
  const [originalUrl, originalViewUrl, commentedUrl] = await Promise.all([
    signedUrl(contract.pdf_url),
    signedUrl(contract.original_view_pdf_url),
    signedUrl(contract.processed_pdf_url),
  ]);
  await db.from("contract_comments")
    .update({ admin_read_at: new Date().toISOString() })
    .eq("contract_id", contractId)
    .eq("author_role", "member")
    .is("admin_read_at", null);
  const producerSelections: ProductionCompanySelection[] = producerResult.error
    ? (contract.employer_id && employer?.name ? [{ employerId: contract.employer_id, canonicalName: employer.name }] : [])
    : (producerResult.data ?? []).map(row => {
        const producer = Array.isArray(row.employers) ? row.employers[0] : row.employers;
        const entity = Array.isArray(row.employer_legal_entities) ? row.employer_legal_entities[0] : row.employer_legal_entities;
        return {
          employerId: row.employer_id,
          legalEntityId: row.legal_entity_id ?? undefined,
          canonicalName: producer?.name ?? "Producent",
          legalName: entity?.legal_name ?? undefined,
          registrationNumber: entity?.registration_number ?? undefined,
        };
      });

  await recordAuditEvent({
    context: auditHeadersContext(await headers(), { userId: user.id, orgId, role: "admin" }, "admin", "admin.contracts.editor"),
    action: "read",
    entityType: "contracts",
    entityId: contractId,
    entityLabel: contract.working_title ?? "Kontrakteditor",
    targetMemberUuid: contract.rights_holder_id,
    purposeCode: "contract_case_management",
    legalBasis: "GDPR Art. 6(1)(b) og 6(1)(f)",
    dataCategories: ["contract_data", "salary_data", "message_data", "ai_analysis"],
    orgIds: [orgId],
  });

  return {
    success: true,
    contract: {
      ...contract,
      validation_data: extractedData,
      validation_has_credit_clause: validation?.has_credit_clause ?? null,
      validation_has_overenskomst_incorporation: validation?.has_overenskomst_incorporation ?? null,
    },
    rightsHolders: rightsHoldersResult.data ?? [],
    works: worksResult.data ?? [],
    producerSelections,
    documents: {
      original: contract.pdf_url ? {
        path: contract.original_view_pdf_url ?? contract.pdf_url,
        url: originalViewUrl ?? originalUrl,
        sourcePath: contract.pdf_url,
        sourceUrl: originalUrl,
        sourceFormat: documentExtension(contract.pdf_url) === "docx"
          ? "docx"
          : documentExtension(contract.pdf_url) === "doc" ? "doc" : documentExtension(contract.pdf_url) === "pdf" ? "pdf" : "unknown",
        convertedForViewing: Boolean(contract.original_view_pdf_url),
      } : null,
      commented: contract.processed_pdf_url ? {
        path: contract.processed_pdf_url,
        url: commentedUrl,
        sourcePath: contract.pdf_url ?? contract.processed_pdf_url,
        sourceUrl: originalUrl,
        sourceFormat: documentExtension(contract.pdf_url) === "docx"
          ? "docx"
          : documentExtension(contract.pdf_url) === "doc" ? "doc" : documentExtension(contract.pdf_url) === "pdf" ? "pdf" : "unknown",
        convertedForViewing: false,
      } : null,
    },
    layout,
    sources,
    evidence,
  };
}

export async function updateAdminContract(contractId: string, values: AdminContractUpdate) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient();
  const orgId = await requireOrgId(db, user.id);
  if (!(await assertAdminForOrg(db, user.id, orgId))) return { success: false, error: "Ikke autoriseret" };
  const { data: existing } = await db.from("contracts").select("id,status,org_id,work_id,rights_holder_id,season_number,episode_numbers").eq("id", contractId).eq("org_id", orgId).maybeSingle();
  if (!existing) return { success: false, error: "Kontrakten blev ikke fundet" };
  const requestedEpisodeScopeChange =
    (values.work_id !== undefined && values.work_id !== existing.work_id) ||
    (values.season_number !== undefined && values.season_number !== existing.season_number) ||
    (values.episode_numbers !== undefined && JSON.stringify(values.episode_numbers ?? null) !== JSON.stringify(existing.episode_numbers ?? null));
  if (values.status === "valideret" && existing.status !== "valideret") {
    const targetWorkId = values.work_id === undefined ? existing.work_id : values.work_id;
    const { data: targetWork } = targetWorkId
      ? await db.from("works").select("type").eq("id", targetWorkId).maybeSingle()
      : { data: null };
    if (requestedEpisodeScopeChange && String(targetWork?.type ?? "").includes("serie")) {
      return { success: false, error: "Gem værks- og afsnitsændringerne først. Rettighedshaveren skal derefter bekræfte afsnittene før validering." };
    }
    const blocker = await contractValidationBlocker(db, {
      id: existing.id,
      work_id: targetWorkId,
      rights_holder_id: values.rights_holder_id === undefined ? existing.rights_holder_id : values.rights_holder_id,
    });
    if (blocker) return { success: false, error: blocker };
  }
  const writeDb = createServiceClient({ audit: {
    actorUserId: user.id,
    actorOrgId: orgId,
    source: "admin",
    correlationId: crypto.randomUUID(),
  } });
  const { producer_selections: producerSelections, status: requestedStatus, ...remainingContractValues } = values;
  const contractValues = requestedStatus === undefined || requestedStatus === "valideret"
    ? remainingContractValues
    : { ...remainingContractValues, status: requestedStatus };
  const { error } = await writeDb.from("contracts").update(contractValues).eq("id", contractId).eq("org_id", orgId);
  if (error) return { success: false, error: error.message };
  if (requestedStatus === "valideret" && existing.status !== "valideret") {
    const { error: validationError } = await writeDb.rpc("validate_contracts_explicitly", {
      p_actor_user_id: user.id,
      p_org_id: orgId,
      p_contract_ids: [contractId],
    });
    if (validationError) return { success: false, error: validationError.message };
  }
  if (requestedEpisodeScopeChange) {
    await writeDb.from("contract_episode_confirmations").update({ invalidated_at: new Date().toISOString() }).eq("contract_id", contractId).is("invalidated_at", null);
  }
  if (producerSelections) {
    try {
      await syncContractProducerRelations(writeDb, contractId, producerSelections, "admin");
    } catch (relationError) {
      return { success: false, error: relationError instanceof Error ? relationError.message : "Producentrelationer kunne ikke gemmes" };
    }
  }
  if (existing.status !== "valideret" && values.status === "valideret" && values.rights_holder_id) {
    try {
      await sendMemberNotification({ eventKey: `contract-validated:${contractId}`, eventType: "contract_validated", orgId, rightsHolderId: values.rights_holder_id, category: "transactional", subject: "Din kontrakt er valideret", bodyText: "DFKS har valideret din kontrakt. Du kan se resultatet i portalen.", path: `/portal/mine-kontrakter?contract=${contractId}`, entityType: "contract", entityId: contractId });
    } catch (notificationError) {
      console.error("[notification] valideringsmail kunne ikke sendes", notificationError);
    }
  }
  revalidatePath("/admin/kontrakter");
  revalidatePath("/portal/mine-kontrakter");
  return { success: true };
}

export async function validateAdminContracts(contractIds: string[]) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const ids = [...new Set(contractIds)].slice(0, 200);
  if (!ids.length) return { success: true, count: 0 };
  const db = createServiceClient();
  const orgId = await requireOrgId(db, user.id);
  if (!(await assertAdminForOrg(db, user.id, orgId))) return { success: false, error: "Ikke autoriseret" };
  const { data: contracts, error: fetchError } = await db.from("contracts").select("id,status,work_id,rights_holder_id").eq("org_id", orgId).in("id", ids);
  if (fetchError) return { success: false, error: fetchError.message };
  for (const contract of contracts ?? []) {
    const blocker = await contractValidationBlocker(db, contract);
    if (blocker) return { success: false, error: blocker };
  }
  const toValidate = (contracts ?? []).filter(contract => contract.status !== "valideret");
  if (toValidate.length) {
    const writeDb = createServiceClient({ audit: {
      actorUserId: user.id,
      actorOrgId: orgId,
      source: "admin",
      correlationId: crypto.randomUUID(),
    } });
    const { error } = await writeDb.rpc("validate_contracts_explicitly", {
      p_actor_user_id: user.id,
      p_org_id: orgId,
      p_contract_ids: toValidate.map(contract => contract.id),
    });
    if (error) return { success: false, error: error.message };
  }
  for (const contract of toValidate) {
    if (!contract.rights_holder_id) continue;
    try {
      await sendMemberNotification({ eventKey: `contract-validated:${contract.id}`, eventType: "contract_validated", orgId, rightsHolderId: contract.rights_holder_id, category: "transactional", subject: "Din kontrakt er valideret", bodyText: "DFKS har valideret din kontrakt. Du kan se resultatet i portalen.", path: `/portal/mine-kontrakter?contract=${contract.id}`, entityType: "contract", entityId: contract.id });
    } catch (notificationError) {
      console.error("[notification] bulk-valideringsmail kunne ikke sendes", notificationError);
    }
  }
  revalidatePath("/admin/kontrakter");
  revalidatePath("/portal/mine-kontrakter");
  return { success: true, count: toValidate.length };
}

export async function markContractCommentsRead(contractId: string, viewerRole: "admin" | "member" = "member") {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const db = createServiceClient();
  const { data: contract } = await db
    .from("contracts")
    .select("id, org_id, rights_holder_id")
    .eq("id", contractId)
    .single();
  if (!contract) return { success: false, error: "Kontrakt ikke fundet" };

  const now = new Date().toISOString();

  // Rollen bestemmes af HVILKEN side der kalder (admin vs portal), ikke af hvem
  // brugeren er — ellers fejler mark-læst når admin selv er rettighedshaveren.
  if (viewerRole === "admin") {
    if (!(await assertAdminForOrg(db, user.id, contract.org_id))) return { success: false, error: "Ikke autoriseret" };
  } else {
    const { data: rh } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).maybeSingle();
    if (!rh || rh.id !== contract.rights_holder_id) return { success: false, error: "Ikke autoriseret" };
  }

  const asMember = viewerRole === "member";
  // Medlem markerer admin-beskeder læst; admin markerer medlem-beskeder læst.
  const query = db
    .from("contract_comments")
    .update(asMember ? { member_read_at: now } : { admin_read_at: now })
    .eq("contract_id", contractId)
    .eq("author_role", asMember ? "admin" : "member")
    .is(asMember ? "member_read_at" : "admin_read_at", null);

  const { error } = await query;
  if (error) return { success: false, error: error.message };

  revalidatePath("/portal/mine-kontrakter");
  revalidatePath("/admin/kontrakter");
  return { success: true };
}

export async function createAdminEmployer(params: { name: string; cvr?: string | null }) {
  const user = await currentUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const db = createServiceClient();
  const orgId = await requireOrgId(db, user.id);
  if (!(await assertAdminForOrg(db, user.id, orgId))) {
    return { success: false, error: "Ikke autoriseret" };
  }

  const normalizedCvr = params.cvr?.replace(/\D/g, "") || null;
  if (normalizedCvr && !/^\d{8}$/.test(normalizedCvr)) return { success: false, error: "Et CVR-nummer skal bestå af 8 cifre" };
  if (normalizedCvr) {
    const { data: existingRegistration } = await db.from("employer_legal_entities").select("employer_id").eq("registration_country", "DK").eq("registration_type", "CVR").eq("registration_number", normalizedCvr).maybeSingle();
    if (existingRegistration) return { success: false, error: "CVR-nummeret er allerede registreret under et andet kanonisk selskab" };
  }
  const { data, error } = await db
    .from("employers")
    .insert({
      name: params.name.trim(),
      cvr: normalizedCvr,
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  if (normalizedCvr) {
    const legal = await db.from("employer_legal_entities").insert({ employer_id: data.id, legal_name: data.name, registration_country: "DK", registration_type: "CVR", registration_number: normalizedCvr, entity_kind: "company", is_primary: true, created_by: user.id });
    if (legal.error && legal.error.code !== "42P01" && legal.error.code !== "PGRST205") {
      await db.from("employers").delete().eq("id", data.id);
      return { success: false, error: legal.error.message };
    }
  }
  return { success: true, employer: data };
}

export async function checkRightsHolderName(name: string) {
  try {
    const user = await currentUser();
    if (!user) return { success: false, error: "Ikke logget ind" };
    const db = createServiceClient();
    const orgId = await requireOrgId(db, user.id);
    if (!(await assertAdminForOrg(db, user.id, orgId))) return { success: false, error: "Ikke autoriseret" };
    const res = await tjekNavn(name, undefined, orgId);
    return { success: true, result: res };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "Navnetjek fejlede" };
  }
}
