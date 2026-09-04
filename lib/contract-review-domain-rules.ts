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

type ContractReviewResult = {
  overblik?: { periode?: unknown; [key: string]: unknown };
  oversigt?: { periode?: unknown; [key: string]: unknown };
  feedbackpunkter?: ContractReviewFeedbackPoint[];
  [key: string]: unknown;
};

const DANISH_MONTH = "januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december";

function productionDateYearCounts(contractText: string) {
  const counts = new Map<number, number>();
  const datePattern = new RegExp(
    `(?:\\b(?:[0-3]?\\d)[. ]+(?:${DANISH_MONTH})\\s+|\\b(?:[0-3]?\\d)[./-](?:[01]?\\d)[./-])((?:19|20)\\d{2})\\b`,
    "gi",
  );
  for (const match of contractText.matchAll(datePattern)) {
    const year = Number(match[1]);
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  return counts;
}

export function detectDominantContractPeriodYear(contractText: string) {
  const ranked = [...productionDateYearCounts(contractText)].sort((a, b) => b[1] - a[1]);
  const [dominant, runnerUp] = ranked;
  if (!dominant || dominant[1] < 3 || dominant[1] < (runnerUp?.[1] ?? 0) * 2) return null;
  return {
    year: dominant[0],
    conflictingYears: ranked
      .filter(([year]) => year < dominant[0] && dominant[0] - year <= 2)
      .map(([year]) => year),
  };
}

export function reconcileContractReviewDates<T extends ContractReviewResult>(result: T, contractText: string): T {
  const detected = detectDominantContractPeriodYear(contractText);
  if (!detected?.conflictingYears.length) return result;

  const overview = result.overblik ?? result.oversigt;
  if (overview && typeof overview.periode === "string") {
    const conflicts = new Set(detected.conflictingYears);
    overview.periode = overview.periode.replace(/\b(?:19|20)\d{2}\b/g, value => (
      conflicts.has(Number(value)) ? String(detected.year) : value
    ));
  }

  const feedbackPoints = Array.isArray(result.feedbackpunkter) ? result.feedbackpunkter : [];
  result.feedbackpunkter = feedbackPoints.filter(point => {
    const text = `${String(point.titel ?? "")} ${String(point.beskrivelse ?? "")}`;
    if (!/over\s+(?:to|2)\s+år|langt\s+fremskudt/i.test(text)) return true;
    const mentionedYears = [...text.matchAll(/\b((?:19|20)\d{2})\b/g)].map(match => Number(match[1]));
    return !mentionedYears.some(year => year >= detected.year && year - detected.year < 2);
  });

  const alreadyFlagged = result.feedbackpunkter.some(point => /modstridende årstal|datokonflikt/i.test(String(point.titel ?? "")));
  if (!alreadyFlagged) {
    result.feedbackpunkter.push({
      id: `fp${result.feedbackpunkter.length + 1}`,
      type: "advarsel",
      titel: "Modstridende årstal i produktionsperioden",
      beskrivelse: `Den detaljerede datoplan peger på ${detected.year}, men kontrakten indeholder også ${detected.conflictingYears.join("/")}. Årstallet bør rettes eller bekræftes.`,
      anbefaling: `Bekræft produktionsperioden og ret de modstridende årstal til ${detected.year}, hvis den detaljerede plan er korrekt.`,
      citat: "",
      paragraf: "kontraktens produktionsperiode",
    });
  }
  return result;
}

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
