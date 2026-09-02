import type { AdminContractFilterParams } from "@/lib/server/admin-contract-filtering";

export const ADMIN_CONTRACT_QUEUE_KINDS = ["filtered", "selected", "validation", "ownership"] as const;
export type AdminContractQueueKind = typeof ADMIN_CONTRACT_QUEUE_KINDS[number];

export type CreateAdminContractQueueInput = {
  kind: AdminContractQueueKind;
  filters?: AdminContractFilterParams;
  selectedContractIds?: string[];
};

export type AdminContractQueueItem = {
  contractId: string;
  position: number;
  status: "pending" | "completed" | "skipped";
  title: string;
  contractStatus: string;
  rightsHolderId: string | null;
  ownershipStatus: string | null;
  proposedRightsHolderId: string | null;
  proposedRightsHolderName: string | null;
};

export type AdminContractQueueContext = {
  id: string;
  kind: AdminContractQueueKind;
  label: string;
  position: number;
  total: number;
  previousContractId: string | null;
  nextContractId: string | null;
  items: AdminContractQueueItem[];
  expiresAt: string;
};

