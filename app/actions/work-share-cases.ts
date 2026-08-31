"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgId } from "@/lib/org";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { USER_ADMIN_ROLES } from "@/lib/admin-roles";
import { ensureWorkShareCase, saveKnownShareParticipant } from "@/lib/server/work-share-cases";
import { isCompleteShareResolution, normalizeSharePercent } from "@/lib/work-share-distribution";
import { normalizeWorkEditorRole } from "@/lib/work-editor-roles";
import { sendMemberNotification } from "@/lib/member-notifications";
import { markCollaborationReviewsCoeditorsReported } from "@/lib/server/work-collaboration-reviews";
import { buildReconciledWorkCredits, getWorkCreditSourceStates, matchWorkCreditsToRightsHolders, refreshWorkCreditEvidence } from "@/lib/server/work-credit-evidence";
import { isEligibleWorkShareRole, normalizeCreditName, proposeWorkShareCompromise } from "@/lib/work-share-reconciliation";
import { normalizeSingleEmail } from "@/lib/email/mime";
import { countUniqueWorkShareTasks } from "@/lib/work-share-task-count";
import { isActionableAdminWorkShareCase, type WorkShareAdminParticipantSummary } from "@/lib/work-share-admin";
import { mergeWorkShareSourceEvidence } from "@/lib/work-share-source-evidence";
import { paginateWorkShareQueue, type WorkShareQueueReference, type WorkShareQueueTaskType } from "@/lib/work-share-admin-queue";
import { recordAuditEvent } from "@/lib/audit-log-server";
import type { AuditContext } from "@/lib/audit-log";
import { randomUUID } from "node:crypto";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

const ADMIN_SHARE_CASE_SELECT = "id,work_id,season_number,episode_number,status,resolution_scope,reserve_percent,created_at,works(title),work_share_participants(id,rights_holder_id,proposed_name,role,relationship_status,response_scope,proposed_percent,admin_seed_percent,final_percent,source_tags,source_details,invited_by_rights_holder_id,excluded_at,last_reminder_sent_at,rettighedshavere!work_share_participants_rights_holder_id_fkey(full_name,email,user_id,invite_sent_at),reported_by:rettighedshavere!work_share_participants_invited_by_rights_holder_id_fkey(full_name))";
type AdminShareCaseRecord = Record<string, unknown> & {
  work_id: string;
  season_number: number | null;
  episode_number: number | null;
  work_share_participants?: WorkShareAdminParticipantSummary[] | null;
};

async function attachCreditSourceStates(db: ReturnType<typeof createServiceClient>, orgId: string, cases: AdminShareCaseRecord[]) {
  const workIds = [...new Set(cases.map(row => String(row.work_id ?? "")).filter(Boolean))];
  const states = await getWorkCreditSourceStates(db, { orgId, workIds });
  return cases.map(row => ({ ...row, credit_source_states: states.get(row.work_id) ?? [] }));
}

async function fetchAdminShareCase(db: ReturnType<typeof createServiceClient>, orgId: string, caseId: string) {
  const { data, error } = await db.from("work_share_cases").select(ADMIN_SHARE_CASE_SELECT)
    .eq("id", caseId).eq("org_id", orgId).maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "Fordelingssagen findes ikke.");
  return (await attachCreditSourceStates(db, orgId, [data as unknown as AdminShareCaseRecord]))[0];
}

async function shareAdminContext() {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  const admin = await assertAdminRole(session, USER_ADMIN_ROLES);
  if (!admin || !user) throw new Error("Mangler adminrettigheder.");
  return { admin, user, db: createServiceClient() };
}

function shareAuditContext(admin: { orgId: string; role: string }, userId: string): AuditContext {
  return {
    actorUserId: userId,
    actorOrgId: admin.orgId,
    actorRole: admin.role,
    source: "admin",
    correlationId: randomUUID(),
    requestId: randomUUID(),
    systemComponent: "admin.work-shares",
  };
}

