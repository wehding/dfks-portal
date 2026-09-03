export type ContractReviewProductionType =
  | "spillefilm"
  | "tvserie"
  | "dokumentar"
  | "kortfilm"
  | "ukendt"
  | "udvikling_dokumentar"
  | "udvikling_fiktion"
  | "udvikling_underholdning";

const PRODUCTION_TYPES = new Set<ContractReviewProductionType>([
  "spillefilm",
  "tvserie",
  "dokumentar",
  "kortfilm",
  "ukendt",
  "udvikling_dokumentar",
  "udvikling_fiktion",
  "udvikling_underholdning",
]);

export function hasExplicitSeriesEpisodeScope(contractText: string) {
  return [
    /\b\d+\s+episoder?\b/i,
    /\bepisoder?\s*(?:nr\.?\s*)?\d+\b/i,
    /\b(?:på|for)\s+afsnit(?:tene)?\s*(?:nr\.?\s*)?\d+\b/i,
  ].some(pattern => pattern.test(contractText));
}

export function resolveContractReviewProductionType(
  aiValue: unknown,
  contractText: string,
): ContractReviewProductionType {
  if (hasExplicitSeriesEpisodeScope(contractText)) return "tvserie";
  return typeof aiValue === "string" && PRODUCTION_TYPES.has(aiValue as ContractReviewProductionType)
    ? aiValue as ContractReviewProductionType
    : "ukendt";
}

export function royaltyRequirementForProductionType(productionType: ContractReviewProductionType) {
  return productionType === "spillefilm"
    ? "⚠ ROYALTY PÅKRÆVET: Dette er en spillefilm. Tjek eksplicit om kontrakten nævner royalty. Hvis ikke — det SKAL kommenteres som et selvstændigt punkt."
    : "";
}
