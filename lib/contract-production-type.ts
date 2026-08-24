import { mapDfiWorkType } from "./dfi-metadata";

export type ContractProductionTypeSource = "work_database" | "dfi" | "ai" | "none";

type LinkedWork = {
  type?: unknown;
  dfi_id?: unknown;
  dfi_metadata?: unknown;
} | null | undefined;

const WORK_TO_CONTRACT_TYPE: Record<string, string> = {
  spillefilm: "feature",
  "tv-film": "feature",
  kortfilm: "short",
  "tv-serie": "tvSeries",
  dokumentarfilm: "documentary",
  "dokumentar-serie": "docSeries",
  dokumentarserie: "docSeries",
  dokudrama: "documentary",
};

export function workTypeToContractProductionType(value: unknown) {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  return WORK_TO_CONTRACT_TYPE[key] ?? null;
}

function dfiTypeFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  const category = record.Category ?? record.category;
  const type = record.Type ?? record.type;
  if (!category && !type) return null;
  return workTypeToContractProductionType(mapDfiWorkType(category, type));
}

export function resolveContractProductionType({ aiValue, work }: { aiValue?: unknown; work?: LinkedWork }) {
  const aiProductionType = typeof aiValue === "string" && aiValue.trim() ? aiValue.trim() : null;
  const databaseProductionType = workTypeToContractProductionType(work?.type);
  const dfiProductionType = databaseProductionType ? null : dfiTypeFromMetadata(work?.dfi_metadata);
  const productionType = databaseProductionType ?? dfiProductionType ?? aiProductionType;
  const source: ContractProductionTypeSource = databaseProductionType
    ? "work_database"
    : dfiProductionType ? "dfi" : aiProductionType ? "ai" : "none";

  return {
    productionType,
    source,
    aiSuggestion: aiProductionType,
    hasConflict: Boolean(aiProductionType && productionType && source !== "ai" && aiProductionType !== productionType),
  };
}
