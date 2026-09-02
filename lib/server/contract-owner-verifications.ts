import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSpatialV3Evidence } from "@/lib/contract-field-evidence";
import { postgrestIlikePattern } from "@/lib/postgrest-search";
import { parseVerifiedSpatialV3Artifact } from "@/lib/server/contract-spatial-artifact";
import type {
  ContractOwnerAssignmentOrigin,
  ContractOwnerVerificationDetail,
  ContractOwnerVerificationListItem,
  ContractOwnerVerificationPageInput,
  ContractOwnerVerificationStatus,
} from "@/lib/contract-owner-verification-types";

type OwnershipCaller = {
  userId: string;
  orgId: string;
  role: "superadmin" | "admin" | "org-admin";
};

type QueueRow = Record<string, unknown>;

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOr(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function shortProfileLabel(id: string) {
  return `Profil ${id.slice(0, 8)}`;
}

function mapQueueRow(row: QueueRow): ContractOwnerVerificationListItem {
  const assignedId = stringOrNull(row.assigned_rights_holder_id);
  const proposedId = stringOrNull(row.proposed_rights_holder_id);
  const contractId = String(row.contract_id);
  return {
    contractId,
    orgId: String(row.org_id),
    workingTitle: stringOrNull(row.working_title),
    contractStatus: String(row.contract_status ?? "kladde"),
    assignedRightsHolder: assignedId ? {
      id: assignedId,
      name: String(row.assigned_rights_holder_name ?? "Ukendt rettighedshaver"),
      secondaryLabel: shortProfileLabel(assignedId),
    } : null,
    proposedRightsHolder: proposedId ? {
      id: proposedId,
      name: String(row.proposed_rights_holder_name ?? "Ukendt rettighedshaver"),
      secondaryLabel: shortProfileLabel(proposedId),
    } : null,
    verificationStatus: String(row.verification_status ?? row.status ?? "pending") as ContractOwnerVerificationStatus,
    assignmentOrigin: String(row.assignment_origin ?? "unknown") as ContractOwnerAssignmentOrigin,
    reasonCode: stringOrNull(row.reason_code),
    revision: numberOr(row.revision, 1),
    updatedAt: String(row.updated_at ?? new Date(0).toISOString()),
    documentProcessingStatus: stringOrNull(row.document_processing_status),
    documentProcessingErrorCode: stringOrNull(row.document_processing_error_code),
    // The RPC verifies that bound jobs are still current and complete. Do not
    // infer availability from a stale foreign key in the application layer.
    aiEvidenceAvailable: Boolean(row.ai_evidence_available),
    spatialEvidenceAvailable: Boolean(row.spatial_evidence_available),
    versionGroupId: String(row.version_group_id ?? contractId),
    versionIndex: numberOr(row.version_index, 1),
    versionCount: numberOr(row.version_count, 1),
    isCurrentVersion: row.is_current_version !== false,
  };
}

function normalizedPageInput(input: ContractOwnerVerificationPageInput = {}) {
  return {
    page: Math.max(1, Math.floor(Number(input.page) || 1)),
    pageSize: Math.min(100, Math.max(1, Math.floor(Number(input.pageSize) || 50))),
    search: input.search?.trim().slice(0, 120) || null,
    status: input.status && input.status !== "all" ? input.status : null,
    assignmentOrigin: input.assignmentOrigin && input.assignmentOrigin !== "all" ? input.assignmentOrigin : null,
  };
}

export async function listContractOwnerVerifications(
  db: SupabaseClient,
  caller: OwnershipCaller,
  input: ContractOwnerVerificationPageInput = {},
) {
  const params = normalizedPageInput(input);
  const offset = (params.page - 1) * params.pageSize;
  const result = await db.rpc("list_contract_owner_verification_queue", {
    p_org_id: caller.orgId,
    p_actor_user_id: caller.userId,
    p_actor_role: caller.role,
    p_statuses: params.status ? [params.status] : null,
    p_assignment_origins: params.assignmentOrigin ? [params.assignmentOrigin] : null,
    p_search: params.search,
    p_limit: params.pageSize,
    p_offset: offset,
  });
  if (result.error) throw new Error(result.error.message);
  const rows = (result.data ?? []) as QueueRow[];
  const items = rows.map(mapQueueRow);
  const total = numberOr(rows[0]?.total_count, 0);
  return {
    items,
    page: params.page,
    pageSize: params.pageSize,
    total,
    hasMore: offset + items.length < total,
  };
}

async function versionMetadata(db: SupabaseClient, contractId: string, orgId: string) {
  const chainIds: string[] = [contractId];
  let cursor = contractId;
  for (let depth = 0; depth < 100; depth += 1) {
    const previous = await db.from("contracts").select("id")
      .eq("org_id", orgId).eq("superseded_by_contract_id", cursor).maybeSingle();
    if (previous.error) throw new Error(previous.error.message);
    if (!previous.data?.id || chainIds.includes(previous.data.id)) break;
    chainIds.unshift(previous.data.id);
    cursor = previous.data.id;
  }
  cursor = contractId;
  for (let depth = 0; depth < 100; depth += 1) {
    const next = await db.from("contracts").select("superseded_by_contract_id")
      .eq("id", cursor).eq("org_id", orgId).maybeSingle();
    if (next.error) throw new Error(next.error.message);
    if (!next.data?.superseded_by_contract_id || chainIds.includes(next.data.superseded_by_contract_id)) break;
    chainIds.push(next.data.superseded_by_contract_id);
    cursor = next.data.superseded_by_contract_id;
  }
  const index = Math.max(0, chainIds.indexOf(contractId));
  return {
    versionGroupId: chainIds[0] ?? contractId,
    versionIndex: index + 1,
    versionCount: chainIds.length,
    isCurrentVersion: index === chainIds.length - 1,
  };
}

export async function searchActiveContractOwnerCandidates(
  db: SupabaseClient,
  orgId: string,
  rawQuery: string,
  limit = 20,
) {
  const pattern = postgrestIlikePattern(rawQuery, 100);
  if (!pattern || rawQuery.trim().length < 2) return [];
  const today = new Date().toISOString().slice(0, 10);
  const safeLimit = Math.min(20, Math.max(1, Math.floor(limit)));

  const affiliationSelection = "rights_holder_id,member_no,rettighedshavere!inner(id,full_name)";
  const [nameMatches, memberNumberMatches] = await Promise.all([
    db.from("org_affiliations")
      .select(affiliationSelection)
      .eq("org_id", orgId)
      .or(`valid_from.is.null,valid_from.lte.${today}`)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .is("rettighedshavere.archived_at", null)
      .or(`full_name.ilike.${pattern},email.ilike.${pattern}`, { referencedTable: "rettighedshavere" })
      .order("full_name", { referencedTable: "rettighedshavere" })
      .limit(safeLimit),
    db.from("org_affiliations")
      .select(affiliationSelection)
      .eq("org_id", orgId)
      .ilike("member_no", pattern)
      .or(`valid_from.is.null,valid_from.lte.${today}`)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .is("rettighedshavere.archived_at", null)
      .order("full_name", { referencedTable: "rettighedshavere" })
      .limit(safeLimit),
  ]);
  const searchError = nameMatches.error ?? memberNumberMatches.error;
  if (searchError) throw new Error(searchError.message);
  const candidates = new Map<string, { id: string; name: string; memberNumber: string | null }>();
  for (const row of [...(nameMatches.data ?? []), ...(memberNumberMatches.data ?? [])]) {
    const relation = Array.isArray(row.rettighedshavere)
      ? row.rettighedshavere[0]
      : row.rettighedshavere;
    if (!row.rights_holder_id || !relation?.full_name) continue;
    candidates.set(row.rights_holder_id, {
      id: row.rights_holder_id,
      name: relation.full_name,
      memberNumber: row.member_no?.trim() || null,
    });
  }
  return [...candidates.values()]
    .sort((left, right) => left.name.localeCompare(right.name, "da"))
    .slice(0, safeLimit)
    .map(candidate => ({
      id: candidate.id,
      name: candidate.name,
      secondaryLabel: candidate.memberNumber
        ? `Medlemsnr. ${candidate.memberNumber}`
        : shortProfileLabel(candidate.id),
    }));
}

export async function getContractOwnerVerificationDetail(
  db: SupabaseClient,
  caller: OwnershipCaller,
  contractId: string,
): Promise<ContractOwnerVerificationDetail | null> {
  const [verificationResult, contractResult] = await Promise.all([
    db.from("contract_owner_verifications").select("*").eq("contract_id", contractId).eq("org_id", caller.orgId).maybeSingle(),
    db.from("contracts").select("id,org_id,working_title,status,type,rights_holder_id,pdf_url,original_view_pdf_url,processed_pdf_url,document_processing_status,document_processing_error_code,superseded_by_contract_id")
      .eq("id", contractId).eq("org_id", caller.orgId).maybeSingle(),
  ]);
  const error = verificationResult.error ?? contractResult.error;
  if (error) throw new Error(error.message);
  if (!verificationResult.data || !contractResult.data) return null;
  const [aiResult, documentResult] = await Promise.all([
    verificationResult.data.evidence_ai_job_id
      ? db.from("contract_ai_jobs")
        .select("id,result_data,provider,model,prompt_version,schema_version,completed_at")
        .eq("id", verificationResult.data.evidence_ai_job_id)
        .eq("contract_id", contractId).eq("org_id", caller.orgId)
        .eq("status", "done").eq("stage", "complete")
        .is("attachment_id", null).is("superseded_by_job_id", null).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    verificationResult.data.evidence_document_job_id
      ? db.from("contract_document_jobs")
        .select("id,status,page_count,ocr_applied,spatial_data_path,spatial_sha256,spatial_schema_version,spatial_accuracy_score")
        .eq("id", verificationResult.data.evidence_document_job_id)
        .eq("contract_id", contractId).eq("org_id", caller.orgId)
        .is("superseded_by_job_id", null).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const evidenceError = aiResult.error ?? documentResult.error;
  if (evidenceError) throw new Error(evidenceError.message);

  const holderIds = [verificationResult.data.assigned_rights_holder_id, verificationResult.data.proposed_rights_holder_id].filter(Boolean);
  const holderResult = holderIds.length
    ? await db.from("rettighedshavere").select("id,full_name").in("id", holderIds)
    : { data: [], error: null };
  if (holderResult.error) throw new Error(holderResult.error.message);
  const holderNames = new Map((holderResult.data ?? []).map(row => [row.id, row.full_name]));
  const aiRaw = aiResult.data?.result_data && typeof aiResult.data.result_data === "object"
    ? aiResult.data.result_data as Record<string, unknown>
    : null;
  const proposedName = typeof aiRaw?.rightsHolderName === "string" ? aiRaw.rightsHolderName.trim() || null : null;
  const rawSources = aiRaw?._sources && typeof aiRaw._sources === "object"
    ? aiRaw._sources as Record<string, unknown>
    : null;
  const sourceQuote = typeof rawSources?.rightsHolderName === "string"
    ? rawSources.rightsHolderName.trim() || null
    : proposedName;

  let ownerEvidence = null;
  const document = documentResult.data;
  if (
    document?.status === "completed"
    && document.spatial_schema_version === "google-vision-spatial-v3"
    && Number(document.spatial_accuracy_score ?? 0) >= 0.95
    && document.spatial_data_path
    && document.spatial_sha256
    && document.spatial_sha256 === verificationResult.data.evidence_spatial_sha256
    && document.spatial_schema_version === verificationResult.data.evidence_spatial_schema_version
    && sourceQuote
  ) {
    try {
      const file = await db.storage.from("kontrakter").download(document.spatial_data_path);
      if (file.error || !file.data) throw file.error ?? new Error("Spatial-artefakt mangler");
      const artifact = parseVerifiedSpatialV3Artifact(Buffer.from(await file.data.arrayBuffer()), document.spatial_sha256);
      const evidence = resolveSpatialV3Evidence({ rightsHolderName: sourceQuote }, artifact).rightsHolderName;
      if (evidence) ownerEvidence = { documentJobId: document.id, ...evidence };
    } catch {
      // Evidence is optional. A broken or stale artifact must never expose a
      // storage path nor make the ownership record unreadable.
      ownerEvidence = null;
    }
  }

  const version = await versionMetadata(db, contractId, caller.orgId);
  const queueItem = mapQueueRow({
    ...verificationResult.data,
    verification_status: verificationResult.data.status,
    working_title: contractResult.data.working_title,
    contract_status: contractResult.data.status,
    document_processing_status: contractResult.data.document_processing_status,
    document_processing_error_code: contractResult.data.document_processing_error_code,
    assigned_rights_holder_name: verificationResult.data.assigned_rights_holder_id
      ? holderNames.get(verificationResult.data.assigned_rights_holder_id) : null,
    proposed_rights_holder_name: verificationResult.data.proposed_rights_holder_id
      ? holderNames.get(verificationResult.data.proposed_rights_holder_id) : null,
    ai_evidence_available: Boolean(aiResult.data),
    spatial_evidence_available: Boolean(ownerEvidence),
    version_group_id: version.versionGroupId,
    version_index: version.versionIndex,
    version_count: version.versionCount,
    is_current_version: version.isCurrentVersion,
  });

  return {
    verification: {
      contractId,
      orgId: caller.orgId,
      status: queueItem.verificationStatus,
      assignmentOrigin: queueItem.assignmentOrigin,
      reasonCode: queueItem.reasonCode,
      evidenceSubjectRightsHolderId: verificationResult.data.evidence_subject_rights_holder_id ?? null,
      revision: queueItem.revision,
      reviewedAt: verificationResult.data.reviewed_at ?? null,
    },
    assignedRightsHolder: queueItem.assignedRightsHolder,
    proposedRightsHolder: queueItem.proposedRightsHolder,
    contract: {
      id: contractResult.data.id,
      orgId: contractResult.data.org_id,
      workingTitle: contractResult.data.working_title,
      status: contractResult.data.status,
      type: contractResult.data.type,
      documentProcessingStatus: contractResult.data.document_processing_status,
      documentProcessingErrorCode: contractResult.data.document_processing_error_code,
      hasOriginal: Boolean(contractResult.data.pdf_url),
      hasOriginalView: Boolean(contractResult.data.original_view_pdf_url),
      hasProcessed: Boolean(contractResult.data.processed_pdf_url),
      ...version,
    },
    aiEvidence: aiResult.data ? {
      jobId: aiResult.data.id,
      extractedRightsHolderName: proposedName,
      sourceQuote,
      provider: aiResult.data.provider,
      model: aiResult.data.model,
      promptVersion: aiResult.data.prompt_version,
      schemaVersion: aiResult.data.schema_version,
      completedAt: aiResult.data.completed_at,
    } : null,
    documentEvidence: document ? {
      documentJobId: document.id,
      status: document.status,
      pageCount: document.page_count,
      ocrApplied: Boolean(document.ocr_applied),
      spatialSchemaVersion: document.spatial_schema_version,
      spatialAccuracy: document.spatial_accuracy_score === null ? null : Number(document.spatial_accuracy_score),
      spatialEvidence: ownerEvidence,
    } : null,
  };
}

export async function recordContractOwnerCandidate(db: SupabaseClient, input: {
  contractId: string;
  orgId: string;
  proposedRightsHolderId: string | null;
  evidenceAiJobId: string;
  evidenceDocumentJobId?: string | null;
  matchVersion: string | null;
  matchScore?: number | null;
}) {
  // Absence of a candidate is not evidence that an earlier candidate became
  // invalid. The import state can be marked unresolved by the caller, while
  // the verification and its bound evidence remain unchanged.
  if (!input.proposedRightsHolderId) return;
  const { data, error } = await db.rpc("record_contract_owner_candidate", {
    p_contract_id: input.contractId,
    p_org_id: input.orgId,
    p_proposed_rights_holder_id: input.proposedRightsHolderId,
    p_evidence_ai_job_id: input.evidenceAiJobId,
    p_evidence_document_job_id: input.evidenceDocumentJobId ?? null,
    p_match_version: input.matchVersion,
    p_match_score: input.matchScore ?? null,
  });
  if (error) throw new Error(error.message);
  const result = (Array.isArray(data) ? data[0] : data) as {
    contractId?: string;
    status?: string;
    skipped?: boolean;
    unchanged?: boolean;
  } | null;
  if (!result?.contractId) throw new Error("Ejerforslaget blev ikke registreret");
  return {
    contractId: result.contractId,
    status: result.status ?? null,
    skipped: result.skipped === true,
    unchanged: result.unchanged === true,
  };
}
