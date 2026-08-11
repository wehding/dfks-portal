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
