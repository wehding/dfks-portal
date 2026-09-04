import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/uuid";
import { isSeriesType } from "@/lib/series-episodes";
import { hasCompleteAssignmentDistribution, hasResolvedShareDistribution } from "@/lib/contract-validation-readiness";

export const ADMIN_CONTRACT_OWNERSHIP_FILTERS = [
  "all",
  "missing",
  "proposed",
  "review",
  "conflict",
  "confirmed",
  "corrected",
] as const;

export type AdminContractOwnershipFilter = typeof ADMIN_CONTRACT_OWNERSHIP_FILTERS[number];

export type AdminContractFilterParams = {
  search?: string;
  status?: string;
  type?: string;
  ownership?: AdminContractOwnershipFilter;
  rightsHolderId?: string | null;
  sortKey?: "production" | "rightsHolder" | "employer" | "type" | "overenskomst" | "period" | "status";
  sortDir?: "asc" | "desc";
};

export const ADMIN_CONTRACT_VIRTUAL_STATUSES = [
  "all",
  "beskeder",
  "missingWork",
  "validationPending",
  "validationRecommended",
  "documentProcessing",
  "documentReady",
  "documentNeedsReview",
  "documentFailed",
] as const;

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

export function isAdminContractVirtualStatus(status: string | undefined) {
  return !status || (ADMIN_CONTRACT_VIRTUAL_STATUSES as readonly string[]).includes(status);
}