async function auditShareRead(input: {
  admin: { orgId: string; role: string };
  userId: string;
  action: "read" | "search";
  entityId?: string | null;
  memberIds: string[];
  metadata: Record<string, unknown>;
}) {
  const context = shareAuditContext(input.admin, input.userId);
  const targetMemberUuids = [...new Set(input.memberIds.filter(Boolean))];
  await recordAuditEvent({ context, action: input.action, entityType: "work_share_queue", entityId: input.entityId, orgIds: [input.admin.orgId], targetMemberUuids, purposeCode: "rights_distribution", legalBasis: "GDPR Art. 6(1)(c)/(f), Art. 9(2)(d)", dataCategories: ["work_credit_data"], metadata: input.metadata });
}

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
    .select("id,rights_holder_id,role,rettighedshavere(id,full_name)").eq("org_id", orgId).in("work_id", assignmentIds).not("rights_holder_id", "is", null);
  const eligibleAssignments = (knownAssignments ?? []).filter(row => isEligibleWorkShareRole(row.role));
  const knownHolderIds = [...new Set(eligibleAssignments.map(row => row.rights_holder_id).filter(Boolean))];
  if (!knownHolderIds.includes(holder.id)) {
    return { success: false as const, error: "Værket er ikke tilknyttet din profil." };
  }
  await recordSensitiveFlow({
    actor: { userId: holder.user_id, orgId, role: "member", source: "portal" }, action: "read",
    component: "portal.work_share_task", entityType: "work_share_case", entityId: shareCase?.id ?? null,
    targetMemberUuid: holder.id, targetMemberUuids: knownHolderIds, purposeCode: "work_share_resolution",
    legalBasis: "gdpr_art_6_1_b", dataCategories: ["work_data", "rights_data"], counts: { participants: knownHolderIds.length },
  });
  const registeredCoEditors = [...new Map(eligibleAssignments
    .filter(row => row.rights_holder_id && row.rights_holder_id !== holder.id)
    .map(row => {
      const related = Array.isArray(row.rettighedshavere) ? row.rettighedshavere[0] : row.rettighedshavere;
      return [`${row.rights_holder_id}:${row.role}`, {
        assignmentId: row.id,
        rightsHolderId: row.rights_holder_id as string,
        name: related?.full_name ?? "Ukendt medklipper",
        role: row.role ?? "Klipper",
      }] as const;
    })).values()];
  if (!shareCase && knownHolderIds.length > 1) {
    shareCase = await ensureWorkShareCase(db, {
      orgId, workId, seasonNumber, episodeNumber: params.episodeNumber,
      episodeNumbers: targetWorks.map(row => row.episode_number).filter((number): number is number => number != null),
    });
    await Promise.all(knownHolderIds.map(rightsHolderId => saveKnownShareParticipant(db, {
      case_id: shareCase.id,
      org_id: orgId,
      work_id: workId,
      rights_holder_id: rightsHolderId,
      role: eligibleAssignments.find(row => row.rights_holder_id === rightsHolderId)?.role ?? "Klipper",
      relationship_status: "pending",
      updated_at: new Date().toISOString(),
    })));
  }
  if (!shareCase) return { success: true as const, task: null, knownRightsHolderCount: knownHolderIds.length, registeredCoEditors };

  const { data: ownParticipant } = await db.from("work_share_participants").select("id,relationship_status,response_scope,proposed_percent,responded_at")
    .eq("case_id", shareCase.id).eq("rights_holder_id", holder.id).maybeSingle();
  const { data: finalRows } = shareCase.status === "resolved"
    ? await db.from("work_share_participants").select("role,final_percent,rettighedshavere!work_share_participants_rights_holder_id_fkey(full_name)").eq("case_id", shareCase.id).not("final_percent", "is", null)
    : { data: [] };
  const { data: reportedDeclines } = await db.from("work_share_participants")
    .select("proposed_name,rettighedshavere!work_share_participants_rights_holder_id_fkey(full_name)")
    .eq("case_id", shareCase.id)
    .eq("invited_by_rights_holder_id", holder.id)
    .eq("relationship_status", "declined");
  return {
    success: true as const,
    knownRightsHolderCount: knownHolderIds.length,
    registeredCoEditors,
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

export async function fetchMemberCoEditorSuggestions(params: {
  rightsHolderId: string;
  workId: string;
  seasonNumber?: number | null;
}) {
  const { db, holder, orgId } = await ownContext(params.rightsHolderId);
  const { data: work, error: workError } = await db.from("works")
    .select("id,parent_work_id,season_number")
    .eq("id", params.workId)
    .maybeSingle();
  if (workError || !work) return { success: false as const, error: workError?.message ?? "Værket findes ikke." };

  const evidenceWorkId = work.parent_work_id ?? work.id;
  const seasonNumber = params.seasonNumber ?? work.season_number ?? null;
  const { data: seasonWorks, error: seasonError } = seasonNumber != null
    ? await db.from("works").select("id").eq("parent_work_id", evidenceWorkId).eq("season_number", seasonNumber)
    : { data: [], error: null };
  if (seasonError) return { success: false as const, error: seasonError.message };
  const assignmentWorkIds = [...new Set([params.workId, evidenceWorkId, ...(seasonWorks ?? []).map(row => row.id)])];
  const { data: assignments, error: assignmentError } = await db.from("work_assignments")
    .select("rights_holder_id")
    .eq("org_id", orgId)
    .in("work_id", assignmentWorkIds)
    .not("rights_holder_id", "is", null);
  if (assignmentError) return { success: false as const, error: assignmentError.message };
  if (!(assignments ?? []).some(row => row.rights_holder_id === holder.id)) {
    return { success: false as const, error: "Værket er ikke tilknyttet din profil." };
  }

  await refreshWorkCreditEvidence(db, { orgId, workId: evidenceWorkId });
  const credits = await matchWorkCreditsToRightsHolders(db, {
    orgId,
    credits: await buildReconciledWorkCredits(db, {
      orgId,
      workId: evidenceWorkId,
      caseId: null,
      seasonNumber,
    }),
  });
  const existingHolderIds = new Set((assignments ?? []).map(row => row.rights_holder_id).filter(Boolean));
  return {
    success: true as const,
    suggestions: credits
      .filter(credit => credit.rightsHolderId !== holder.id)
      .filter(credit => !credit.rightsHolderId || !existingHolderIds.has(credit.rightsHolderId))
      .map(credit => ({
        key: credit.key,
        name: credit.name,
        rightsHolderId: credit.matchType === "conflict" ? null : credit.rightsHolderId,
        role: normalizeWorkEditorRole(credit.roles[0] ?? "Klipper"),
        sources: credit.sources,
        matchType: credit.matchType,
      })),
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
  const [{ data, error }, { data: disputes, error: disputeError }] = await Promise.all([
    db.from("work_share_cases").select(ADMIN_SHARE_CASE_SELECT)
      .eq("org_id", admin.orgId).neq("status", "resolved").order("created_at"),
    db.from("member_work_collaboration_reviews")
      .select("id,work_id,works(title,season_number,episode_number),rettighedshavere(full_name)")
      .eq("org_id", admin.orgId).eq("status", "disputed"),
  ]);
  if (error || disputeError) throw new Error(error?.message ?? disputeError?.message ?? "Arbejdsandelene kunne ikke hentes.");
  const actionableCases = ((data ?? []) as unknown as AdminShareCaseRecord[]).filter(isActionableAdminWorkShareCase);
  const cases = await attachCreditSourceStates(db, admin.orgId, actionableCases);
  const references = cases.map(row => ({
    work_id: String(row.work_id), season_number: row.season_number as number | null, episode_number: row.episode_number as number | null,
  }));
  for (const row of disputes ?? []) {
    const work = row.works as unknown as { season_number?: number | null; episode_number?: number | null } | null;
    references.push({ work_id: row.work_id, season_number: work?.season_number ?? null, episode_number: work?.episode_number ?? null });
  }
  return { success: true as const, cases, disputes: disputes ?? [], count: countUniqueWorkShareTasks(references) };
}

export type AdminShareQueueParams = {
  page?: number;
  pageSize?: number;
  search?: string;
  taskType?: WorkShareQueueTaskType;
};

export async function fetchAdminShareQueue(params: AdminShareQueueParams = {}) {
  const { admin, user, db } = await shareAdminContext();
  const [{ data: cases, error: caseError }, { data: disputes, error: disputeError }] = await Promise.all([
    db.from("work_share_cases")
      .select("id,work_id,season_number,episode_number,status,updated_at,works(title),work_share_participants(rights_holder_id,invited_by_rights_holder_id,relationship_status,source_tags,excluded_at)")
      .eq("org_id", admin.orgId).neq("status", "resolved"),
    db.from("member_work_collaboration_reviews")
      .select("id,work_id,rights_holder_id,reviewed_at,updated_at,works(title,season_number,episode_number)")
      .eq("org_id", admin.orgId).eq("status", "disputed"),
  ]);
  if (caseError || disputeError) throw new Error(caseError?.message ?? disputeError?.message ?? "Arbejdsandelene kunne ikke hentes.");

  const references: WorkShareQueueReference[] = [];
  const memberIdsByScope = new Map<string, Set<string>>();
  const addMemberToScope = (workId: string, seasonNumber: number | null, episodeNumber: number | null, memberId: string | null | undefined) => {
    if (!memberId) return;
    const key = `${workId}:${seasonNumber ?? "work"}:${episodeNumber ?? "scope"}`;
    const ids = memberIdsByScope.get(key) ?? new Set<string>();
    ids.add(memberId);
    memberIdsByScope.set(key, ids);
  };
  for (const row of (cases ?? []).filter(candidate => isActionableAdminWorkShareCase(candidate))) {
    const participants = (row.work_share_participants ?? []).filter(participant => !participant.excluded_at);
    const work = Array.isArray(row.works) ? row.works[0] : row.works;
    references.push({
      kind: "share",
      id: row.id,
      workId: row.work_id,
      title: work?.title ?? "Ukendt værk",
      seasonNumber: row.season_number,
      episodeNumber: row.episode_number,
      participantCount: participants.length,
      missingResponseCount: participants.filter(participant => participant.rights_holder_id && ["pending", "pending_match"].includes(participant.relationship_status)).length,
      unresolvedCount: participants.filter(participant => !participant.rights_holder_id).length,
      updatedAt: row.updated_at,
    });
    for (const participant of participants) {
      addMemberToScope(row.work_id, row.season_number, row.episode_number, participant.rights_holder_id);
      addMemberToScope(row.work_id, row.season_number, row.episode_number, participant.invited_by_rights_holder_id);
    }
  }
  for (const row of disputes ?? []) {
    const work = Array.isArray(row.works) ? row.works[0] : row.works;
    references.push({
      kind: "dispute",
      id: row.id,
      workId: row.work_id,
      title: work?.title ?? "Ukendt værk",
      seasonNumber: work?.season_number ?? null,
      episodeNumber: work?.episode_number ?? null,
      participantCount: 0,
      missingResponseCount: 0,
      unresolvedCount: 0,
      updatedAt: row.updated_at ?? row.reviewed_at ?? new Date(0).toISOString(),
    });
    addMemberToScope(row.work_id, work?.season_number ?? null, work?.episode_number ?? null, row.rights_holder_id);
  }
  const result = paginateWorkShareQueue({
    references,
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 20,
    search: params.search,
    taskType: params.taskType,
  });
  const targetMemberIds = result.rows.flatMap(row => [...(memberIdsByScope.get(`${row.workId}:${row.seasonNumber ?? "work"}:${row.episodeNumber ?? "scope"}`) ?? [])]);
  await auditShareRead({
    admin,
    userId: user.id,
    action: params.search?.trim() || (params.taskType && params.taskType !== "all") ? "search" : "read",
    memberIds: targetMemberIds,
    metadata: { page: result.page, pageSize: result.pageSize, resultCount: result.rows.length, taskType: params.taskType ?? "all" },
  });
  return { success: true as const, ...result };
}

export async function fetchAdminShareTaskDetail(taskKey: string) {
  const { admin, user, db } = await shareAdminContext();
  const [kind, id] = taskKey.split(":", 2);
  if (!id || !["share", "dispute"].includes(kind)) throw new Error("Arbejdsandelssagen er ugyldig.");

  let shareCase: Awaited<ReturnType<typeof fetchAdminShareCase>> | null = null;
  let workId: string | null = null;
  let seasonNumber: number | null = null;
  let episodeNumber: number | null = null;
  if (kind === "share") {
    shareCase = await fetchAdminShareCase(db, admin.orgId, id);
    workId = String(shareCase.work_id);
    seasonNumber = shareCase.season_number as number | null;
    episodeNumber = shareCase.episode_number as number | null;
  } else {
    const { data: dispute } = await db.from("member_work_collaboration_reviews")
      .select("work_id,works(season_number,episode_number)").eq("id", id).eq("org_id", admin.orgId).eq("status", "disputed").maybeSingle();
    if (!dispute) throw new Error("Indsigelsen findes ikke.");
    const work = Array.isArray(dispute.works) ? dispute.works[0] : dispute.works;
    workId = dispute.work_id;
    seasonNumber = work?.season_number ?? null;
    episodeNumber = work?.episode_number ?? null;
    let relatedQuery = db.from("work_share_cases").select("id")
      .eq("org_id", admin.orgId).eq("work_id", workId).neq("status", "resolved");
    relatedQuery = seasonNumber == null ? relatedQuery.is("season_number", null) : relatedQuery.eq("season_number", seasonNumber);
    relatedQuery = episodeNumber == null ? relatedQuery.is("episode_number", null) : relatedQuery.eq("episode_number", episodeNumber);
    const { data: relatedCase } = await relatedQuery.maybeSingle();
    if (relatedCase) shareCase = await fetchAdminShareCase(db, admin.orgId, relatedCase.id);
  }
  const { data: disputes, error } = await db.from("member_work_collaboration_reviews")
    .select("id,rights_holder_id,work_id,works(title,season_number,episode_number),rettighedshavere(full_name)")
    .eq("org_id", admin.orgId).eq("work_id", workId).eq("status", "disputed");
  if (error) throw new Error(error.message);
  const scopedDisputes = (disputes ?? []).filter(row => {
    const work = Array.isArray(row.works) ? row.works[0] : row.works;
    return (work?.season_number ?? null) === seasonNumber && (work?.episode_number ?? null) === episodeNumber;
  });
  const participants = (shareCase?.work_share_participants ?? []) as WorkShareAdminParticipantSummary[];
  const memberIds = [
    ...participants.flatMap(participant => [participant.rights_holder_id, participant.invited_by_rights_holder_id]),
    ...scopedDisputes.map(row => row.rights_holder_id),
  ].filter((memberId): memberId is string => Boolean(memberId));
  await auditShareRead({ admin, userId: user.id, action: "read", entityId: id, memberIds, metadata: { taskKind: kind, participantCount: participants.length, disputeCount: scopedDisputes.length } });
  return { success: true as const, shareCase, disputes: scopedDisputes };
}

export async function countAdminShareTasks() {
  const { admin, db } = await shareAdminContext();
  const [{ data: cases, error: caseError }, { data: disputes, error: disputeError }] = await Promise.all([
    db.from("work_share_cases").select("id,work_id,season_number,episode_number,work_share_participants(rights_holder_id,invited_by_rights_holder_id,source_tags,excluded_at)").eq("org_id", admin.orgId).neq("status", "resolved"),
    db.from("member_work_collaboration_reviews").select("id,work_id,works(season_number,episode_number)").eq("org_id", admin.orgId).eq("status", "disputed"),
  ]);
  if (caseError || disputeError) throw new Error(caseError?.message ?? disputeError?.message ?? "Opgaverne kunne ikke tælles.");
  const actionableCases = (cases ?? []).filter(row => isActionableAdminWorkShareCase(row));
  const references = actionableCases.map(row => ({
    work_id: row.work_id,
    season_number: row.season_number,
    episode_number: row.episode_number,
  }));
  for (const row of disputes ?? []) {
    const work = row.works as unknown as { season_number?: number | null; episode_number?: number | null } | null;
    references.push({ work_id: row.work_id, season_number: work?.season_number, episode_number: work?.episode_number });
  }
  return { success: true as const, count: countUniqueWorkShareTasks(references), shareCaseCount: actionableCases.length, disputeCount: disputes?.length ?? 0 };
}

export async function refreshAdminShareCaseCredits(caseId: string, force = false) {
  const { admin, db } = await shareAdminContext();
  const { data: shareCase } = await db.from("work_share_cases").select("id,work_id,season_number").eq("id", caseId).eq("org_id", admin.orgId).maybeSingle();
  if (!shareCase) throw new Error("Fordelingssagen findes ikke.");
  const refresh = await refreshWorkCreditEvidence(db, { orgId: admin.orgId, workId: shareCase.work_id, force });
  const credits = await matchWorkCreditsToRightsHolders(db, {
    orgId: admin.orgId,
    credits: await buildReconciledWorkCredits(db, {
      orgId: admin.orgId,
      workId: shareCase.work_id,
      caseId,
      seasonNumber: shareCase.season_number,
    }),
  });
  const { data: participantRows, error: participantError } = await db.from("work_share_participants")
    .select("id,proposed_name,rights_holder_id,role,source_tags,source_details,excluded_at").eq("case_id", caseId);
  if (participantError) throw new Error(participantError.message);
  const now = new Date().toISOString();
  const newlyIneligible = (participantRows ?? []).filter(row => !row.excluded_at && !isEligibleWorkShareRole(row.role));
  if (newlyIneligible.length) {
    const { error: exclusionError } = await db.from("work_share_participants")
      .update({ excluded_at: now, updated_at: now })
      .in("id", newlyIneligible.map(row => row.id))
      .eq("org_id", admin.orgId);
    if (exclusionError) throw new Error(exclusionError.message);
  }
  const excludedRows = (participantRows ?? []).filter(row => row.excluded_at || !isEligibleWorkShareRole(row.role));
  const excludedHolderIds = new Set(excludedRows.map(row => row.rights_holder_id).filter((value): value is string => Boolean(value)));
  const excludedNames = new Set(excludedRows.map(row => normalizeCreditName(row.proposed_name ?? "")).filter(Boolean));
  const participants = (participantRows ?? []).filter(row => !row.excluded_at && isEligibleWorkShareRole(row.role));
  const participantByHolder = new Map(participants.filter(row => row.rights_holder_id).map(row => [row.rights_holder_id, row]));
  const participantByName = new Map(participants.filter(row => row.proposed_name).map(row => [normalizeCreditName(row.proposed_name ?? ""), row]));
  for (const credit of credits) {
    if ((credit.rightsHolderId && excludedHolderIds.has(credit.rightsHolderId)) || excludedNames.has(normalizeCreditName(credit.name))) continue;
    const holderParticipant = credit.rightsHolderId ? participantByHolder.get(credit.rightsHolderId) : null;
    const nameParticipant = participantByName.get(normalizeCreditName(credit.name));
    const matchedParticipant = holderParticipant ?? nameParticipant;
    const matchedEvidence = mergeWorkShareSourceEvidence({
      existingTags: holderParticipant?.source_tags,
      existingDetails: holderParticipant?.source_details,
      incomingTags: nameParticipant?.source_tags,
      incomingDetails: nameParticipant?.source_details,
    });
    const evidence = mergeWorkShareSourceEvidence({
      existingTags: matchedEvidence.sourceTags,
      existingDetails: matchedEvidence.sourceDetails,
      incomingTags: credit.sources,
      incomingDetails: { externalPersonIds: credit.externalPersonIds, roles: credit.roles, matchType: credit.matchType },
    });
    const sourceTags = evidence.sourceTags;
    const details = evidence.sourceDetails;
    if (matchedParticipant) {
      if (holderParticipant && nameParticipant && holderParticipant.id !== nameParticipant.id && !nameParticipant.rights_holder_id) {
        const { error: mergeError } = await db.from("work_share_participants").update({
          source_tags: sourceTags, source_details: details, updated_at: new Date().toISOString(),
        }).eq("id", holderParticipant.id).eq("org_id", admin.orgId);
        if (mergeError) throw new Error(mergeError.message);
        const { error: excludeError } = await db.from("work_share_participants").update({
          excluded_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq("id", nameParticipant.id).eq("org_id", admin.orgId);
        if (excludeError) throw new Error(excludeError.message);
        continue;
      }
      const matchUpdate = matchedParticipant.rights_holder_id || !credit.rightsHolderId || credit.matchType === "conflict"
        ? {}
        : { rights_holder_id: credit.rightsHolderId, relationship_status: "pending" };
      const { error: updateError } = await db.from("work_share_participants").update({
        ...matchUpdate,
        source_tags: sourceTags,
        source_details: details,
        updated_at: new Date().toISOString(),
      }).eq("id", matchedParticipant.id).eq("org_id", admin.orgId);
      if (updateError) throw new Error(updateError.message);
      continue;
    }
    const { data: insertedParticipant, error } = await db.from("work_share_participants").insert({
      case_id: caseId,
      org_id: admin.orgId,
      work_id: shareCase.work_id,
      rights_holder_id: credit.matchType === "conflict" ? null : credit.rightsHolderId,
      proposed_name: credit.name,
      role: normalizeWorkEditorRole(credit.roles[0] ?? "Klipper"),
      relationship_status: credit.rightsHolderId && credit.matchType !== "conflict" ? "pending" : "pending_match",
      source_tags: credit.sources,
      source_details: details,
    }).select("id,proposed_name,rights_holder_id,role,source_tags,source_details,excluded_at").single();
    if (error) throw new Error(error.message);
    if (insertedParticipant.rights_holder_id) {
      participantByHolder.set(insertedParticipant.rights_holder_id, insertedParticipant);
    }
    if (insertedParticipant.proposed_name) {
      participantByName.set(normalizeCreditName(insertedParticipant.proposed_name), insertedParticipant);
    }
  }
  return { success: true as const, refresh, case: await fetchAdminShareCase(db, admin.orgId, caseId) };
}

export async function excludeShareParticipant(participantId: string) {
  const { admin, user, db } = await shareAdminContext();
  const { data, error } = await db.from("work_share_participants").update({
    excluded_at: new Date().toISOString(), excluded_by_user_id: user.id, updated_at: new Date().toISOString(),
  }).eq("id", participantId).eq("org_id", admin.orgId).select("id").maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "Deltageren findes ikke.");
  revalidatePath("/admin/vaerker");
  return { success: true as const };
}

export async function createRightsHolderFromShareParticipant(params: { participantId: string; name: string; email?: string | null; phone?: string | null }) {
  const { admin, db } = await shareAdminContext();
  const name = params.name.trim();
  const email = params.email?.trim() ? normalizeSingleEmail(params.email).toLocaleLowerCase("da-DK") : null;
  if (!name) throw new Error("Navnet skal udfyldes.");
  const { data: participant } = await db.from("work_share_participants").select("id,case_id,work_id,source_details").eq("id", params.participantId).eq("org_id", admin.orgId).maybeSingle();
  if (!participant) throw new Error("Deltageren findes ikke.");
  const normalized = normalizeCreditName(name);
  const details = participant.source_details as { externalPersonIds?: string[] } | null;
  const externalIdentities = (details?.externalPersonIds ?? []).flatMap(externalId => {
    const [source, value] = externalId.includes(":") ? externalId.split(":", 2) : [null, externalId];
    return source === "dfi" || source === "tmdb" ? [{ source, value }] : [];
  });
  const [{ data: nameClaims }, { data: emailMatches }, externalMatchResults] = await Promise.all([
    db.from("rights_holder_name_claims").select("rights_holder_id,display_name").eq("normalized_name", normalized).limit(5),
    email ? db.from("rettighedshavere").select("id,full_name").ilike("email", email).limit(5) : Promise.resolve({ data: [] }),
    Promise.all(externalIdentities.map(identity => db.from("rights_holder_external_identities")
      .select("rights_holder_id,source,external_id")
      .eq("source", identity.source)
      .eq("external_id", identity.value)
      .limit(5))),
  ]);
  const externalMatches = externalMatchResults.flatMap(result => result.data ?? []);
  const duplicateIds = new Set([...(nameClaims ?? []).map(row => row.rights_holder_id), ...(emailMatches ?? []).map(row => row.id), ...externalMatches.map(row => row.rights_holder_id)]);
  if (duplicateIds.size) throw new Error("Der findes allerede en mulig rettighedshaver. Forbind personen med den eksisterende profil i stedet.");
  const { data: defaultProfession } = await db.from("organisation_profession_types").select("profession_type_id").eq("org_id", admin.orgId).order("display_order").limit(1).maybeSingle();
  const { data: holder, error: holderError } = await db.from("rettighedshavere").insert({ full_name: name, email, phone: params.phone?.trim() || null, primary_profession_type_id: defaultProfession?.profession_type_id ?? null }).select("id").single();
  if (holderError || !holder) throw new Error(holderError?.message ?? "Rettighedshaveren kunne ikke oprettes.");
  const { error: affiliationError } = await db.from("org_affiliations").insert({ org_id: admin.orgId, rights_holder_id: holder.id, is_member: false });
  if (affiliationError) { await db.from("rettighedshavere").delete().eq("id", holder.id); throw new Error(affiliationError.message); }
  for (const externalId of details?.externalPersonIds ?? []) {
    const [source, value] = externalId.includes(":") ? externalId.split(":", 2) : [null, externalId];
    if (source === "dfi" || source === "tmdb") await db.from("rights_holder_external_identities").upsert({ rights_holder_id: holder.id, source, external_id: value, display_name: name }, { onConflict: "source,external_id" });
  }
  await matchShareParticipant({ participantId: params.participantId, rightsHolderId: holder.id });
  revalidatePath("/admin/rettighedshavere");
  return { success: true as const, rightsHolderId: holder.id };
}

export async function remindShareParticipant(participantId: string) {
  const { admin, db } = await shareAdminContext();
  const { data: participant } = await db.from("work_share_participants")
    .select("id,case_id,rights_holder_id,last_reminder_sent_at,work_share_cases!inner(org_id)")
    .eq("id", participantId).eq("work_share_cases.org_id", admin.orgId).maybeSingle();
  if (!participant?.rights_holder_id) throw new Error("Deltageren har endnu ingen portalprofil.");
  const lastSent = participant.last_reminder_sent_at ? new Date(participant.last_reminder_sent_at).getTime() : 0;
  if (Date.now() - lastSent < 3 * 24 * 60 * 60 * 1000) throw new Error("Der kan højst sendes én påmindelse pr. person og sag inden for tre dage.");
  const eventKey = `work-share-reminder:${participant.case_id}:${participant.rights_holder_id}:${Math.floor(Date.now() / (3 * 24 * 60 * 60 * 1000))}`;
  const result = await sendMemberNotification({
    eventKey, eventType: "work_share_reminder", orgId: admin.orgId, rightsHolderId: participant.rights_holder_id,
    category: "transactional", subject: "Husk at angive din arbejdsandel", bodyText: "Åbn Mine værker og angiv din procentandel på produktionen.",
    path: `/portal/mine-vaerker?shareTask=${participant.case_id}`, entityType: "work_share_case", entityId: participant.case_id,
  });
  const skipped = "skipped" in result && result.skipped === true;
  const deliveryError = "error" in result && typeof result.error === "string" ? result.error : null;
  if (!result.ok || skipped) {
    if (!result.ok) await db.from("notification_deliveries").delete().eq("org_id", admin.orgId).eq("event_key", eventKey).eq("status", "failed");
    throw new Error(deliveryError ?? "Påmindelsen kunne ikke sendes.");
  }
  const { data: reminderRow } = await db.from("work_share_participants").select("reminder_count").eq("id", participantId).single();
  await db.from("work_share_participants").update({ last_reminder_sent_at: new Date().toISOString(), reminder_count: Number(reminderRow?.reminder_count ?? 0) + 1, updated_at: new Date().toISOString() }).eq("id", participantId);
  return { success: true as const };
}

export async function proposeAdminShareCompromise(
  caseId: string,
  reservePercent: number,
  enteredPercentages: Array<{ participantId: string; percent: number | null }> = [],
) {
  const { admin, db } = await shareAdminContext();
  const { data: shareCase } = await db.from("work_share_cases").select("id").eq("id", caseId).eq("org_id", admin.orgId).maybeSingle();
  if (!shareCase) throw new Error("Fordelingssagen findes ikke.");
  const { data: rows } = await db.from("work_share_participants").select("id,proposed_percent").eq("case_id", caseId).is("excluded_at", null);
  const enteredById = new Map(enteredPercentages.map(row => [row.participantId, row.percent]));
  const participants = (rows ?? []).map(row => {
    if (!enteredById.has(row.id)) return row;
    const entered = enteredById.get(row.id);
    if (entered != null && (!Number.isFinite(entered) || entered < 0 || entered > 100)) {
      throw new Error("Arbejdsandele skal være mellem 0 og 100 procent.");
    }
    return { ...row, proposed_percent: entered };
  });
  return { success: true as const, participants: proposeWorkShareCompromise(participants, reservePercent) };
}

export async function matchShareParticipant(params: { participantId: string; rightsHolderId: string }) {
  const session = await createClient();
  const admin = await assertAdminRole(session, USER_ADMIN_ROLES);
  if (!admin) throw new Error("Mangler adminrettigheder.");
  const db = createServiceClient();
  const { data: participant } = await db.from("work_share_participants").select("id").eq("id", params.participantId).eq("org_id", admin.orgId).maybeSingle();
  if (!participant) throw new Error("Deltageren findes ikke.");
  const { data: affiliation } = await db.from("org_affiliations").select("rights_holder_id")
    .eq("org_id", admin.orgId).eq("rights_holder_id", params.rightsHolderId).maybeSingle();
  if (!affiliation) throw new Error("Rettighedshaveren er ikke tilknyttet organisationen.");
  const { error } = await db.from("work_share_participants").update({ rights_holder_id: params.rightsHolderId, relationship_status: "pending", updated_at: new Date().toISOString() }).eq("id", participant.id);
  if (error) throw new Error(error.message);
  // Matching is deliberately silent. Admin must actively use the invitation
  // or reminder action before any message or e-mail is sent.
  revalidatePath("/admin/vaerker");
  return { success: true as const };
}

export async function resolveAdminShareCase(params: {
  caseId: string;
  reservePercent: number;
  participants: Array<{ participantId: string; finalPercent: number | null }>;
  allowMissingResponses?: boolean;
}) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  const admin = await assertAdminRole(session, USER_ADMIN_ROLES);
  if (!admin || !user) throw new Error("Mangler adminrettigheder.");
  const db = createServiceClient();
  const { data: shareCase } = await db.from("work_share_cases").select("id").eq("id", params.caseId).eq("org_id", admin.orgId).maybeSingle();
  if (!shareCase) throw new Error("Fordelingssagen findes ikke.");
  const { data: participantRows } = await db.from("work_share_participants").select("id").eq("case_id", shareCase.id).is("excluded_at", null);
  const finalById = new Map(params.participants.map(row => [row.participantId, normalizeSharePercent(row.finalPercent)]));
  if (!isCompleteShareResolution((participantRows ?? []).map(row => finalById.get(row.id) ?? null), params.reservePercent)) {
    throw new Error("De endelige andele og reserven skal tilsammen være 100 %. ");
  }
  const { error } = await db.rpc("resolve_work_share_case", {
    p_case_id: params.caseId, p_org_id: admin.orgId, p_actor_user_id: user.id, p_reserve_percent: params.reservePercent,
    p_participants: params.participants, p_allow_missing_responses: params.allowMissingResponses === true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/vaerker");
  revalidatePath("/portal/mine-vaerker");
  return { success: true as const };
}
