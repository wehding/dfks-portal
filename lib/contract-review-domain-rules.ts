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

type De4AgreementReferenceInput = Pick<RoyaltyRequirementInput, "agreementCovered" | "agreementName"> & {
  contractText?: string;
};

type ContractReviewFeedbackPoint = {
  type?: unknown;
  titel?: unknown;
  beskrivelse?: unknown;
  [key: string]: unknown;
};

function hasDe4FictionAgreementReference(input: De4AgreementReferenceInput) {
  return input.agreementName === "de4-fiktion"
    || (input.agreementCovered && input.agreementName == null)
    || /\bde\s*4\b[\s\S]{0,80}\boverenskomst|\boverenskomst[\s\S]{0,80}\bde\s*4\b/i.test(input.contractText ?? "");
}

export function removeInvalidDe4RoyaltyWarnings<T extends ContractReviewFeedbackPoint>(
  feedbackPoints: T[],
  agreement: De4AgreementReferenceInput,
) {
  if (!hasDe4FictionAgreementReference(agreement)) return feedbackPoints;
  return feedbackPoints.filter(point => {
    const text = `${String(point.titel ?? "")} ${String(point.beskrivelse ?? "")}`;
    const isRoyaltyPoint = /royalt/i.test(text);
    const isNegative = point.type === "advarsel" || point.type === "kritisk";
    return !(isRoyaltyPoint && isNegative);
  });
}

export function royaltyRequirementForContract({
  productionType,
  agreementCovered,
  agreementName,
  distributionChannels,
}: RoyaltyRequirementInput) {
  const hasDe4Reference = hasDe4FictionAgreementReference({ agreementCovered, agreementName });
  const hasCinemaDistribution = distributionChannels.some(channel => channel.toLowerCase() === "biograf");

  if (hasDe4Reference) {
    return hasCinemaDistribution
      ? "✓ DE4-ROYALTY DÆKKET: Kontrakten henviser til De4-fiktionsoverenskomsten, og produktionen har biografdistribution. Royalty følger derfor overenskomsten for de produktioner, bestemmelsen omfatter. Nævn det som et positivt punkt — flag ALDRIG en manglende særskilt royaltyklausul."
      : "✓ DE4-ROYALTY: Kontrakten henviser til De4-fiktionsoverenskomsten. Royalty er dermed dækket for de produktioner, overenskomstens royaltybestemmelse omfatter. Ved ren TV/streamingdistribution skal royalty ikke kræves; flag ALDRIG en manglende særskilt royaltyklausul.";
  }

  return productionType === "spillefilm"
    ? "⚠ ROYALTY PÅKRÆVET: Dette er en spillefilm. Tjek eksplicit om kontrakten nævner royalty. Hvis ikke — det SKAL kommenteres som et selvstændigt punkt."
    : "";
}
