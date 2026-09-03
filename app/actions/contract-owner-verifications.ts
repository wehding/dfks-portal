"use server";

import { revalidatePath } from "next/cache";
import { USER_ADMIN_ROLES, type StaffRole } from "@/lib/admin-roles";
import {
  CONTRACT_OWNER_ASSIGNMENT_ORIGINS,
  CONTRACT_OWNER_VERIFICATION_STATUSES,
  isContractOwnerDecisionReason,
  type ContractOwnerDecision,
  type ContractOwnerSummary,
  type ContractOwnerVerificationDetail,
  type ContractOwnerVerificationEvidence,
  type ContractOwnerVerificationPageInput,
} from "@/lib/contract-owner-verification-types";
import {
  getContractOwnerVerificationDetail,
  listContractOwnerVerifications,
  searchActiveContractOwnerCandidates,
} from "@/lib/server/contract-owner-verifications";
import { getRequestAppAccessContext } from "@/lib/server/request-app-access-context";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/uuid";

type OwnershipContext = {
  userId: string;
  orgId: string;
  role: "superadmin" | "admin" | "org-admin";
};

async function requireOwnershipContext(operation: "read" | "write") {
  const context = await getRequestAppAccessContext();
  const role = context?.role;
  if (
    !context?.canUseAdmin
    || !role
    || !(USER_ADMIN_ROLES as readonly string[]).includes(role)
    || !context.modules?.contract_ownership?.[operation]
  ) return null;
  return { userId: context.userId, orgId: context.orgId, role } as OwnershipContext;
}

export async function fetchContractOwnerVerificationPage(input: ContractOwnerVerificationPageInput = {}) {
  const caller = await requireOwnershipContext("read");
  if (!caller) return { success: false as const, error: "Ikke autoriseret", code: "forbidden" as const };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { success: false as const, error: "Ugyldigt filter", code: "invalid_input" as const };
  }
  if (input.status && input.status !== "all" && !(CONTRACT_OWNER_VERIFICATION_STATUSES as readonly string[]).includes(input.status)) {
    return { success: false as const, error: "Ugyldigt statusfilter", code: "invalid_input" as const };
  }
  if (input.assignmentOrigin && input.assignmentOrigin !== "all" && !(CONTRACT_OWNER_ASSIGNMENT_ORIGINS as readonly string[]).includes(input.assignmentOrigin)) {
    return { success: false as const, error: "Ugyldigt oprindelsesfilter", code: "invalid_input" as const };
  }
  try {
    const data = await listContractOwnerVerifications(createServiceClient(), caller, input);
    const targets = [...new Set(data.items.flatMap(item => [
      item.assignedRightsHolder?.id,
      item.proposedRightsHolder?.id,
    ]).filter((id): id is string => Boolean(id)))];
    await recordSensitiveFlow({
      actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" },
      action: "read",
      component: "admin.contract_ownership.queue",
      entityType: "contract_owner_verification",
      targetMemberUuids: targets,
      orgIds: [caller.orgId],
      purposeCode: "contract_owner_verification",
      legalBasis: "GDPR Art. 6(1)(c)/(f) og Art. 9(2)(d)",
      dataCategories: ["contract_data", "union_membership_data", "ai_analysis"],
      counts: { resultCount: data.items.length, total: data.total },
    });
    return { success: true as const, data };
  } catch {
    return { success: false as const, error: "Ejerskabskøen kunne ikke hentes", code: "read_failed" as const };
  }
}

