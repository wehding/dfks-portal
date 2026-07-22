export type ContractWorkScope = {
  work_id: string | null;
  season_number?: number | null;
  episode_numbers?: number[] | null;
};

export type EpisodeWorkScope = {
  id: string;
  parent_work_id?: string | null;
  season_number?: number | null;
  episode_number?: number | null;
};

/**
 * A contract covers an episode when it is linked directly to the episode, or
 * when it is linked to the series and its season scope includes the episode.
 * An empty episode list deliberately means that the entire season is covered.
 */
export function contractCoversEpisode(contract: ContractWorkScope, episode: EpisodeWorkScope) {
  if (contract.work_id === episode.id) return true;
  if (!episode.parent_work_id || contract.work_id !== episode.parent_work_id) return false;
  if (contract.season_number !== episode.season_number) return false;
  return !contract.episode_numbers?.length
    || (episode.episode_number != null && contract.episode_numbers.includes(episode.episode_number));
}
