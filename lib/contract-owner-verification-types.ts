export const CONTRACT_OWNER_VERIFICATION_STATUSES = [
  "pending",
  "confirmed",
  "conflict",
  "correction_proposed",
  "corrected",
  "blocked",
  "not_applicable",
] as const;

export type ContractOwnerVerificationStatus = typeof CONTRACT_OWNER_VERIFICATION_STATUSES[number];

export const CONTRACT_OWNER_ASSIGNMENT_ORIGINS = [
  "authenticated_member_upload",
  "authenticated_member_drive",
  "admin_selected_at_intake",
  "admin_manual",
  "gmail_import",
  "ai_suggestion",
  "historical_assignment",
  "profile_merge",
  "unknown",
] as const;

export type ContractOwnerAssignmentOrigin = typeof CONTRACT_OWNER_ASSIGNMENT_ORIGINS[number];
export type ContractOwnerDecision = "confirm" | "reassign" | "blocked";

export const CONTRACT_OWNER_CONFIRM_REASON_CODES = [
  "admin_verified_existing_owner",
  "bulk_confirmed_existing_owner",
  "manual_identity_check",
] as const;

export const CONTRACT_OWNER_REASSIGN_REASON_CODES = [
  "admin_verified_correction",
  "wrong_owner",
] as const;

export const CONTRACT_OWNER_BLOCK_REASON_CODES = [
  "manual_review_required",
  "missing_evidence",
  "evidence_conflict",
  "inactive_profile",
  "wrong_organization",
] as const;

export function isContractOwnerDecisionReason(
  decision: ContractOwnerDecision,
  reasonCode: string | null,
) {
  if (!reasonCode) return false;
  if (decision === "confirm") {
    return (CONTRACT_OWNER_CONFIRM_REASON_CODES as readonly string[]).includes(reasonCode);
  }
  if (decision === "reassign") {
    return (CONTRACT_OWNER_REASSIGN_REASON_CODES as readonly string[]).includes(reasonCode);
  }
  return (CONTRACT_OWNER_BLOCK_REASON_CODES as readonly string[]).includes(reasonCode);
}

export type ContractOwnerSummary = { id: string; name: string; secondaryLabel?: string | null };

export type ContractOwnerVerificationListItem = {
  contractId: string;
  orgId: string;
  workingTitle: string | null;
  contractStatus: string;
  assignedRightsHolder: ContractOwnerSummary | null;
  proposedRightsHolder: ContractOwnerSummary | null;
  verificationStatus: ContractOwnerVerificationStatus;
  assignmentOrigin: ContractOwnerAssignmentOrigin;
  reasonCode: string | null;
  revision: number;
  updatedAt: string;
  documentProcessingStatus: string | null;
  documentProcessingErrorCode: string | null;
  aiEvidenceAvailable: boolean;
  spatialEvidenceAvailable: boolean;
  versionGroupId: string;
  versionIndex: number;
  versionCount: number;
  isCurrentVersion: boolean;
};

export type ContractOwnerVerificationPageInput = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: ContractOwnerVerificationStatus | "all";
  assignmentOrigin?: ContractOwnerAssignmentOrigin | "all";
};

export type ContractOwnerVerificationEvidence = {
  documentJobId: string;
  page: number;
  bbox: { x: number; y: number; width: number; height: number; space: "normalized_top_left" | "pdf_bottom_left" };
  confidence: number;
  coordinateSource: "spatial_v3" | "native_pdf" | "legacy_layout";
};

export type ContractOwnerVerificationDetail = {
  verification: {
    contractId: string;
    orgId: string;
    status: ContractOwnerVerificationStatus;
    assignmentOrigin: ContractOwnerAssignmentOrigin;
    reasonCode: string | null;
    evidenceSubjectRightsHolderId: string | null;
    revision: number;
    reviewedAt: string | null;
  };
  assignedRightsHolder: ContractOwnerSummary | null;
  proposedRightsHolder: ContractOwnerSummary | null;
  contract: {
    id: string;
    orgId: string;
    workingTitle: string | null;
    status: string;
    type: string | null;
    documentProcessingStatus: string | null;
    documentProcessingErrorCode: string | null;
    hasOriginal: boolean;
    hasOriginalView: boolean;
    hasProcessed: boolean;
    versionGroupId: string;
    versionIndex: number;
    versionCount: number;
    isCurrentVersion: boolean;
  };
  aiEvidence: null | {
    jobId: string;
    extractedRightsHolderName: string | null;
    sourceQuote: string | null;
    provider: string | null;
    model: string | null;
    promptVersion: string | null;
    schemaVersion: string | null;
    completedAt: string | null;
  };
  documentEvidence: null | {
    documentJobId: string;
    status: string;
    pageCount: number | null;
    ocrApplied: boolean;
    spatialSchemaVersion: string | null;
    spatialAccuracy: number | null;
    spatialEvidence: ContractOwnerVerificationEvidence | null;
  };
};
