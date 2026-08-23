import "server-only";

import type { createServiceClient } from "@/lib/supabase/service";
import { sendMemberNotification } from "@/lib/member-notifications";
import { normalizeSharePercent, type ShareScope } from "@/lib/work-share-distribution";
import { markCollaborationReviewsCoeditorsReported } from "@/lib/server/work-collaboration-reviews";
import { normalizeWorkEditorRole } from "@/lib/work-editor-roles";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type ShareSuggestion = {
  name: string;
  role: string;
  rightsHolderId?: string | null;
};

type KnownShareParticipantInput = {
  case_id: string;
  org_id: string;
  work_id: string;
  rights_holder_id: string;
  proposed_name?: string | null;
  role: string;
  relationship_status: "pending" | "confirmed";
  invited_by_rights_holder_id?: string | null;
  response_scope?: ShareScope | null;
  proposed_percent?: number | null;
  responded_at?: string | null;
  updated_at: string;
};

export async function saveKnownShareParticipant(db: ServiceClient, input: KnownShareParticipantInput) {
  const { data: existing, error: findError } = await db.from("work_share_participants")
    .select("id")
    .eq("case_id", input.case_id)
    .eq("rights_holder_id", input.rights_holder_id)
    .maybeSingle();
  if (findError) throw new Error(findError.message);
  if (existing) {
    const result = await db.from("work_share_participants").update(input).eq("id", existing.id).select("id").single();
    if (result.error || !result.data) throw new Error(result.error?.message ?? "Medklipperopgaven kunne ikke gemmes.");
    return result.data;
  }
  const inserted = await db.from("work_share_participants").insert(input).select("id").single();
  if (!inserted.error && inserted.data) return inserted.data;
  if (inserted.error?.code === "23505") {
    const { data: concurrent, error: concurrentError } = await db.from("work_share_participants")
      .select("id")
      .eq("case_id", input.case_id)
      .eq("rights_holder_id", input.rights_holder_id)
      .single();
    if (concurrentError || !concurrent) throw new Error(concurrentError?.message ?? "Medklipperopgaven kunne ikke genfindes.");
    const updated = await db.from("work_share_participants").update(input).eq("id", concurrent.id).select("id").single();
    if (updated.error || !updated.data) throw new Error(updated.error?.message ?? "Medklipperopgaven kunne ikke gemmes.");
    return updated.data;
  }
  throw new Error(inserted.error?.message ?? "Medklipperopgaven kunne ikke gemmes.");
}

function nullableScopeQuery<T>(query: T, column: "season_number" | "episode_number", value?: number | null) {
  const scoped = query as T & { eq: (column: string, value: number) => T; is: (column: string, value: null) => T };
  return value ? scoped.eq(column, value) : scoped.is(column, null);
}

export async function ensureWorkShareCase(db: ServiceClient, params: {
  orgId: string;
  workId: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  episodeNumbers?: number[];
  createdByUserId?: string | null;
  scope?: ShareScope;
}) {
  let query = db.from("work_share_cases").select("*").eq("org_id", params.orgId).eq("work_id", params.workId);
  query = nullableScopeQuery(query, "season_number", params.seasonNumber);
  query = nullableScopeQuery(query, "episode_number", params.episodeNumber);
  const { data: existing, error: findError } = await query.maybeSingle();
  if (findError) throw new Error(findError.message);
  if (existing) {
    const incoming = [...new Set((params.episodeNumbers ?? []).filter(number => Number.isInteger(number) && number > 0))];
    if (incoming.length) {
      const merged = [...new Set([...(existing.episode_numbers ?? []), ...incoming])].sort((left, right) => left - right);
      if (JSON.stringify(merged) !== JSON.stringify(existing.episode_numbers ?? [])) {
        const { data: updated, error } = await db.from("work_share_cases").update({ episode_numbers: merged, updated_at: new Date().toISOString() }).eq("id", existing.id).select("*").single();
        if (error || !updated) throw new Error(error?.message ?? "Afsnitsafgrænsningen kunne ikke gemmes.");
        return updated;
      }
    }
    return existing;
  }

  const resolutionScope = params.scope ?? (params.episodeNumber ? "episode" : params.seasonNumber ? "season" : "work");
  const { data, error } = await db.from("work_share_cases").insert({
    org_id: params.orgId,
    work_id: params.workId,
    season_number: params.seasonNumber ?? null,
    episode_number: params.episodeNumber ?? null,
    episode_numbers: [...new Set((params.episodeNumbers ?? []).filter(number => Number.isInteger(number) && number > 0))].sort((left, right) => left - right),
    resolution_scope: resolutionScope,
    status: "awaiting_members",
    created_by_user_id: params.createdByUserId ?? null,
  }).select("*").single();
  if (error || !data) throw new Error(error?.message ?? "Fordelingssagen kunne ikke oprettes.");
  return data;
}

