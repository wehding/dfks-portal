"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgId } from "@/lib/org";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { USER_ADMIN_ROLES } from "@/lib/admin-roles";
import { ensureWorkShareCase } from "@/lib/server/work-share-cases";
import { isCompleteShareResolution, normalizeSharePercent } from "@/lib/work-share-distribution";
import { normalizeWorkEditorRole } from "@/lib/work-editor-roles";
import { sendMemberNotification } from "@/lib/member-notifications";
import { markCollaborationReviewsCoeditorsReported } from "@/lib/server/work-collaboration-reviews";

async function ownContext(rightsHolderId: string) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) throw new Error("Du skal være logget ind.");
  const db = createServiceClient();
  const { data: holder } = await db.from("rettighedshavere").select("id,user_id").eq("id", rightsHolderId).maybeSingle();
  if (!holder || holder.user_id !== user.id) throw new Error("Du kan kun besvare dine egne opgaver.");
  return { db, user, holder, orgId: await requireOrgId(db, user.id) };
}

export async function fetchMemberShareTask(params: {
  rightsHolderId: string;
  workId: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}) {
  const { db, holder, orgId } = await ownContext(params.rightsHolderId);
  const { data: work } = await db.from("works").select("id,title,parent_work_id,season_number,episode_number").eq("id", params.workId).maybeSingle();
  if (!work) return { success: false as const, error: "Værket findes ikke." };
  const workId = work.parent_work_id && params.episodeNumber == null ? work.parent_work_id : work.id;
  const seasonNumber = params.seasonNumber ?? work.season_number ?? null;
  let caseQuery = db.from("work_share_cases").select("*").eq("org_id", orgId).eq("work_id", workId);
  caseQuery = seasonNumber ? caseQuery.eq("season_number", seasonNumber) : caseQuery.is("season_number", null);
  caseQuery = params.episodeNumber ? caseQuery.eq("episode_number", params.episodeNumber) : caseQuery.is("episode_number", null);
  let { data: shareCase } = await caseQuery.maybeSingle();

  const targetWorks = seasonNumber
    ? (await db.from("works").select("id,episode_number").eq("parent_work_id", workId).eq("season_number", seasonNumber)).data ?? []
    : [];
  const targetIds = seasonNumber
    ? targetWorks.map(row => row.id)
    : [workId];
  // A season can be represented either by assignments on its individual
  // episodes or by one assignment on the parent series. Include both, and do
  // not reveal participants/cases until the caller's own assignment is proven.
  const assignmentIds = [...new Set([workId, ...(targetIds.length ? targetIds : [workId])])];
  const { data: knownAssignments } = await db.from("work_assignments")
    .select("rights_holder_id,role").eq("org_id", orgId).in("work_id", assignmentIds).not("rights_holder_id", "is", null);
  const knownHolderIds = [...new Set((knownAssignments ?? []).map(row => row.rights_holder_id).filter(Boolean))];
  if (!knownHolderIds.includes(holder.id)) {
    return { success: false as const, error: "Værket er ikke tilknyttet din profil." };
  }
  if (!shareCase && knownHolderIds.length > 1) {
    shareCase = await ensureWorkShareCase(db, {
      orgId, workId, seasonNumber, episodeNumber: params.episodeNumber,
      episodeNumbers: targetWorks.map(row => row.episode_number).filter((number): number is number => number != null),
    });
    await db.from("work_share_participants").upsert(knownHolderIds.map(rightsHolderId => ({
      case_id: shareCase.id, org_id: orgId, work_id: workId, rights_holder_id: rightsHolderId,
      role: knownAssignments?.find(row => row.rights_holder_id === rightsHolderId)?.role ?? "Klipper",
      relationship_status: rightsHolderId === holder.id ? "pending" : "pending",
    })), { onConflict: "case_id,rights_holder_id" });
  }
  if (!shareCase) return { success: true as const, task: null, knownRightsHolderCount: knownHolderIds.length };

  const { data: ownParticipant } = await db.from("work_share_participants").select("id,relationship_status,response_scope,proposed_percent,responded_at")
    .eq("case_id", shareCase.id).eq("rights_holder_id", holder.id).maybeSingle();
  const { data: finalRows } = shareCase.status === "resolved"
    ? await db.from("work_share_participants").select("role,final_percent,rettighedshavere(full_name)").eq("case_id", shareCase.id).not("final_percent", "is", null)
    : { data: [] };
  const { data: reportedDeclines } = await db.from("work_share_participants")
    .select("proposed_name,rettighedshavere(full_name)")
    .eq("case_id", shareCase.id)
    .eq("invited_by_rights_holder_id", holder.id)
    .eq("relationship_status", "declined");
  return {
    success: true as const,
    knownRightsHolderCount: knownHolderIds.length,
    task: {
      id: shareCase.id,
      status: shareCase.status,
      reservePercent: shareCase.status === "resolved" ? shareCase.reserve_percent : null,
      ownParticipant,
      finalDistribution: finalRows ?? [],
      reportedDeclines: reportedDeclines ?? [],
    },
  };
}