export async function fetchContractOwnerVerificationDetail(contractId: string) {
  const caller = await requireOwnershipContext("read");
  if (!caller) return { success: false as const, error: "Ikke autoriseret", code: "forbidden" as const };
  if (!isUuid(contractId)) return { success: false as const, error: "Ugyldig kontrakt", code: "invalid_input" as const };
  try {
    const data = await getContractOwnerVerificationDetail(createServiceClient(), caller, contractId);
    if (!data) return { success: false as const, error: "Kontrakten blev ikke fundet", code: "not_found" as const };
    await recordSensitiveFlow({
      actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" },
      action: "read",
      component: "admin.contract_ownership.detail",
      entityType: "contract_owner_verification",
      entityId: contractId,
      targetMemberUuids: [...new Set([
        data.assignedRightsHolder?.id,
        data.proposedRightsHolder?.id,
      ].filter((id): id is string => Boolean(id)))],
      orgIds: [caller.orgId],
      purposeCode: "contract_owner_verification",
      legalBasis: "GDPR Art. 6(1)(c)/(f) og Art. 9(2)(d)",
      dataCategories: ["contract_data", "union_membership_data", "ai_analysis"],
      counts: {
        returnedProfiles: [data.assignedRightsHolder, data.proposedRightsHolder].filter(Boolean).length,
      },
    });
    return { success: true as const, data };
  } catch {
    return { success: false as const, error: "Ejerskabsdetaljerne kunne ikke hentes", code: "read_failed" as const };
  }
}

export async function searchEligibleContractOwners(rawQuery: string) {
  const caller = await requireOwnershipContext("read");
  if (!caller) return { success: false as const, error: "Ikke autoriseret", code: "forbidden" as const };
  if (typeof rawQuery !== "string" || rawQuery.trim().length < 2 || rawQuery.trim().length > 100) {
    return { success: false as const, error: "Skriv mindst 2 tegn", code: "invalid_input" as const };
  }
  try {
    const candidates = await searchActiveContractOwnerCandidates(
      createServiceClient(),
      caller.orgId,
      rawQuery,
      20,
    );
    await recordSensitiveFlow({
      actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" },
      action: "search",
      component: "admin.contract_ownership.owner_search",
      entityType: "rettighedshavere",
      targetMemberUuids: candidates.map(candidate => candidate.id),
      orgIds: [caller.orgId],
      purposeCode: "contract_owner_verification",
      legalBasis: "GDPR Art. 6(1)(c)/(f) og Art. 9(2)(d)",
      dataCategories: ["identity_data", "union_membership_data"],
      counts: { resultCount: candidates.length },
    });
    return { success: true as const, candidates };
  } catch {
    return { success: false as const, error: "Rettighedshavere kunne ikke søges", code: "read_failed" as const };
  }
}

export async function createContractOwnerCandidate(name: string) {
  const caller = await requireOwnershipContext("write");
  if (!caller) return { success: false as const, error: "Ikke autoriseret", code: "forbidden" as const };
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed.length < 2) return { success: false as const, error: "Navnet skal være mindst 2 tegn", code: "invalid_input" as const };

  const db = createServiceClient();
  const { data: rh, error: createError } = await db
    .from("rettighedshavere")
    .insert({ full_name: trimmed })
    .select("id, full_name")
    .single();

  if (createError || !rh) {
    return { success: false as const, error: createError?.message ?? "Kunne ikke oprette rettighedshaver" };
  }

  await db.from("org_affiliations").insert({
    org_id: caller.orgId,
    rights_holder_id: rh.id,
    is_member: false,
  });

  await recordSensitiveFlow({
    actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" },
    action: "create",
    component: "admin.contract_ownership.create_owner_candidate",
    entityType: "rettighedshavere",
    targetMemberUuids: [rh.id],
    orgIds: [caller.orgId],
    purposeCode: "contract_owner_verification",
    legalBasis: "GDPR Art. 6(1)(b)/(f)",
    dataCategories: ["identity_data"],
  });

  const candidate: ContractOwnerSummary = {
    id: rh.id,
    name: rh.full_name,
    secondaryLabel: "Nyoprettet rettighedshaver",
  };
  return { success: true as const, candidate };
}

export type ReviewContractOwnerVerificationInput = {
  contractId: string;
  expectedRightsHolderId: string | null;
  expectedRevision: number;
  decision: ContractOwnerDecision;
  newRightsHolderId?: string | null;
  reasonCode?: string | null;
};

type ReviewExecutionData = {
  contractId: string;
  status: string;
  rightsHolderId: string | null;
  revision: number;
  auditEventId: string;
};

type ReviewExecutionResult =
  | {
      success: true;
      data: ReviewExecutionData;
    }
  | { success: false; error: string; code: "conflict" | "write_failed" };

