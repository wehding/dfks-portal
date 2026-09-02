"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { USER_ADMIN_ROLES } from "@/lib/admin-roles";
import { addCalendarDays, DEFAULT_BETA_INVITE_SUBJECT, DEFAULT_BETA_INVITE_TEXT, todayInCopenhagen } from "@/lib/beta-test";
import { sendMemberNotification } from "@/lib/member-notifications";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

async function betaAdminContext() {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, USER_ADMIN_ROLES);
  if (!caller?.orgId) throw new Error("Du har ikke adgang til organisationens betatestere.");
  return { caller, db: createServiceClient() };
}

export async function getBetaTestAdminSummary() {
  const { caller, db } = await betaAdminContext();
  const [{ data: org, error: orgError }, { count, error: countError }] = await Promise.all([
    db.from("organisations").select("beta_invite_subject,beta_invite_text,beta_default_duration_days").eq("id", caller.orgId).single(),
    db.from("org_affiliations").select("id", { count: "exact", head: true }).eq("org_id", caller.orgId).not("beta_tester_since", "is", null),
  ]);
  if (orgError || countError) throw new Error(orgError?.message ?? countError?.message ?? "Betatestopsætningen kunne ikke hentes.");
  const startDate = todayInCopenhagen();
  const durationDays = Math.min(365, Math.max(1, Number(org?.beta_default_duration_days ?? 10)));
  return {
    count: count ?? 0,
    startDate,
    suggestedEndDate: addCalendarDays(startDate, durationDays),
    durationDays,
    subject: org?.beta_invite_subject ?? DEFAULT_BETA_INVITE_SUBJECT,
    body: org?.beta_invite_text ?? DEFAULT_BETA_INVITE_TEXT,
  };
}

export async function removeBetaTester(rightsHolderId: string) {
  const { caller, db } = await betaAdminContext();
  const { data: affiliation } = await db.from("org_affiliations").select("beta_tester_since").eq("org_id", caller.orgId).eq("rights_holder_id", rightsHolderId).maybeSingle();
  if (!affiliation?.beta_tester_since) return { success: false, error: "Rettighedshaveren er ikke markeret som betatester i organisationen." };
  const { error } = await db.rpc("set_beta_tester_status", { p_org_id: caller.orgId, p_rights_holder_id: rightsHolderId, p_actor_user_id: caller.userId, p_actor_role: caller.role, p_enabled: false, p_period_start: null, p_period_end: null, p_email_delivered: false, p_link_type: null });
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/rettighedshavere");
  return { success: true };
}

export async function createAdminBetaTesterMessage(params: { subject: string; body: string }) {
  const { caller, db } = await betaAdminContext();
  const subject = params.subject.trim().slice(0, 200);
  const body = params.body.trim().slice(0, 10_000);
  if (!subject || !body) return { success: false, error: "Udfyld emne og besked." };

  const { data: affiliations, error } = await db.from("org_affiliations")
    .select("rights_holder_id,rettighedshavere(id,user_id,email)")
    .eq("org_id", caller.orgId).not("beta_tester_since", "is", null).limit(501);
  if (error) return { success: false, error: error.message };
  if ((affiliations?.length ?? 0) > 500) return { success: false, error: "Der kan højst kontaktes 500 betatestere ad gangen." };
  const holders = (affiliations ?? []).flatMap(row => {
    const holder = Array.isArray(row.rettighedshavere) ? row.rettighedshavere[0] : row.rettighedshavere;
    return holder ? [holder] : [];
  });
  const eligible = holders.filter(holder => holder.user_id);
  if (!eligible.length) return { success: false, error: "Ingen betatestere har en aktiv portalbruger." };

  const { data: campaign, error: campaignError } = await db.from("message_campaigns")
    .insert({ org_id: caller.orgId, subject, body, created_by: caller.userId, recipient_count: eligible.length }).select("id").single();
  if (campaignError || !campaign) return { success: false, error: campaignError?.message ?? "Kampagnen kunne ikke oprettes." };

  const deliveries: Array<{ holderId: string; messageId: string; threadId: string }> = [];
  let failed = 0;
  for (const holder of eligible) {
    const { data: thread } = await db.from("member_message_threads").insert({ org_id: caller.orgId, rights_holder_id: holder.id, subject, campaign_id: campaign.id, created_by: caller.userId }).select("id").single();
    if (!thread) { failed += 1; continue; }
    const { data: message } = await db.from("member_messages").insert({ thread_id: thread.id, author_user_id: caller.userId, author_role: "admin", body }).select("id").single();
    if (!message) { failed += 1; await db.from("member_message_threads").delete().eq("id", thread.id); continue; }
    const { error: participantError } = await db.from("member_message_participants").insert([
      { thread_id: thread.id, user_id: caller.userId, last_read_at: new Date().toISOString() },
      { thread_id: thread.id, user_id: holder.user_id, last_read_at: null },
    ]);
    if (participantError) { failed += 1; await db.from("member_message_threads").delete().eq("id", thread.id); continue; }
    deliveries.push({ holderId: holder.id, messageId: message.id, threadId: thread.id });
  }

  let emailSent = 0;
  let emailSkippedOrFailed = 0;
  for (let index = 0; index < deliveries.length; index += 5) {
    const results = await Promise.all(deliveries.slice(index, index + 5).map(delivery => sendMemberNotification({
      eventKey: `beta-program-message:${delivery.messageId}`,
      eventType: "beta_program_message",
      orgId: caller.orgId,
      rightsHolderId: delivery.holderId,
      category: "transactional",
      forceEmail: true,
      subject,
      bodyText: body,
      path: `/portal?thread=${delivery.threadId}`,
      entityType: "message_thread",
      entityId: delivery.threadId,
    }).catch(() => ({ ok: false }))));
    emailSent += results.filter(result => result.ok && !("skipped" in result && result.skipped)).length;
    emailSkippedOrFailed += results.filter(result => !result.ok || ("skipped" in result && result.skipped)).length;
  }

  const outcome = failed || emailSkippedOrFailed ? "partial" : "success";
  await recordSensitiveFlow({
    actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" },
    action: "create", component: "admin.beta-test.group-message", entityType: "message_campaigns", entityId: campaign.id,
    targetMemberUuids: eligible.map(holder => holder.id), orgIds: [caller.orgId], purposeCode: "beta_program_communication",
    legalBasis: "GDPR Art. 6(1)(f), Art. 9(2)(d)", dataCategories: ["communication_data", "union_membership_data"], outcome,
    counts: { recipients: holders.length, portalMessages: deliveries.length, emailSent, skippedWithoutPortalUser: holders.length - eligible.length, failed: failed + emailSkippedOrFailed },
  });
  revalidatePath("/admin/beskeder");
  revalidatePath("/admin/rettighedshavere");
  revalidatePath("/portal");
  return { success: deliveries.length > 0, count: deliveries.length, emailSent, skippedWithoutPortalUser: holders.length - eligible.length, failed: failed + emailSkippedOrFailed };
}
