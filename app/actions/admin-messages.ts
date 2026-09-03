"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";
import { resolveAdminMessageAuditTargets } from "@/lib/admin-message-audit-targets";

export type AdminMessageThreadKind = "work" | "contract" | "screening";

async function adminContext() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const caller = data.user ? await assertAdminRole(supabase) : null;
  if (!data.user || !caller) throw new Error("Mangler adminrettigheder.");
  const db = createServiceClient();
  return { db, orgId: caller.orgId, userId: data.user.id, role: caller.role };
}

async function threadTarget(kind: AdminMessageThreadKind, threadId: string) {
  const { db, orgId, userId, role } = await adminContext();
  if (kind === "work") {
    const { data } = await db.from("work_change_requests").select("id,requested_by_rights_holder_id").eq("id", threadId).eq("org_id", orgId).maybeSingle();
    if (!data) throw new Error("Beskedtråden findes ikke i din organisation.");
    return { db, table: "work_change_request_comments" as const, foreignKey: "request_id", threadId, orgId, userId, role, targetMemberUuid: data.requested_by_rights_holder_id };
  }
  if (kind === "contract") {
    const { data } = await db.from("contracts").select("id,rights_holder_id").eq("id", threadId).eq("org_id", orgId).maybeSingle();
    if (!data) throw new Error("Beskedtråden findes ikke i din organisation.");
    return { db, table: "contract_comments" as const, foreignKey: "contract_id", threadId, orgId, userId, role, targetMemberUuid: data.rights_holder_id };
  }
  const { data } = await db.from("screening_claims").select("id,profile_id").eq("id", threadId).eq("org_id", orgId).maybeSingle();
  if (!data) throw new Error("Beskedtråden findes ikke i din organisation.");
  const { data: holder } = await db.from("rettighedshavere").select("id").eq("user_id", data.profile_id).maybeSingle();
  return { db, table: "screening_claim_comments" as const, foreignKey: "claim_id", threadId, orgId, userId, role, targetMemberUuid: holder?.id ?? null };
}

function revalidateMessages() {
  for (const path of ["/admin/vaerker", "/admin/kontrakter", "/admin/aftalelicens", "/portal/mine-vaerker", "/portal/mine-kontrakter", "/portal/mine-visninger"]) revalidatePath(path);
}

async function affectedMessages(
  target: Awaited<ReturnType<typeof threadTarget>>,
  messageId?: string,
) {
  let result;
  if (target.table === "contract_comments") {
    let query = target.db
      .from("contract_comments")
      .select("id,member_rights_holder_id")
      .eq("contract_id", target.threadId);
    if (messageId) query = query.eq("id", messageId);
    result = await query;
  } else if (target.table === "work_change_request_comments") {
    let query = target.db
      .from("work_change_request_comments")
      .select("id")
      .eq("request_id", target.threadId);
    if (messageId) query = query.eq("id", messageId);
    result = await query;
  } else {
    let query = target.db
      .from("screening_claim_comments")
      .select("id")
      .eq("claim_id", target.threadId);
    if (messageId) query = query.eq("id", messageId);
    result = await query;
  }
  const { data, error } = result;
  if (error) throw new Error(error.message);

  const rows: Array<{ id: string; member_rights_holder_id?: string | null }> = data ?? [];
  return {
    messageIds: rows.map(row => row.id),
    targetMemberUuids: resolveAdminMessageAuditTargets(rows, target.targetMemberUuid),
  };
}

async function deleteAffectedMessages(
  target: Awaited<ReturnType<typeof threadTarget>>,
  messageIds: string[],
) {
  if (messageIds.length === 0) return [] as Array<{ id: string }>;
  const { data, error } = await target.db
    .from(target.table)
    .delete()
    .eq(target.foreignKey, target.threadId)
    .in("id", messageIds)
    .select("id");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function deleteAdminMessage(params: { kind: AdminMessageThreadKind; threadId: string; messageId: string }) {
  const target = await threadTarget(params.kind, params.threadId);
  const { db, table, orgId, userId, role } = target;
  const affected = await affectedMessages(target, params.messageId);
  const deleted = await deleteAffectedMessages(target, affected.messageIds);
  const { error: auditError } = await db.from("admin_message_deletion_audit").insert({ org_id: orgId, admin_user_id: userId, thread_kind: params.kind, thread_id: params.threadId, message_id: params.messageId, action: "delete_message", deleted_count: deleted?.length ?? 0 });
  if (auditError) throw new Error(auditError.message);
  await recordSensitiveFlow({ actor: { userId, orgId, role, source: "admin" }, action: "delete", component: "admin.messages.delete", entityType: table, entityId: params.messageId, targetMemberUuids: affected.targetMemberUuids, orgIds: [orgId], purposeCode: "case_communication", legalBasis: "GDPR Art. 6(1)(b)/(f) og 9(2)(d)", dataCategories: ["communication_data", "union_membership_data"], counts: { deleted: deleted?.length ?? 0 } });
  revalidateMessages();
  return { success: true };
}

export async function clearAdminMessageThread(params: { kind: AdminMessageThreadKind; threadId: string }) {
  const target = await threadTarget(params.kind, params.threadId);
  const { db, table, orgId, userId, role } = target;
  const affected = await affectedMessages(target);
  const deleted = await deleteAffectedMessages(target, affected.messageIds);
  const { error: auditError } = await db.from("admin_message_deletion_audit").insert({ org_id: orgId, admin_user_id: userId, thread_kind: params.kind, thread_id: params.threadId, action: "clear_thread", deleted_count: deleted?.length ?? 0 });
  if (auditError) throw new Error(auditError.message);
  await recordSensitiveFlow({ actor: { userId, orgId, role, source: "admin" }, action: "delete", component: "admin.messages.clear-thread", entityType: table, entityId: params.threadId, targetMemberUuids: affected.targetMemberUuids, orgIds: [orgId], purposeCode: "case_communication", legalBasis: "GDPR Art. 6(1)(b)/(f) og 9(2)(d)", dataCategories: ["communication_data", "union_membership_data"], counts: { deleted: deleted?.length ?? 0 } });
  revalidateMessages();
  return { success: true };
}