async function executeOwnerReview(
  db: ReturnType<typeof createServiceClient>,
  caller: OwnershipContext,
  input: ReviewContractOwnerVerificationInput,
  prevalidatedDetail?: ContractOwnerVerificationDetail,
): Promise<ReviewExecutionResult> {
  let trustedSpatialEvidence: ContractOwnerVerificationEvidence | null = null;
  try {
    const detail = prevalidatedDetail ?? await getContractOwnerVerificationDetail(db, caller, input.contractId);
    if (
      !detail
      || detail.verification.revision !== input.expectedRevision
      || (detail.assignedRightsHolder?.id ?? null) !== input.expectedRightsHolderId
    ) {
      return { success: false, error: "Ejerskabet er ændret. Genindlæs og prøv igen.", code: "conflict" };
    }
    const decisionSubjectId = input.decision === "blocked"
      ? null
      : input.decision === "confirm"
        ? input.expectedRightsHolderId
        : input.newRightsHolderId ?? null;
    const spatialEvidence = detail.documentEvidence?.spatialEvidence ?? null;
    // Geometry describes the name extracted from one exact document. It may
    // only support a decision about that same profile; otherwise it remains
    // visible as counter-evidence but is not written as decision evidence.
    if (
      decisionSubjectId
      && detail.verification.evidenceSubjectRightsHolderId === decisionSubjectId
      && spatialEvidence
    ) {
      trustedSpatialEvidence = spatialEvidence;
    }
  } catch {
    return { success: false, error: "Dokumentkilden kunne ikke kontrolleres", code: "write_failed" };
  }

  const result = await db.rpc("review_contract_owner", {
    p_contract_id: input.contractId,
    p_expected_rights_holder_id: input.expectedRightsHolderId,
    p_expected_revision: input.expectedRevision,
    p_decision: input.decision,
    p_new_rights_holder_id: input.newRightsHolderId ?? null,
    p_reason_code: input.reasonCode?.trim() || null,
    p_actor_user_id: caller.userId,
    p_actor_org_id: caller.orgId,
    p_actor_role: caller.role,
    p_evidence_document_job_id: trustedSpatialEvidence?.documentJobId ?? null,
    p_evidence_page: trustedSpatialEvidence?.page ?? null,
    p_evidence_bbox: trustedSpatialEvidence?.bbox ?? null,
    p_evidence_confidence: trustedSpatialEvidence?.confidence ?? null,
  });
  if (result.error) {
    const conflict = result.error.code === "40001" || /revision|changed|conflict|ændret/i.test(result.error.message);
    return {
      success: false,
      error: conflict ? "Ejerskabet er ændret af en anden. Genindlæs og prøv igen." : "Ejerskabet kunne ikke gemmes",
      code: conflict ? "conflict" : "write_failed",
    };
  }
  const data = (Array.isArray(result.data) ? result.data[0] : result.data) as ReviewExecutionData | null;
  if (!data?.contractId) return { success: false, error: "Ejerskabet kunne ikke gemmes", code: "write_failed" };
  return { success: true, data };
}

export async function reviewContractOwnerVerification(input: ReviewContractOwnerVerificationInput) {
  const caller = await requireOwnershipContext("write");
  if (!caller) return { success: false as const, error: "Ikke autoriseret", code: "forbidden" as const };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { success: false as const, error: "Ugyldige oplysninger", code: "invalid_input" as const };
  }
  const reasonCode = input.reasonCode?.trim() || null;
  const valid = isUuid(input.contractId)
    && (input.expectedRightsHolderId === null || isUuid(input.expectedRightsHolderId))
    && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision > 0
    && ["confirm", "reassign", "blocked"].includes(input.decision)
    && (input.newRightsHolderId === null || input.newRightsHolderId === undefined || isUuid(input.newRightsHolderId))
    && (input.decision !== "reassign" || Boolean(input.newRightsHolderId))
    && isContractOwnerDecisionReason(input.decision, reasonCode);
  if (!valid) return { success: false as const, error: "Ugyldige oplysninger", code: "invalid_input" as const };

  const db = createServiceClient({ audit: {
    actorUserId: caller.userId,
    actorOrgId: caller.orgId,
    actorRole: caller.role as StaffRole,
    source: "admin",
    correlationId: crypto.randomUUID(),
    mode: "summary",
  } });
  const result = await executeOwnerReview(db, caller, { ...input, reasonCode });
  if (!result.success) return result;
  // The RPC writes one atomic semantic audit event with both the previous and
  // new member subjects. Do not duplicate that event in this server action.
  revalidatePath("/admin/kontrakter");
  return { success: true as const, data: result.data };
}

