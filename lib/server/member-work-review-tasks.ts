import "server-only";

import type { createServiceClient } from "@/lib/supabase/service";
import { ensureMemberCollaborationReviews } from "@/lib/server/work-collaboration-reviews";
import { memberWorkReviewGroupKey, type MemberWorkReviewCoEditor, type MemberWorkReviewTask } from "@/lib/member-work-review";

type ServiceClient = ReturnType<typeof createServiceClient>;

type ScopeRow = {
  id: string;
  series_work_id: string;
  season_number: number;
  episode_numbers: number[] | null;
  covers_whole_season: boolean | null;
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

type AssignmentRow = {
  id: string;
  work_id: string;
  rights_holder_id: string | null;
  role: string | null;
  share_percent?: number | null;
  rettighedshavere: { full_name: string | null } | Array<{ full_name: string | null }> | null;
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
      .select("id,series_work_id,season_number,episode_numbers,covers_whole_season,works:series_work_id(title)")
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
  const reviewWorkIds = reviewRows.map(review => review.work_id);
  const { data: assignments, error: assignmentError } = reviewRows.length
    ? await db.from("work_assignments")
        .select("id,work_id,rights_holder_id,role,share_percent,rettighedshavere(full_name)")
        .eq("org_id", params.orgId)
        .in("work_id", reviewWorkIds)
    : { data: [], error: null };
  if (assignmentError) throw new Error(assignmentError.message);
  const assignmentRows = (assignments ?? []) as unknown as AssignmentRow[];
  const ownAssignmentByWork = new Map(
    assignmentRows
      .filter(row => row.rights_holder_id === params.rightsHolderId)
      .map(row => [row.work_id, row]),
  );
  const otherAssignmentsByWork = new Map<string, MemberWorkReviewCoEditor[]>();
  for (const assignment of assignmentRows) {
    if (!assignment.rights_holder_id || assignment.rights_holder_id === params.rightsHolderId) continue;
    const holder = one(assignment.rettighedshavere);
    const existing = otherAssignmentsByWork.get(assignment.work_id) ?? [];
    existing.push({
      assignmentId: assignment.id,
      rightsHolderId: assignment.rights_holder_id,
      name: holder?.full_name?.trim() || "Ukendt medklipper",
      role: assignment.role,
      sharePercent: typeof assignment.share_percent === "number" ? assignment.share_percent : null,
    });
    otherAssignmentsByWork.set(assignment.work_id, existing);
  }

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
      selectedEpisodeNumbers: scope.episode_numbers ?? [],
      coversWholeSeason: Boolean(scope.covers_whole_season),
    };
  });
  const pendingEpisodeSeasonKeys = new Set(
    episodeTasks.map(task => task.groupKey),
  );

  const coeditorTasks: MemberWorkReviewTask[] = reviewRows.flatMap(review => {
    const work = one(review.works);
    const ownAssignment = ownAssignmentByWork.get(review.work_id);
    if (!work || !ownAssignment) return [];
    const groupKey = memberWorkReviewGroupKey({
      workId: review.work_id,
      parentWorkId: work.parent_work_id,
      seasonNumber: work.season_number,
    });
    // Afsnittene bliver først lagt i den individuelle medklipperkø, når
    // medlemmet har bekræftet sæsonens afsnitsvalg.
    if (pendingEpisodeSeasonKeys.has(groupKey)) return [];
    return [{
      key: `coeditor-review:${review.id}`,
      groupKey,
      kind: "coeditor_review" as const,
      title: work.title?.trim() || "Værk",
      workId: review.work_id,
      assignmentId: ownAssignment.id,
      ownSharePercent: typeof ownAssignment.share_percent === "number" ? ownAssignment.share_percent : null,
      parentWorkId: work.parent_work_id,
      seasonNumber: work.season_number,
      episodeNumber: work.episode_number,
      existingCoEditors: otherAssignmentsByWork.get(review.work_id) ?? [],
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
