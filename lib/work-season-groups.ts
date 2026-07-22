export type SeasonGroupingRow = {
  id: string;
  title: string;
  type: string;
  year: number | null;
  poster_url?: string | null;
  status?: string | null;
  created_at?: string | null;
  parent_work_id?: string | null;
  season_number?: number | null;
  episode_number?: number | null;
  assignment_id?: string | null;
  role?: string | null;
  contract_count?: number;
  pending_count?: number;
  unread_count?: number;
  assigned_user_count?: number;
  parent?: {
    id: string;
    title: string;
    type?: string | null;
    year?: number | null;
    poster_url?: string | null;
  } | null;
};

export type StandaloneWorkGroup<T extends SeasonGroupingRow> = {
  kind: "work";
  key: string;
  work: T;
  workIds: string[];
  assignmentIds: string[];
};

export type SeasonWorkGroup<T extends SeasonGroupingRow> = {
  kind: "season";
  key: string;
  parentWorkId: string;
  seasonNumber: number;
  title: string;
  type: string;
  year: number | null;
  posterUrl: string | null;
  episodeCount: number;
  workIds: string[];
  assignmentIds: string[];
  contractCount: number;
  pendingCount: number;
  unreadCount: number;
  assignedUserCount: number;
  roleSummary: string | null;
  createdAt: string | null;
  episodes: T[];
};

export type WorkSeasonGroup<T extends SeasonGroupingRow> = StandaloneWorkGroup<T> | SeasonWorkGroup<T>;

export function isEpisodeWork(row: SeasonGroupingRow) {
  return Boolean(row.parent_work_id) && row.season_number != null && row.episode_number != null;
}

export function seasonGroupKey(parentWorkId: string, seasonNumber: number) {
  return `season:${parentWorkId}:${seasonNumber}`;
}

export function deriveSeriesTitle(title: string) {
  return title
    .replace(/\s*[-–—]?\s*S\d{1,2}E\d{1,3}.*$/i, "")
    .replace(/\s+\d+\s*:\s*\d+.*$/i, "")
    .replace(/\s*[-–—:]\s*$/, "")
    .trim() || title;
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function groupWorksBySeason<T extends SeasonGroupingRow>(rows: T[]): WorkSeasonGroup<T>[] {
  const groups = new Map<string, SeasonWorkGroup<T>>();
  const standalone: StandaloneWorkGroup<T>[] = [];

  for (const row of rows) {
    if (!isEpisodeWork(row)) {
      standalone.push({
        kind: "work",
        key: `work:${row.id}`,
        work: row,
        workIds: [row.id],
        assignmentIds: unique([row.assignment_id]),
      });
      continue;
    }

    const parentWorkId = row.parent_work_id as string;
    const seasonNumber = row.season_number as number;
    const key = seasonGroupKey(parentWorkId, seasonNumber);
    const existing = groups.get(key);
    if (existing) {
      existing.episodes.push(row);
      existing.workIds = unique([...existing.workIds, row.id]);
      existing.assignmentIds = unique([...existing.assignmentIds, row.assignment_id]);
      existing.contractCount += row.contract_count ?? 0;
      existing.pendingCount += row.pending_count ?? 0;
      existing.unreadCount += row.unread_count ?? 0;
      existing.assignedUserCount += row.assigned_user_count ?? 0;
      if ((row.created_at ?? "") > (existing.createdAt ?? "")) existing.createdAt = row.created_at ?? existing.createdAt;
      continue;
    }

    groups.set(key, {
      kind: "season",
      key,
      parentWorkId,
      seasonNumber,
      title: row.parent?.title || deriveSeriesTitle(row.title),
      type: row.parent?.type || row.type,
      year: row.parent?.year ?? row.year,
      posterUrl: row.parent?.poster_url ?? row.poster_url ?? null,
      episodeCount: 0,
      workIds: [row.id],
      assignmentIds: unique([row.assignment_id]),
      contractCount: row.contract_count ?? 0,
      pendingCount: row.pending_count ?? 0,
      unreadCount: row.unread_count ?? 0,
      assignedUserCount: row.assigned_user_count ?? 0,
      roleSummary: null,
      createdAt: row.created_at ?? null,
      episodes: [row],
    });
  }

  for (const group of groups.values()) {
    group.episodes.sort((a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0));
    group.episodeCount = group.episodes.length;
    const roles = unique(group.episodes.map(episode => episode.role));
    group.roleSummary = roles.length === 0 ? null : roles.length === 1 ? roles[0] : "Flere roller";
  }

  return [...standalone, ...groups.values()];
}

export function stripSeasonEpisodes<T extends SeasonGroupingRow>(group: WorkSeasonGroup<T>) {
  if (group.kind === "work") return group;
  const { episodes: _episodes, ...summary } = group;
  return summary;
}
