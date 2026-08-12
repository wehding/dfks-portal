import "server-only";

import type { createServiceClient } from "@/lib/supabase/service";

type ServiceClient = ReturnType<typeof createServiceClient>;

function validEpisodeNumbers(values?: number[] | null) {
  return [...new Set((values ?? []).filter(value => Number.isInteger(value) && value > 0))];
}

export async function ensureMemberCollaborationReviews(db: ServiceClient, params: {
  orgId: string;
  rightsHolderId: string;
}) {
  const { data: assignments, error } = await db.from("work_assignments")
    .select("work_id,works!inner(id,type,parent_work_id,episode_number)")
    .eq("org_id", params.orgId)
    .eq("rights_holder_id", params.rightsHolderId);
  if (error) throw new Error(error.message);
  const workIds = (assignments ?? []).flatMap(assignment => {
    const work = Array.isArray(assignment.works) ? assignment.works[0] : assignment.works;
    const isSeriesParent = !work?.parent_work_id && work?.episode_number == null && String(work?.type ?? "").toLowerCase().includes("serie");
    return work?.id && !isSeriesParent ? [work.id] : [];
  });
  if (!workIds.length) return;
  const { error: upsertError } = await db.from("member_work_collaboration_reviews").upsert(
    workIds.map(workId => ({
      org_id: params.orgId,
      rights_holder_id: params.rightsHolderId,
      work_id: workId,
      status: "pending",
      source: "assignment",
    })),
    { onConflict: "org_id,rights_holder_id,work_id", ignoreDuplicates: true },
  );
  if (upsertError) throw new Error(upsertError.message);
}

export async function resolveCollaborationReviewWorkIds(db: ServiceClient, params: {
  workId: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  episodeNumbers?: number[] | null;
}) {
  const { data: work } = await db.from("works").select("id,parent_work_id,season_number,episode_number,type").eq("id", params.workId).maybeSingle();
  if (!work) return [];
  if (work.parent_work_id || work.episode_number != null) return [work.id];
  if (!String(work.type ?? "").toLowerCase().includes("serie") || !params.seasonNumber) return [work.id];
  let query = db.from("works").select("id,episode_number")
    .eq("parent_work_id", work.id)
    .eq("season_number", params.seasonNumber);
  const scopedEpisodes = validEpisodeNumbers(params.episodeNumbers);
  if (params.episodeNumber) query = query.eq("episode_number", params.episodeNumber);
  else if (scopedEpisodes.length) query = query.in("episode_number", scopedEpisodes);
  const { data } = await query;
  return (data ?? []).map(row => row.id);
}

export async function markCollaborationReviewsCoeditorsReported(db: ServiceClient, params: {
  orgId: string;
  rightsHolderId: string;
  actorUserId: string;
  workId: string;
  shareCaseId: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  episodeNumbers?: number[] | null;
}) {
  const workIds = await resolveCollaborationReviewWorkIds(db, params);
  if (!workIds.length) return;
  await ensureMemberCollaborationReviews(db, { orgId: params.orgId, rightsHolderId: params.rightsHolderId });
  const now = new Date().toISOString();
  const { error } = await db.from("member_work_collaboration_reviews").update({
    status: "coeditors_reported",
    source: "coeditor_report",
    work_share_case_id: params.shareCaseId,
    reviewed_by_user_id: params.actorUserId,
    reviewed_at: now,
    dispute_note: null,
    resolved_by_user_id: null,
    resolved_at: null,
    updated_at: now,
  }).eq("org_id", params.orgId).eq("rights_holder_id", params.rightsHolderId).in("work_id", workIds);
  if (error) throw new Error(error.message);
}
