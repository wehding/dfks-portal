export function needsOnboardingEpisodeSelection(input: {
  selected: boolean;
  isSeries: boolean;
  selectedEpisodes?: readonly number[] | null;
}) {
  return input.selected && input.isSeries && (input.selectedEpisodes?.length ?? 0) === 0;
}

export function firstOnboardingSeriesMissingEpisodes<T>(
  credits: readonly T[],
  isSeries: (credit: T) => boolean,
  selectedEpisodes: (credit: T) => readonly number[] | null | undefined
) {
  return credits.find(credit => needsOnboardingEpisodeSelection({
    selected: true,
    isSeries: isSeries(credit),
    selectedEpisodes: selectedEpisodes(credit),
  })) ?? null;
}
