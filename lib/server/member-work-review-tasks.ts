import "server-only";

import type { createServiceClient } from "@/lib/supabase/service";
import { ensureMemberCollaborationReviews } from "@/lib/server/work-collaboration-reviews";
import { memberWorkReviewGroupKey, type MemberWorkReviewTask } from "@/lib/member-work-review";

type ServiceClient = ReturnType<typeof createServiceClient>;

type ScopeRow = {
  id: string;
  series_work_id: string;
  season_number: number;
  works: { title: string | null } | Array<{ title: string | null }> | null;
};

type ReviewRow = {
  id: string;
  work_id: string;
  works: {
    title: string | null;
    parent_work_id: string | null;
    season_number: number | null;
    episode_number: number | null;
  } | Array<{
    title: string | null;
    parent_work_id: string | null;
    season_number: number | null;
    episode_number: number | null;
  }> | null;
};

function one<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function loadMemberWorkReviewTasks(db: ServiceClient, params: {
  orgId: string;
  rightsHolderId: string;
}): Promise<MemberWorkReviewTask[]> {
  await ensureMemberCollaborationReviews(db, params);
  const [{ data: scopes, error: scopeError }, { data: reviews, error: reviewError }] = await Promise.all([
    db.from("member_series_episode_scopes")
      .select("id,series_work_id,season_number,works:series_work_id(title)")
      .eq("org_id", params.orgId)
      .eq("rights_holder_id", params.rightsHolderId)
      .eq("status", "pending"),
    db.from("member_work_collaboration_reviews")
      .select("id,work_id,works(id,title,parent_work_id,season_number,episode_number)")
      .eq("org_id", params.orgId)
      .eq("rights_holder_id", params.rightsHolderId)
      .eq("status", "pending"),
  ]);
  if (scopeError) throw new Error(scopeError.message);
  if (reviewError) throw new Error(reviewError.message);

  const reviewRows = (reviews ?? []) as unknown as ReviewRow[];
  const { data: assignments, error: assignmentError } = reviewRows.length
    ? await db.from("work_assignments")
        .select("id,work_id")
        .eq("org_id", params.orgId)
        .eq("rights_holder_id", params.rightsHolderId)
    : { data: [], error: null };
  if (assignmentError) throw new Error(assignmentError.message);
  const assignmentByWork = new Map((assignments ?? []).map(row => [row.work_id, row.id]));

  const episodeTasks: MemberWorkReviewTask[] = ((scopes ?? []) as unknown as ScopeRow[]).map(scope => {
    const work = one(scope.works);
    return {
      key: `episode-scope:${scope.id}`,
      groupKey: `season:${scope.series_work_id}:${scope.season_number}`,
      kind: "episode_selection",
      title: work?.title?.trim() || "Serie",
      seriesWorkId: scope.series_work_id,
      seasonNumber: scope.season_number,
      episodeScopeId: scope.id,
    };
  });

  const coeditorTasks: MemberWorkReviewTask[] = reviewRows.flatMap(review => {
    const work = one(review.works);
    const assignmentId = assignmentByWork.get(review.work_id);
    if (!work || !assignmentId) return [];
    return [{
      key: `coeditor-review:${review.id}`,
      groupKey: memberWorkReviewGroupKey({
        workId: review.work_id,
        parentWorkId: work.parent_work_id,
        seasonNumber: work.season_number,
      }),
      kind: "coeditor_review" as const,
      title: work.title?.trim() || "Værk",
      workId: review.work_id,
      assignmentId,
      parentWorkId: work.parent_work_id,
      seasonNumber: work.season_number,
      episodeNumber: work.episode_number,
    }];
  });

  return [...episodeTasks, ...coeditorTasks].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "episode_selection" ? -1 : 1;
    return left.title.localeCompare(right.title, "da", { numeric: true })
      || (left.seasonNumber ?? 0) - (right.seasonNumber ?? 0)
      || (left.kind === "coeditor_review" ? left.episodeNumber ?? 0 : 0)
        - (right.kind === "coeditor_review" ? right.episodeNumber ?? 0 : 0);
  });
}