export async function registerShareSuggestions(db: ServiceClient, params: {
  orgId: string;
  workId: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  episodeNumbers?: number[];
  actorUserId: string;
  actorRightsHolderId: string;
  actorRole: string;
  actorPercent: number;
  suggestions: ShareSuggestion[];
}) {
  const actorPercent = normalizeSharePercent(params.actorPercent);
  if (actorPercent === null) throw new Error("Angiv din egen arbejdsandel mellem 0 og 100 procent.");
  const shareCase = await ensureWorkShareCase(db, {
    orgId: params.orgId,
    workId: params.workId,
    seasonNumber: params.seasonNumber,
    episodeNumber: params.episodeNumber,
    episodeNumbers: params.episodeNumbers,
    createdByUserId: params.actorUserId,
  });

  if (shareCase.status === "resolved") {
    await db.from("work_share_cases").update({
      status: "reopened",
      resolved_at: null,
      resolved_by_user_id: null,
      updated_at: new Date().toISOString(),
    }).eq("id", shareCase.id);
  }

  await saveKnownShareParticipant(db, {
    case_id: shareCase.id,
    org_id: params.orgId,
    work_id: params.workId,
    rights_holder_id: params.actorRightsHolderId,
    role: normalizeWorkEditorRole(params.actorRole),
    relationship_status: "confirmed",
    response_scope: shareCase.resolution_scope,
    proposed_percent: actorPercent,
    responded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  for (const suggestion of params.suggestions) {
    const name = suggestion.name.trim();
    if (!name) continue;
    if (suggestion.rightsHolderId) {
      await saveKnownShareParticipant(db, {
        case_id: shareCase.id,
        org_id: params.orgId,
        work_id: params.workId,
        rights_holder_id: suggestion.rightsHolderId,
        proposed_name: name,
        role: normalizeWorkEditorRole(suggestion.role || "Klipper"),
        relationship_status: "pending",
        invited_by_rights_holder_id: params.actorRightsHolderId,
        updated_at: new Date().toISOString(),
      });
      await sendMemberNotification({
        eventKey: `work-share-request:${shareCase.id}:${suggestion.rightsHolderId}`,
        eventType: "work_share_request",
        orgId: params.orgId,
        rightsHolderId: suggestion.rightsHolderId,
        category: "transactional",
        subject: "Angiv din arbejdsandel på et værk",
        bodyText: `${name}, du er blevet angivet som medklipper. Åbn Mine værker og angiv, hvor stor en del af arbejdet du har udført, eller afvis tilknytningen.`,
        path: `/portal/mine-vaerker?shareTask=${shareCase.id}`,
        entityType: "work_share_case",
        entityId: shareCase.id,
      });
    } else {
      const { error } = await db.from("work_share_participants").insert({
        case_id: shareCase.id,
        org_id: params.orgId,
        work_id: params.workId,
        proposed_name: name,
        role: normalizeWorkEditorRole(suggestion.role || "Klipper"),
        relationship_status: "pending_match",
        invited_by_rights_holder_id: params.actorRightsHolderId,
      });
      if (error) throw new Error(error.message);
    }
  }

  const { count: outstanding } = await db.from("work_share_participants")
    .select("id", { count: "exact", head: true })
    .eq("case_id", shareCase.id)
    .in("relationship_status", ["pending", "pending_match"]);
  await db.from("work_share_cases").update({
    status: outstanding ? "awaiting_members" : "awaiting_admin",
    updated_at: new Date().toISOString(),
  }).eq("id", shareCase.id);
  await markCollaborationReviewsCoeditorsReported(db, {
    orgId: params.orgId,
    rightsHolderId: params.actorRightsHolderId,
    actorUserId: params.actorUserId,
    workId: params.workId,
    shareCaseId: shareCase.id,
    seasonNumber: params.seasonNumber,
    episodeNumber: params.episodeNumber,
    episodeNumbers: params.episodeNumbers,
  });
  return shareCase.id as string;
}
