"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncMemberEpisodeAssignments } from "@/app/actions/member-works";
import { resolveSeriesScopeTarget, syncScopeToDraftContracts, upsertMemberSeriesEpisodeScope } from "@/lib/server/member-series-episode-scopes";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

export async function confirmContractEpisodes(input: {
  contractId: string;
  seasonNumber: number;
  episodeNumbers: number[];
  entireSeason?: boolean;
}) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient({ audit: { actorUserId: user.id, source: "portal", correlationId: crypto.randomUUID(), mode: "summary" } });
  const { data: holder } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).maybeSingle();
  if (!holder) return { success: false, error: "Rettighedshaverprofil blev ikke fundet" };
  const { data: contract } = await db.from("contracts")
    .select("id,org_id,rights_holder_id,work_id,works(type,parent_work_id)")
    .eq("id", input.contractId).eq("rights_holder_id", holder.id).maybeSingle();
  if (!contract?.work_id) return { success: false, error: "Kontrakten mangler et tilknyttet værk" };
  const workRelation = contract.works as unknown;
  const work = Array.isArray(workRelation) ? workRelation[0] : workRelation as { type?: string | null } | null;
  if (!String(work?.type ?? "").includes("serie")) return { success: false, error: "Afsnitsbekræftelse gælder kun serier" };
  const seasonNumber = Math.max(1, Math.floor(Number(input.seasonNumber) || 1));
  const episodeNumbers = [...new Set(input.episodeNumbers.map(Number).filter(value => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
  if (!input.entireSeason && episodeNumbers.length === 0) return { success: false, error: "Vælg mindst ét afsnit" };
  const scopeTarget = await resolveSeriesScopeTarget(db, contract.work_id, seasonNumber);
  if (!scopeTarget) return { success: false, error: "Seriens sæson kunne ikke bestemmes" };
  const { data: assignment } = await db.from("work_assignments").select("role")
    .eq("rights_holder_id", holder.id).in("work_id", [contract.work_id, scopeTarget.seriesWorkId]).limit(1).maybeSingle();
  const assignmentSync = await syncMemberEpisodeAssignments({
    rightsHolderId: holder.id,
    workId: scopeTarget.seriesWorkId,
    role: assignment?.role ?? "Klipper",
    selectedEpisodes: episodeNumbers,
    seasonNumber,
    coversWholeSeason: Boolean(input.entireSeason),
  });
  if (!assignmentSync.success) return { success: false, error: assignmentSync.error ?? "Afsnitsvalget kunne ikke overføres til Mine værker" };
  const scopeResult = await upsertMemberSeriesEpisodeScope(db, {
    orgId: contract.org_id,
    rightsHolderId: holder.id,
    seriesWorkId: scopeTarget.seriesWorkId,
    seasonNumber: scopeTarget.seasonNumber,
    status: "confirmed",
    episodeNumbers,
    coversWholeSeason: input.entireSeason,
    source: "contract_link",
  });
  if (!scopeResult.success) return scopeResult;
  const version = createHash("sha256").update(`${contract.work_id}:${seasonNumber}:${episodeNumbers.join(",")}:${Boolean(input.entireSeason)}`).digest("hex");
  await db.from("contract_episode_confirmations").update({ invalidated_at: new Date().toISOString() }).eq("contract_id", contract.id).is("invalidated_at", null);
  const { error } = await db.from("contract_episode_confirmations").insert({
    contract_id: contract.id, org_id: contract.org_id, rights_holder_id: holder.id,
    work_id: contract.work_id, season_number: seasonNumber,
    scope: input.entireSeason ? "entire_season" : "selected_episodes",
    episode_numbers: episodeNumbers, work_data_version: version, confirmed_by: user.id,
  });
  if (error) return { success: false, error: "Afsnittene kunne ikke bekræftes" };
  await db.from("contracts").update({ episode_scope_id: scopeResult.scope.id, season_number: seasonNumber, episode_numbers: input.entireSeason ? [] : episodeNumbers }).eq("id", contract.id);
  await syncScopeToDraftContracts(db, scopeResult.scope);
  await db.from("contract_import_items").update({ status: "ready_for_review" }).eq("contract_id", contract.id).eq("org_id", contract.org_id);
  await recordSensitiveFlow({ actor: { userId: user.id, orgId: contract.org_id, role: "member", source: "portal" }, action: "update", component: "portal.contracts.episode-confirmation", entityType: "contracts", entityId: contract.id, targetMemberUuid: holder.id, orgIds: [contract.org_id], purposeCode: "member_contract_management", legalBasis: "GDPR Art. 6(1)(b) og 9(2)(d)", dataCategories: ["contract_data", "union_membership_data"], counts: { episodeCount: episodeNumbers.length, entireSeason: Boolean(input.entireSeason) } });
  revalidatePath("/portal/mine-kontrakter");
  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/portal");
  revalidatePath("/admin/kontrakter");
  return { success: true };
}