export async function fetchMemberShareTaskTarget(params: { rightsHolderId: string; caseId: string }) {
  const { db, holder, orgId } = await ownContext(params.rightsHolderId);
  const { data: participant } = await db.from("work_share_participants").select("case_id")
    .eq("case_id", params.caseId).eq("org_id", orgId).eq("rights_holder_id", holder.id).maybeSingle();
  if (!participant) return { success: false as const, error: "Opgaven tilhører ikke dig." };
  const { data: shareCase } = await db.from("work_share_cases").select("work_id,season_number,episode_number")
    .eq("id", params.caseId).eq("org_id", orgId).maybeSingle();
  if (!shareCase) return { success: false as const, error: "Opgaven findes ikke." };
  return { success: true as const, target: shareCase };
}

export async function respondToWorkShareTask(params: {
  rightsHolderId: string;
  caseId: string;
  percent?: number | null;
  declined?: boolean;
  responseScope: "work" | "season" | "episode";
}) {
  const { db, user, holder } = await ownContext(params.rightsHolderId);
  const percent = params.declined ? null : normalizeSharePercent(params.percent);
  if (!params.declined && percent === null) return { success: false as const, error: "Angiv en procent mellem 0 og 100." };
  const { data: participant } = await db.from("work_share_participants").select("id,org_id,invited_by_rights_holder_id").eq("case_id", params.caseId).eq("rights_holder_id", holder.id).maybeSingle();
  if (!participant) return { success: false as const, error: "Opgaven tilhører ikke dig." };
  const { error } = await db.from("work_share_participants").update({
    relationship_status: params.declined ? "declined" : "confirmed",
    response_scope: params.responseScope,
    proposed_percent: percent,
    responded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", participant.id);
  if (error) return { success: false as const, error: error.message };
  if (!params.declined) {
    const { data: shareCase } = await db.from("work_share_cases")
      .select("id,org_id,work_id,season_number,episode_number,episode_numbers")
      .eq("id", params.caseId).maybeSingle();
    if (shareCase) {
      await markCollaborationReviewsCoeditorsReported(db, {
        orgId: shareCase.org_id,
        rightsHolderId: holder.id,
        actorUserId: user.id,
        workId: shareCase.work_id,
        shareCaseId: shareCase.id,
        seasonNumber: shareCase.season_number,
        episodeNumber: shareCase.episode_number,
        episodeNumbers: shareCase.episode_numbers,
      });
    }
  }
  if (params.declined && participant.invited_by_rights_holder_id && participant.invited_by_rights_holder_id !== holder.id) {
    await sendMemberNotification({
      eventKey: `work-share-declined:${params.caseId}:${holder.id}`,
      eventType: "work_share_declined",
      orgId: participant.org_id,
      rightsHolderId: participant.invited_by_rights_holder_id,
      category: "transactional",
      subject: "En angivet medklipper har afvist værket",
      bodyText: "En person, du angav som medklipper, har oplyst, at vedkommende ikke arbejdede på værket. DFKS gennemgår nu sagen.",
      path: `/portal/mine-vaerker?shareTask=${params.caseId}`,
      entityType: "work_share_case",
      entityId: params.caseId,
    });
  }
  const { count } = await db.from("work_share_participants").select("id", { count: "exact", head: true })
    .eq("case_id", params.caseId).in("relationship_status", ["pending", "pending_match"]);
  await db.from("work_share_cases").update({ status: count ? "awaiting_members" : "awaiting_admin", updated_at: new Date().toISOString() }).eq("id", params.caseId);
  revalidatePath("/portal");
  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/admin/vaerker");
  return { success: true as const };
}

export async function fetchAdminShareCases() {
  const session = await createClient();
  const admin = await assertAdminRole(session, USER_ADMIN_ROLES);
  if (!admin) throw new Error("Mangler adminrettigheder.");
  const db = createServiceClient();
  const { data, error } = await db.from("work_share_cases")
    .select("id,work_id,season_number,episode_number,status,resolution_scope,reserve_percent,created_at,works(title),work_share_participants(id,rights_holder_id,proposed_name,role,relationship_status,response_scope,proposed_percent,admin_seed_percent,final_percent,rettighedshavere(full_name))")
    .eq("org_id", admin.orgId).neq("status", "resolved").order("created_at");
  if (error) throw new Error(error.message);
  return { success: true as const, cases: data ?? [] };
}

export async function matchShareParticipant(params: { participantId: string; rightsHolderId: string }) {
  const session = await createClient();
  const admin = await assertAdminRole(session, USER_ADMIN_ROLES);
  if (!admin) throw new Error("Mangler adminrettigheder.");
  const db = createServiceClient();
  const { data: participant } = await db.from("work_share_participants").select("id,case_id,proposed_name,role").eq("id", params.participantId).eq("org_id", admin.orgId).maybeSingle();
  if (!participant) throw new Error("Deltageren findes ikke.");
  const { data: affiliation } = await db.from("org_affiliations").select("rights_holder_id")
    .eq("org_id", admin.orgId).eq("rights_holder_id", params.rightsHolderId).maybeSingle();
  if (!affiliation) throw new Error("Rettighedshaveren er ikke tilknyttet organisationen.");
  const { error } = await db.from("work_share_participants").update({ rights_holder_id: params.rightsHolderId, relationship_status: "pending", updated_at: new Date().toISOString() }).eq("id", participant.id);
  if (error) throw new Error(error.message);
  await import("@/lib/member-notifications").then(({ sendMemberNotification }) => sendMemberNotification({
    eventKey: `work-share-request:${participant.case_id}:${params.rightsHolderId}`,
    eventType: "work_share_request", orgId: admin.orgId, rightsHolderId: params.rightsHolderId,
    category: "transactional", subject: "Angiv din arbejdsandel på et værk",
    bodyText: "Du er blevet angivet som medklipper. Åbn Mine værker og angiv din arbejdsandel eller afvis tilknytningen.",
    path: `/portal/mine-vaerker?shareTask=${participant.case_id}`, entityType: "work_share_case", entityId: participant.case_id,
  }));
  revalidatePath("/admin/vaerker");
  return { success: true as const };
}

export async function resolveAdminShareCase(params: {
  caseId: string;
  reservePercent: number;
  participants: Array<{ participantId: string; finalPercent: number | null }>;
}) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  const admin = await assertAdminRole(session, USER_ADMIN_ROLES);
  if (!admin || !user) throw new Error("Mangler adminrettigheder.");
  const db = createServiceClient();
  const { data: shareCase } = await db.from("work_share_cases").select("*").eq("id", params.caseId).eq("org_id", admin.orgId).maybeSingle();
  if (!shareCase) throw new Error("Fordelingssagen findes ikke.");
  const { data: participantRows } = await db.from("work_share_participants").select("id,rights_holder_id,role,final_percent").eq("case_id", shareCase.id);
  const finalById = new Map(params.participants.map(row => [row.participantId, normalizeSharePercent(row.finalPercent)]));
  if (!isCompleteShareResolution((participantRows ?? []).map(row => finalById.get(row.id) ?? null), params.reservePercent)) {
    throw new Error("De endelige andele og reserven skal tilsammen være 100 %. ");
  }
  for (const participant of participantRows ?? []) {
    const finalPercent = finalById.get(participant.id) ?? null;
    await db.from("work_share_participants").update({ final_percent: finalPercent, updated_at: new Date().toISOString() }).eq("id", participant.id);
  }
  let targetWorkIds = [shareCase.work_id as string];
  if (shareCase.season_number) {
    const { data: episodes } = await db.from("works").select("id,episode_number").eq("parent_work_id", shareCase.work_id).eq("season_number", shareCase.season_number);
    const scopedNumbers = new Set<number>((shareCase.episode_numbers ?? []) as number[]);
    targetWorkIds = shareCase.episode_number
      ? (episodes ?? []).filter(row => row.episode_number === shareCase.episode_number).map(row => row.id)
      : scopedNumbers.size
        ? (episodes ?? []).filter(row => row.episode_number != null && scopedNumbers.has(row.episode_number)).map(row => row.id)
        : (episodes ?? []).map(row => row.id);
    if (!targetWorkIds.length) targetWorkIds = [shareCase.work_id];
  }
  for (const participant of participantRows ?? []) {
    if (!participant.rights_holder_id) continue;
    const finalPercent = finalById.get(participant.id);
    if (finalPercent === null || finalPercent === undefined) continue;
    await db.from("work_assignments").upsert(targetWorkIds.map(workId => ({
      org_id: admin.orgId, work_id: workId, rights_holder_id: participant.rights_holder_id,
      role: normalizeWorkEditorRole(participant.role), share_percent: finalPercent,
    })), { onConflict: "work_id,rights_holder_id,role" });
  }
  const snapshot = { resolvedAt: new Date().toISOString(), reservePercent: params.reservePercent, participants: params.participants };
  const history = Array.isArray(shareCase.resolution_history) ? shareCase.resolution_history : [];
  const { error } = await db.from("work_share_cases").update({
    status: "resolved", reserve_percent: params.reservePercent, resolved_by_user_id: user.id,
    resolved_at: snapshot.resolvedAt, resolution_history: [...history, snapshot], updated_at: snapshot.resolvedAt,
  }).eq("id", shareCase.id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/vaerker");
  revalidatePath("/portal/mine-vaerker");
  return { success: true as const };
}