export async function matchingAdminContractIds(
  db: SupabaseClient,
  orgId: string,
  params: AdminContractFilterParams,
) {
  let ids: Set<string> | null = null;
  const q = normalizeSearch(params.search);

  if (q) {
    const like = `%${q}%`;
    const matches = new Set<string>();
    if (isUuid(q)) {
      const result = await db.from("contracts").select("id").eq("org_id", orgId).eq("id", q).limit(1);
      if (result.error) throw new Error(result.error.message);
      for (const row of result.data ?? []) matches.add(row.id);
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
      const result = await db.from("contracts")
        .select("id")
        .eq("org_id", orgId)
        .or(`contract_date.ilike.%${numeric}%,start_date.ilike.%${numeric}%,end_date.ilike.%${numeric}%`)
        .limit(5000);
      if (result.error) throw new Error(result.error.message);
      for (const row of result.data ?? []) matches.add(row.id);
    }

    const [holders, employers, works] = await Promise.all([
      db
        .from("rettighedshavere")
        .select("id,org_affiliations!inner(org_id)")
        .eq("org_affiliations.org_id", orgId)
        .ilike("full_name", like)
        .limit(5000),
      db.from("employers").select("id").ilike("name", like).limit(5000),
      db.from("works").select("id").eq("org_id", orgId).ilike("title", like).limit(5000),
    ]);
    const lookupError = holders.error ?? employers.error ?? works.error;
    if (lookupError) throw new Error(lookupError.message);
    const holderIds = uniqueIds((holders.data ?? []).map(row => row.id));
    const employerIds = uniqueIds((employers.data ?? []).map(row => row.id));
    const workIds = uniqueIds((works.data ?? []).map(row => row.id));
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
      const result = await db.from("contracts").select("id").eq("org_id", orgId).is("work_id", null).limit(5000);
      if (result.error) throw new Error(result.error.message);
      for (const row of result.data ?? []) matches.add(row.id);
    }
    if (q.includes("mangler") && (q.includes("ejer") || q.includes("rettighedshaver"))) {
      const result = await db.from("contracts").select("id").eq("org_id", orgId).is("rights_holder_id", null).limit(5000);
      if (result.error) throw new Error(result.error.message);
      for (const row of result.data ?? []) matches.add(row.id);
    }
    ids = intersectIds(ids, matches);
  }

  if (params.rightsHolderId) {
    const result = await db.from("contracts").select("id").eq("org_id", orgId).eq("rights_holder_id", params.rightsHolderId).limit(5000);
    if (result.error) throw new Error(result.error.message);
    ids = intersectIds(ids, (result.data ?? []).map(row => row.id));
  }

  if (params.status === "beskeder") {
    const result = await db.from("contract_comments").select("contract_id").eq("org_id", orgId).eq("author_role", "member").is("admin_read_at", null).limit(5000);
    if (result.error) throw new Error(result.error.message);
    ids = intersectIds(ids, (result.data ?? []).map(row => row.contract_id));
  } else if (params.status === "missingWork") {
    const result = await db.from("contracts").select("id").eq("org_id", orgId).is("work_id", null).neq("status", "valideret").limit(5000);
    if (result.error) throw new Error(result.error.message);
    ids = intersectIds(ids, (result.data ?? []).map(row => row.id));
  } else if (params.status === "validationPending") {
    const result = await db
      .from("contracts")
      .select(`
        id,
        work_id,
        rights_holder_id,
        episode_numbers,
        works(id, type, parent_work_id),
        contract_validations(extracted_data)
      `)
      .eq("org_id", orgId)
      .eq("status", "kladde")
      .not("work_id", "is", null)
      .not("rights_holder_id", "is", null)
      .limit(5000);
    if (result.error) throw new Error(result.error.message);

    type CandidateRow = {
      id: string;
      work_id: string;
      rights_holder_id: string;
      episode_numbers: number[] | null;
      works: { id: string; type: string | null; parent_work_id: string | null } | Array<{ id: string; type: string | null; parent_work_id: string | null }> | null;
      contract_validations: { extracted_data: Record<string, unknown> | null } | Array<{ extracted_data: Record<string, unknown> | null }> | null;
    };

    const candidates = (result.data ?? []) as unknown as CandidateRow[];

    // 1. Afsnitsafklaring: Hvis værket er en serie, skal der være valgt mindst ét afsnit
    const episodePassingCandidates = candidates.filter(candidate => {
      const work = Array.isArray(candidate.works) ? candidate.works[0] : candidate.works;
      const isSeries = Boolean(
        work && (
          isSeriesType(work.type) ||
          work.parent_work_id
        )
      );
      if (isSeries) {
        return Array.isArray(candidate.episode_numbers) && candidate.episode_numbers.length > 0;
      }
      return true;
    });

    // 2. Solo- / medklipperafklaring:
    // Solo/medklipper-status gemmes i valideringsdata og i den særskilte
    // samarbejdsgennemgang. Der findes ikke et solo_confirmed-felt på contracts.
    const needsLookup = episodePassingCandidates.filter(candidate => {
      const val = Array.isArray(candidate.contract_validations)
        ? candidate.contract_validations[0]
        : candidate.contract_validations;
      const ed = val?.extracted_data as Record<string, unknown> | undefined;
      return !(ed?.soloConfirmed || ed?.isSoloClipped);
    });

    const clarifiedViaExternal = new Set<string>();
    if (needsLookup.length > 0) {
      const workIds = [...new Set(needsLookup.map(c => c.work_id))];
      const holderIds = [...new Set(needsLookup.map(c => c.rights_holder_id))];

      const [reviewsRes, assignmentsRes, shareCasesRes] = await Promise.all([
        db
          .from("member_work_collaboration_reviews")
          .select("rights_holder_id, work_id, status")
          .eq("org_id", orgId)
          .in("work_id", workIds)
          .in("rights_holder_id", holderIds)
          .eq("status", "solo_confirmed"),
        db
          .from("work_assignments")
          .select("work_id, rights_holder_id, share_percent")
          .eq("org_id", orgId)
          .in("work_id", workIds),
        db
          .from("work_share_cases")
          .select("work_id,status,reserve_percent,work_share_participants(rights_holder_id,final_percent,excluded_at)")
          .eq("org_id", orgId)
          .in("work_id", workIds),
      ]);

      const clarifiedReviews = new Set(
        (reviewsRes.data ?? []).map(r => `${r.rights_holder_id}:${r.work_id}`)
      );
      const assignmentsByWork = new Map<string, Array<{ rights_holder_id: string | null; share_percent: number | string | null }>>();
      for (const row of assignmentsRes.data ?? []) {
        if (!assignmentsByWork.has(row.work_id)) assignmentsByWork.set(row.work_id, []);
        assignmentsByWork.get(row.work_id)!.push(row);
      }
      const worksWithCompleteAssignments = new Set(
        [...assignmentsByWork.entries()]
          .filter(([, assignments]) => hasCompleteAssignmentDistribution(assignments))
          .map(([workId]) => workId)
      );
      const worksWithResolvedShareCases = new Set(
        (shareCasesRes.data ?? [])
          .filter(shareCase => hasResolvedShareDistribution(shareCase))
          .map(shareCase => shareCase.work_id)
      );

      for (const candidate of needsLookup) {
        const reviewKey = `${candidate.rights_holder_id}:${candidate.work_id}`;
        if (
          clarifiedReviews.has(reviewKey) ||
          worksWithCompleteAssignments.has(candidate.work_id) ||
          worksWithResolvedShareCases.has(candidate.work_id)
        ) {
          clarifiedViaExternal.add(candidate.id);
        }
      }
    }

    const readyIds = episodePassingCandidates
      .filter(candidate => {
        const val = Array.isArray(candidate.contract_validations)
          ? candidate.contract_validations[0]
          : candidate.contract_validations;
        const ed = val?.extracted_data as Record<string, unknown> | undefined;
        if (ed?.soloConfirmed || ed?.isSoloClipped) return true;
        return clarifiedViaExternal.has(candidate.id);
      })
      .map(c => c.id);

    ids = intersectIds(ids, readyIds);
  } else if (params.status === "validationRecommended") {
    const result = await db.from("contract_validations").select("contract_id,has_credit_clause,has_overenskomst_incorporation").or("has_credit_clause.eq.false,has_overenskomst_incorporation.eq.false").limit(5000);
    if (result.error) throw new Error(result.error.message);
    ids = intersectIds(ids, (result.data ?? []).map(row => row.contract_id));
  } else if (params.status === "documentProcessing") {
    const result = await db.from("contracts").select("id").eq("org_id", orgId).in("document_processing_status", ["pending", "processing"]).limit(5000);
    if (result.error) throw new Error(result.error.message);
    ids = intersectIds(ids, (result.data ?? []).map(row => row.id));
  } else if (params.status === "documentReady") {
    const result = await db.from("contracts").select("id").eq("org_id", orgId).in("document_processing_status", ["ready", "not_required"]).limit(5000);
    if (result.error) throw new Error(result.error.message);
    ids = intersectIds(ids, (result.data ?? []).map(row => row.id));
  } else if (params.status === "documentNeedsReview") {
    const result = await db.from("contracts").select("id").eq("org_id", orgId).eq("document_processing_status", "needs_review").limit(5000);
    if (result.error) throw new Error(result.error.message);
    ids = intersectIds(ids, (result.data ?? []).map(row => row.id));
  } else if (params.status === "documentFailed") {
    const result = await db.from("contracts").select("id").eq("org_id", orgId).eq("document_processing_status", "failed").limit(5000);
    if (result.error) throw new Error(result.error.message);
    ids = intersectIds(ids, (result.data ?? []).map(row => row.id));
  }

  const ownership = (ADMIN_CONTRACT_OWNERSHIP_FILTERS as readonly string[]).includes(params.ownership ?? "all")
    ? params.ownership ?? "all"
    : "all";
  if (ownership === "missing") {
    const result = await db.from("contracts").select("id").eq("org_id", orgId).is("rights_holder_id", null).limit(5000);
    if (result.error) throw new Error(result.error.message);
    ids = intersectIds(ids, (result.data ?? []).map(row => row.id));
  } else if (ownership !== "all") {
    let query = db.from("contract_owner_verifications").select("contract_id").eq("org_id", orgId);
    if (ownership === "proposed") query = query.not("proposed_rights_holder_id", "is", null).in("status", ["pending", "conflict", "correction_proposed"]);
    else if (ownership === "review") query = query.in("status", ["pending", "conflict", "correction_proposed", "blocked"]);
    else if (ownership === "conflict") query = query.eq("status", "conflict");
    else if (ownership === "confirmed") query = query.eq("status", "confirmed");
    else if (ownership === "corrected") query = query.eq("status", "corrected");
    const result = await query.limit(5000);
    if (result.error) throw new Error(result.error.message);
    ids = intersectIds(ids, (result.data ?? []).map(row => row.contract_id));
  }

  return ids;
}

export function applyAdminContractFilters<T>(
  query: T,
  params: AdminContractFilterParams,
  matchedIds: Set<string> | null,
) {
  let next = query as T & {
    in: (column: string, values: string[]) => typeof next;
    eq: (column: string, value: string) => typeof next;
  };
  if (matchedIds) next = next.in("id", [...matchedIds]);
  if (params.status && !isAdminContractVirtualStatus(params.status)) next = next.eq("status", params.status);
  if (params.type && params.type !== "all") next = next.eq("type", params.type);
  return next as T;
}
