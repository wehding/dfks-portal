export const WORK_DOCUMENTATION_STATUSES = [
  "contract_documented",
  "legacy_declaration_required",
  "legacy_declared",
  "contract_required",
  "date_required",
] as const;

export type WorkDocumentationStatus = (typeof WORK_DOCUMENTATION_STATUSES)[number];

export type LegacyDeclarationTask = {
  rootWorkId: string;
  title: string;
  role: string;
  premiereYear: number | null;
  productionYear: number | null;
  qualifyingScopeCount: number;
  qualifyingScopeIds: string[];
};

export function qualifiesForLegacyDeclaration(params: {
  enabled: boolean;
  cutoffYear: number | null;
  premiereYear: number | null;
  productionYear: number | null;
}) {
  if (!params.enabled || params.cutoffYear == null) return false;
  return (params.premiereYear != null && params.premiereYear < params.cutoffYear)
    || (params.productionYear != null && params.productionYear < params.cutoffYear);
}

export function resolveWorkDocumentationStatus(params: {
  hasContract: boolean;
  hasActiveDeclaration: boolean;
  enabled: boolean;
  cutoffYear: number | null;
  premiereYear: number | null;
  productionYear: number | null;
}): WorkDocumentationStatus {
  if (params.hasContract) return "contract_documented";
  if (qualifiesForLegacyDeclaration(params)) {
    return params.hasActiveDeclaration ? "legacy_declared" : "legacy_declaration_required";
  }
  if (params.premiereYear == null && params.productionYear == null) return "date_required";
  return "contract_required";
}
