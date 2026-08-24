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
    .select("work_id,works!inner(id,type,parent_work_id,season_number,episode_number)")
    .eq("org_id", params.orgId)
    .eq("rights_holder_id", params.rightsHolderId);
  if (error) throw new Error(error.message);
  const episodeSeasons = new Map<string, { seriesWorkId: string; seasonNumber: number }>();
  for (const assignment of assignments ?? []) {
    const work = Array.isArray(assignment.works) ? assignment.works[0] : assignment.works;
    if (!work?.parent_work_id || work.season_number == null || work.episode_number == null) continue;
    episodeSeasons.set(`${work.parent_work_id}:${work.season_number}`, {
      seriesWorkId: work.parent_work_id,
      seasonNumber: work.season_number,
    });
  }
  if (episodeSeasons.size) {
    const { error: scopeError } = await db.from("member_series_episode_scopes").upsert(
      [...episodeSeasons.values()].map(season => ({
        org_id: params.orgId,
        rights_holder_id: params.rightsHolderId,
        series_work_id: season.seriesWorkId,
        season_number: season.seasonNumber,
        status: "pending",
        episode_numbers: [],
        covers_whole_season: false,
        source: "legacy",
      })),
      { onConflict: "org_id,rights_holder_id,series_work_id,season_number", ignoreDuplicates: true },
    );
    if (scopeError) throw new Error(scopeError.message);
  }
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
  shareCaseId?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  episodeNumbers?: number[] | null;
}) {
  const workIds = await resolveCollaborationReviewWorkIds(db, params);
  if (!workIds.length) return;
  await ensureMemberCollaborationReviews(db, { orgId: params.orgId, rightsHolderId: params.rightsHolderId });
  const now = new Date().toISOString();
  const payload: Record<string, string | null> = {
    status: "coeditors_reported",
    source: "coeditor_report",
    reviewed_by_user_id: params.actorUserId,
    reviewed_at: now,
    dispute_note: null,
    resolved_by_user_id: null,
    resolved_at: null,
    updated_at: now,
  };
  if (params.shareCaseId) payload.work_share_case_id = params.shareCaseId;
  const { error } = await db.from("member_work_collaboration_reviews").update(payload).eq("org_id", params.orgId).eq("rights_holder_id", params.rightsHolderId).in("work_id", workIds);
  if (error) throw new Error(error.message);
}