export type BulkConfirmContractOwnersInput = Array<{
  contractId: string;
  expectedRightsHolderId: string;
  expectedRevision: number;
}>;

const BULK_OWNER_CONFIRM_LIMIT = 25;

export async function bulkConfirmContractOwners(input: BulkConfirmContractOwnersInput) {
  const caller = await requireOwnershipContext("write");
  if (!caller) return { success: false as const, error: "Ikke autoriseret", code: "forbidden" as const };
  if (!Array.isArray(input) || input.length < 1 || input.length > BULK_OWNER_CONFIRM_LIMIT) {
    return { success: false as const, error: `Vælg mellem 1 og ${BULK_OWNER_CONFIRM_LIMIT} kontrakter`, code: "invalid_input" as const };
  }
  if (input.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
    return { success: false as const, error: "Ugyldige kontrakter", code: "invalid_input" as const };
  }
  const unique = [...new Map(input.map(item => [item.contractId, item])).values()];
  if (unique.length !== input.length || unique.some(item => (
    !isUuid(item.contractId)
    || !isUuid(item.expectedRightsHolderId)
    || !Number.isSafeInteger(item.expectedRevision)
    || item.expectedRevision < 1
  ))) {
    return { success: false as const, error: "Ugyldige kontrakter", code: "invalid_input" as const };
  }

  const db = createServiceClient({ audit: {
    actorUserId: caller.userId,
    actorOrgId: caller.orgId,
    actorRole: caller.role as StaffRole,
    source: "admin",
    correlationId: crypto.randomUUID(),
    mode: "summary",
  } });
  const results: Array<{ contractId: string; success: boolean; error?: string }> = [];

  // Keep storage and database pressure bounded while avoiding one browser
  // roundtrip per contract. Each review remains an independent atomic RPC.
  for (let offset = 0; offset < unique.length; offset += 5) {
    const chunk = unique.slice(offset, offset + 5);
    const settled = await Promise.all(chunk.map(async item => {
      try {
        const detail = await getContractOwnerVerificationDetail(db, caller, item.contractId);
        const spatialEvidence = detail?.documentEvidence?.spatialEvidence ?? null;
        const stillSafe = Boolean(
          detail
          && detail.verification.status === "pending"
          && detail.verification.reasonCode === "ai_matches_assigned"
          && detail.verification.revision === item.expectedRevision
          && detail.assignedRightsHolder?.id === item.expectedRightsHolderId
          && detail.aiEvidence
          && spatialEvidence
          && (!detail.proposedRightsHolder || detail.proposedRightsHolder.id === item.expectedRightsHolderId)
        );
        if (!detail || !spatialEvidence || !stillSafe) {
          return { contractId: item.contractId, success: false, error: "Kræver individuel kontrol" };
        }
        const result = await executeOwnerReview(db, caller, {
          contractId: item.contractId,
          expectedRightsHolderId: item.expectedRightsHolderId,
          expectedRevision: item.expectedRevision,
          decision: "confirm",
          newRightsHolderId: item.expectedRightsHolderId,
          reasonCode: "bulk_confirmed_existing_owner",
        }, detail);
        return result.success
          ? { contractId: item.contractId, success: true }
          : { contractId: item.contractId, success: false, error: result.error };
      } catch {
        return { contractId: item.contractId, success: false, error: "Kontrollen kunne ikke gennemføres" };
      }
    }));
    results.push(...settled);
  }

  revalidatePath("/admin/kontrakter");
  return {
    success: true as const,
    completed: results.filter(item => item.success).length,
    failed: results.filter(item => !item.success).length,
    results,
  };
}
