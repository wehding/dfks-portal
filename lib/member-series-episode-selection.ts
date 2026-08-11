export function normalizeEpisodeNumbers(values: number[] | null | undefined) {
  return [...new Set((values ?? []).map(Number).filter(value => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
}

export function classifyEpisodeSelection(values: number[] | null | undefined, coversWholeSeason = false) {
  const episodeNumbers = normalizeEpisodeNumbers(values);
  return {
    status: coversWholeSeason || episodeNumbers.length > 0 ? "confirmed" as const : "pending" as const,
    episodeNumbers,
    coversWholeSeason: Boolean(coversWholeSeason),
  };
}

export function calculateEpisodeRemovalImpact(params: {
  currentEpisodes: number[] | null | undefined;
  nextEpisodes: number[] | null | undefined;
  coversWholeSeason?: boolean;
  currentStatus?: "pending" | "confirmed" | null;
  contractStatuses?: Array<string | null | undefined>;
}) {
  const currentEpisodes = normalizeEpisodeNumbers(params.currentEpisodes);
  const nextEpisodes = normalizeEpisodeNumbers(params.nextEpisodes);
  const nextSet = new Set(nextEpisodes);
  const removedEpisodes = params.coversWholeSeason
    ? []
    : currentEpisodes.filter(episode => !nextSet.has(episode));
  const selectionWillBePending = !params.coversWholeSeason && nextEpisodes.length === 0;
  return {
    removedEpisodes,
    requiresConfirmation: removedEpisodes.length > 0 || (params.currentStatus === "confirmed" && selectionWillBePending),
    selectionWillBePending,
    contractsLosingValidation: selectionWillBePending
      ? (params.contractStatuses ?? []).filter(status => status === "valideret").length
      : 0,
  };
}
