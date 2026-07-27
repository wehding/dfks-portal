import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IdentityCandidate, WorkIdentityLevel } from "@/lib/work-identity";

function externalIdType(level: WorkIdentityLevel) {
  return level === "movie" ? "film_id" : level === "series" ? "series_id" : "episode_id";
}

export async function storeWorkExternalIdentity(db: SupabaseClient, params: {
  orgId: string;
  workId: string;
  level: WorkIdentityLevel;
  candidate: IdentityCandidate;
}) {
  const rows = [
    ["imdb", params.candidate.imdbId],
    ["tmdb", params.candidate.tmdbId],
    ["wikidata", params.candidate.wikidataId],
    ["dfi", params.candidate.dfiId],
  ].filter((item): item is [string, string] => Boolean(item[1])).map(([source, externalId]) => ({
    org_id: params.orgId,
    work_id: params.workId,
    source,
    external_id_type: externalIdType(params.level),
    external_id: externalId,
  }));
  if (!rows.length) return;

  // ignoreDuplicates sikrer, at et ID aldrig flyttes fra et andet værk under automatisk berigelse.
  const { error } = await db.from("work_external_ids").upsert(rows, {
    onConflict: "source,external_id_type,external_id",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(error.message);
}
