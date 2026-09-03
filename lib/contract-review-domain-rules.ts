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

export function hasExplicitFictionSeriesScope(contractText: string) {
  const hasEpisodeScope = /\b(?:episode|episoder|afsnit|afsnittene)\b/i.test(contractText);
  const hasFictionSignal = /\b(?:fiktion(?:sproduktion)?|drama(?:serie)?|tv[- ]?serie)\b/i.test(contractText);
  return hasEpisodeScope && hasFictionSignal;
}

export function resolveContractReviewProductionType(
  aiValue: unknown,
  contractText: string,
): ContractReviewProductionType {
  if (hasExplicitFictionSeriesScope(contractText)) return "tvserie";
  return typeof aiValue === "string" && PRODUCTION_TYPES.has(aiValue as ContractReviewProductionType)
    ? aiValue as ContractReviewProductionType
    : "ukendt";
}

export function royaltyRequirementForProductionType(productionType: ContractReviewProductionType) {
  return productionType === "spillefilm"
    ? "⚠ ROYALTY PÅKRÆVET: Dette er en spillefilm. Tjek eksplicit om kontrakten nævner royalty. Hvis ikke — det SKAL kommenteres som et selvstændigt punkt."
    : "";
}
