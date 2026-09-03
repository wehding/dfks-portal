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

export type WorkArchiveDocumentationState = {
  kind: "contracts" | "declared" | "missing_declaration" | "missing_contract";
  label: string;
  contractCount: number;
};

export function resolveWorkArchiveDocumentationState(params: {
  contractCount: number;
  isMissing: boolean;
  year: number | null;
  productionYear?: number | null;
  hasDeclaration: boolean;
}): WorkArchiveDocumentationState {
  if (!params.isMissing) {
    return {
      kind: "contracts",
      label: params.contractCount === 1 ? "1 kontrakt" : `${params.contractCount} kontrakter`,
      contractCount: params.contractCount,
    };
  }
  const effectiveYear = params.productionYear ?? params.year;
  const isPre2016 = typeof effectiveYear === "number" && effectiveYear < 2016;
  if (isPre2016) {
    if (params.hasDeclaration) {
      return { kind: "declared", label: "Erklæring afgivet", contractCount: 0 };
    }
    return { kind: "missing_declaration", label: "Mangler erklæring", contractCount: 0 };
  }
  return { kind: "missing_contract", label: "Mangler kontrakt", contractCount: 0 };
}
