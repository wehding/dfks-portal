export type ContractOwnerBackfillDisposition =
  | "same_owner"
  | "fill_missing_owner"
  | "replace_owner"
  | "unresolved";

export type ContractOwnerBackfillStatus =
  | "previewing"
  | "preview_ready"
  | "approved"
  | "applying"
  | "completed"
  | "completed_with_exceptions"
  | "cancelled";

export type ContractOwnerBackfillItemStatus =
  | "previewed"
  | "pending"
  | "applying"
  | "applied"
  | "stale"
  | "failed"
  | "excluded"
  | "unresolved";

export type ContractOwnerBackfillCounts = {
  total: number;
  eligible: number;
  selected: number;
  sameOwner: number;
  fillMissingOwner: number;
  replaceOwner: number;
  unresolved: number;
  validatedContractsReopened: number;
  episodeConfirmationsAtRisk: number;
  applied: number;
  stale: number;
  failed: number;
  excluded: number;
};

export type ContractOwnerBackfillItem = {
  id: string;
  contractId: string;
  workingTitle: string | null;
  currentOwner: { id: string; name: string } | null;
  proposedOwner: { id: string; name: string } | null;
  score: number | null;
  signals: string[];
  disposition: ContractOwnerBackfillDisposition;
  selected: boolean;
  status: ContractOwnerBackfillItemStatus;
  errorCode: string | null;
};

export type ContractOwnerBackfillRun = {
  id: string;
  orgId: string;
  status: ContractOwnerBackfillStatus;
  matchVersion: string;
  manifestSha256: string | null;
  revision: number;
  createdAt: string;
  previewedAt: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  counts: ContractOwnerBackfillCounts;
  items: ContractOwnerBackfillItem[];
};
