import {
  CONTRACT_OWNER_BLOCK_REASON_CODES,
  CONTRACT_OWNER_CONFIRM_REASON_CODES,
  type ContractOwnerSummary,
} from "@/lib/contract-owner-verification-types";

export const CONTRACT_OWNER_MANAGER_ROLES = ["superadmin", "admin", "org-admin"] as const;

export function canManageContractOwnership(role: string | null | undefined) {
  return CONTRACT_OWNER_MANAGER_ROLES.includes(role as (typeof CONTRACT_OWNER_MANAGER_ROLES)[number]);
}

export const CONTRACT_OWNER_STATUS_LABELS: Record<string, string> = {
  pending: "Afventer kontrol",
  confirmed: "Bekræftet",
  conflict: "Modstridende oplysninger",
  correction_proposed: "Rettelse foreslået",
  corrected: "Ejer rettet",
  blocked: "Blokeret",
  not_applicable: "Ikke relevant",
};

export const CONTRACT_OWNER_ORIGIN_LABELS: Record<string, string> = {
  authenticated_member_upload: "Uploadet af medlemmet",
  authenticated_member_drive: "Hentet fra medlemmets Google Drive",
  admin_selected_at_intake: "Valgt ved adminupload",
  admin_manual: "Valgt af administrator",
  gmail_import: "Importeret fra Gmail",
  ai_suggestion: "Foreslået af AI",
  historical_assignment: "Historisk tilknytning",
  profile_merge: "Flyttet ved profilsammenlægning",
  unknown: "Ukendt oprindelse",
};

export function contractOwnerStatusLabel(status: string) {
  return CONTRACT_OWNER_STATUS_LABELS[status] ?? status;
}

export function contractOwnerOriginLabel(origin: string) {
  return CONTRACT_OWNER_ORIGIN_LABELS[origin] ?? origin;
}

export const CONTRACT_OWNER_BLOCK_REASONS = CONTRACT_OWNER_BLOCK_REASON_CODES;

export type ContractOwnerBlockReason = typeof CONTRACT_OWNER_BLOCK_REASONS[number];

export function normalizeContractOwnerBlockReason(value: string | null | undefined): ContractOwnerBlockReason {
  return (CONTRACT_OWNER_BLOCK_REASONS as readonly string[]).includes(value ?? "")
    ? value as ContractOwnerBlockReason
    : "manual_review_required";
}

function normalizedOwnerName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("da");
}

export function contractOwnerOptionLabel(
  owner: ContractOwnerSummary,
  owners: ContractOwnerSummary[],
) {
  if (owner.secondaryLabel?.trim()) return `${owner.name} · ${owner.secondaryLabel.trim()}`;
  const normalizedName = normalizedOwnerName(owner.name);
  const hasNamesake = owners.some(candidate => (
    candidate.id !== owner.id && normalizedOwnerName(candidate.name) === normalizedName
  ));
  return hasNamesake ? `${owner.name} · profil ${owner.id.slice(-8)}` : owner.name;
}

export function canSafelyBulkConfirm(item: {
  verificationStatus: string;
  reasonCode: string | null;
  aiEvidenceAvailable: boolean;
  spatialEvidenceAvailable: boolean;
  assignedRightsHolder: { id: string } | null;
  proposedRightsHolder: { id: string } | null;
}) {
  if (!item.assignedRightsHolder || item.verificationStatus !== "pending") return false;
  if (item.reasonCode !== "ai_matches_assigned" || !item.aiEvidenceAvailable || !item.spatialEvidenceAvailable) return false;
  return !item.proposedRightsHolder || item.proposedRightsHolder.id === item.assignedRightsHolder.id;
}

export function canRequestOwnerSuggestion(item: { verificationStatus: string; reasonCode: string | null }) {
  if (["corrected", "blocked", "not_applicable"].includes(item.verificationStatus)) return false;
  if (item.verificationStatus !== "confirmed") return true;
  return !(CONTRACT_OWNER_CONFIRM_REASON_CODES as readonly string[]).includes(item.reasonCode ?? "");
}
