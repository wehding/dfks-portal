type EpisodeWorkTitleInput = {
  rawTitle: string;
  episodeTitle?: string;
  season?: number;
  episode?: number;
};

function stripEpisodeMarker(title: string) {
  return title
    .replace(/\s*[Ss]\d+\s*[Ee]\d+/g, "")
    .replace(/\s*[Ss]æson\s*\d+/gi, "")
    .replace(/\s*[Aa]fsnit\s*\d+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatEpisodeCode(season?: number, episode?: number) {
  if (season == null && episode == null) return "";
  const seasonPart = season != null ? `S${String(season).padStart(2, "0")}` : "";
  const episodePart = episode != null ? `E${String(episode).padStart(2, "0")}` : "";
  return [seasonPart, episodePart].filter(Boolean).join("-");
}

export function formatAftalelicensWorkTitle(work: EpisodeWorkTitleInput) {
  const seriesTitle = stripEpisodeMarker(work.rawTitle) || work.rawTitle;
  const episodeCode = formatEpisodeCode(work.season, work.episode);
  if (work.episodeTitle?.trim()) {
    return `${seriesTitle} - ${work.episodeTitle.trim()}${episodeCode ? `: ${episodeCode}` : ""}`;
  }
  if (episodeCode) return `${seriesTitle}: ${episodeCode}`;
  return work.rawTitle;
}
