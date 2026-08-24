export type MemberWorkReviewCoEditor = {
  assignmentId: string;
  rightsHolderId: string | null;
  name: string;
  role: string | null;
  sharePercent: number | null;
};

export type MemberWorkReviewTask =
  | {
      key: string;
      groupKey: string;
      kind: "episode_selection";
      title: string;
      seriesWorkId: string;
      seasonNumber: number;
      episodeScopeId: string;
      selectedEpisodeNumbers?: number[];
      coversWholeSeason?: boolean;
    }
  | {
      key: string;
      groupKey: string;
      kind: "coeditor_review";
      title: string;
      workId: string;
      assignmentId: string;
      ownSharePercent?: number | null;
      parentWorkId: string | null;
      seasonNumber: number | null;
      episodeNumber: number | null;
      existingCoEditors: MemberWorkReviewCoEditor[];
    };

export function memberWorkReviewGroupKey(params: {
  workId: string;
  parentWorkId?: string | null;
  seasonNumber?: number | null;
}) {
  if (params.parentWorkId && params.seasonNumber != null) {
    return `season:${params.parentWorkId}:${params.seasonNumber}`;
  }
  return `work:${params.workId}`;
}

export function uniqueMemberWorkReviewCount(tasks: MemberWorkReviewTask[]) {
  return new Set(tasks.map(task => task.groupKey)).size;
}
