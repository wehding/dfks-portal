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

type RoyaltyRequirementInput = {
  productionType: ContractReviewProductionType;
  agreementCovered: boolean;
  agreementName: string | null;
  distributionChannels: string[];
};

export function royaltyRequirementForContract({
  productionType,
  agreementCovered,
  agreementName,
  distributionChannels,
}: RoyaltyRequirementInput) {
  const hasDe4FictionAgreementReference = agreementName === "de4-fiktion"
    || (agreementCovered && agreementName == null);
  const hasCinemaDistribution = distributionChannels.some(channel => channel.toLowerCase() === "biograf");

  if (hasDe4FictionAgreementReference) {
    return hasCinemaDistribution
      ? "✓ DE4-ROYALTY DÆKKET: Kontrakten henviser til De4-fiktionsoverenskomsten, og produktionen har biografdistribution. Royalty følger derfor overenskomsten for de produktioner, bestemmelsen omfatter. Nævn det som et positivt punkt — flag ALDRIG en manglende særskilt royaltyklausul."
      : "✓ DE4-ROYALTY: Kontrakten henviser til De4-fiktionsoverenskomsten. Royalty er dermed dækket for de produktioner, overenskomstens royaltybestemmelse omfatter. Ved ren TV/streamingdistribution skal royalty ikke kræves; flag ALDRIG en manglende særskilt royaltyklausul.";
  }

  return productionType === "spillefilm"
    ? "⚠ ROYALTY PÅKRÆVET: Dette er en spillefilm. Tjek eksplicit om kontrakten nævner royalty. Hvis ikke — det SKAL kommenteres som et selvstændigt punkt."
    : "";
}
