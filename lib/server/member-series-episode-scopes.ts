import "server-only";

import type { createServiceClient } from "@/lib/supabase/service";
import { classifyEpisodeSelection } from "@/lib/member-series-episode-selection";

export { normalizeEpisodeNumbers } from "@/lib/member-series-episode-selection";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type EpisodeScopeSource = "onboarding" | "contract_upload" | "contract_link" | "mine_works" | "legacy";
export type EpisodeScopeStatus = "pending" | "confirmed";

export type MemberSeriesEpisodeScope = {
  id: string;
  org_id: string;
  rights_holder_id: string;
  series_work_id: string;
  season_number: number;
  status: EpisodeScopeStatus;
  episode_numbers: number[];
  covers_whole_season: boolean;
  source: EpisodeScopeSource;
  confirmed_at: string | null;
};

export async function resolveSeriesScopeTarget(
  db: ServiceClient,
  workId: string,
  seasonNumber?: number | null,
) {
  const { data: work, error } = await db
    .from("works")
    .select("id,type,parent_work_id,season_number")
    .eq("id", workId)
    .maybeSingle();
  if (error || !work) return null;
  const isSeries = String(work.type ?? "").includes("serie") || Boolean(work.parent_work_id);
  if (!isSeries) return null;
  return {
    seriesWorkId: work.parent_work_id ?? work.id,
    seasonNumber: Math.max(1, Math.floor(Number(seasonNumber ?? work.season_number ?? 1) || 1)),
  };
}

export async function upsertMemberSeriesEpisodeScope(
  db: ServiceClient,
  params: {
    orgId: string;
    rightsHolderId: string;
    seriesWorkId: string;
    seasonNumber: number;
    status: EpisodeScopeStatus;
    episodeNumbers?: number[];
    coversWholeSeason?: boolean;
    source: EpisodeScopeSource;
    allowConfirmedToPending?: boolean;
  },
) {
  const seasonNumber = Math.max(1, Math.floor(Number(params.seasonNumber) || 1));
  const selection = classifyEpisodeSelection(params.episodeNumbers, params.status === "confirmed" && params.coversWholeSeason);
  const episodeNumbers = selection.episodeNumbers;
  const coversWholeSeason = selection.coversWholeSeason;
  if (params.status === "confirmed" && selection.status === "pending") {
    return { success: false as const, error: "Vælg mindst ét afsnit eller hele sæsonen." };
  }

  const key = {
    org_id: params.orgId,
    rights_holder_id: params.rightsHolderId,
    series_work_id: params.seriesWorkId,
    season_number: seasonNumber,
  };
  const { data: existing } = await db
    .from("member_series_episode_scopes")
    .select("id,org_id,rights_holder_id,series_work_id,season_number,status,episode_numbers,covers_whole_season,source,confirmed_at")
    .match(key)
    .maybeSingle();
  if (existing?.status === "confirmed" && params.status === "pending" && !params.allowConfirmedToPending) {
    return { success: true as const, scope: existing as MemberSeriesEpisodeScope };
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("member_series_episode_scopes")
    .upsert({
      ...key,
      status: params.status,
      episode_numbers: params.status === "confirmed" && !coversWholeSeason ? episodeNumbers : [],
      covers_whole_season: coversWholeSeason,
      source: params.source,
      confirmed_at: params.status === "confirmed" ? now : null,
      updated_at: now,
    }, { onConflict: "org_id,rights_holder_id,series_work_id,season_number" })
    .select("id,org_id,rights_holder_id,series_work_id,season_number,status,episode_numbers,covers_whole_season,source,confirmed_at")
    .single();
  if (error || !data) return { success: false as const, error: error?.message ?? "Afsnitsvalget kunne ikke gemmes." };
  return { success: true as const, scope: data as MemberSeriesEpisodeScope };
}

export async function syncScopeToDraftContracts(
  db: ServiceClient,
  scope: MemberSeriesEpisodeScope,
) {
  const { data: childWorks } = await db.from("works").select("id").eq("parent_work_id", scope.series_work_id);
  const workIds = [scope.series_work_id, ...(childWorks ?? []).map(work => work.id)];
  const { error } = await db
    .from("contracts")
    .update({
      episode_scope_id: scope.id,
      season_number: scope.season_number,
      episode_numbers: scope.covers_whole_season ? [] : scope.episode_numbers,
    })
    .eq("org_id", scope.org_id)
    .eq("rights_holder_id", scope.rights_holder_id)
    .neq("status", "valideret")
    .in("work_id", workIds)
    .or(`season_number.is.null,season_number.eq.${scope.season_number}`);
  return error ? { success: false as const, error: error.message } : { success: true as const };
}
