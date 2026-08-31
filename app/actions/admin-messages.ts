"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

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
    return { db, table: "work_change_request_comments" as const, foreignKey: "request_id", orgId, userId, role, targetMemberUuid: data.requested_by_rights_holder_id };
  }
  if (kind === "contract") {
    const { data } = await db.from("contracts").select("id,rights_holder_id").eq("id", threadId).eq("org_id", orgId).maybeSingle();
    if (!data) throw new Error("Beskedtråden findes ikke i din organisation.");
    return { db, table: "contract_comments" as const, foreignKey: "contract_id", orgId, userId, role, targetMemberUuid: data.rights_holder_id };
  }
  const { data } = await db.from("screening_claims").select("id,profile_id").eq("id", threadId).eq("org_id", orgId).maybeSingle();
  if (!data) throw new Error("Beskedtråden findes ikke i din organisation.");
  const { data: holder } = await db.from("rettighedshavere").select("id").eq("user_id", data.profile_id).maybeSingle();
  return { db, table: "screening_claim_comments" as const, foreignKey: "claim_id", orgId, userId, role, targetMemberUuid: holder?.id ?? null };
}

function revalidateMessages() {
  for (const path of ["/admin/vaerker", "/admin/kontrakter", "/admin/aftalelicens", "/portal/mine-vaerker", "/portal/mine-kontrakter", "/portal/mine-visninger"]) revalidatePath(path);
}

export async function deleteAdminMessage(params: { kind: AdminMessageThreadKind; threadId: string; messageId: string }) {
  const { db, table, foreignKey, orgId, userId, role, targetMemberUuid } = await threadTarget(params.kind, params.threadId);
  const { data: deleted, error } = await db.from(table).delete().eq("id", params.messageId).eq(foreignKey, params.threadId).select("id");
  if (error) throw new Error(error.message);
  const { error: auditError } = await db.from("admin_message_deletion_audit").insert({ org_id: orgId, admin_user_id: userId, thread_kind: params.kind, thread_id: params.threadId, message_id: params.messageId, action: "delete_message", deleted_count: deleted?.length ?? 0 });
  if (auditError) throw new Error(auditError.message);
  await recordSensitiveFlow({ actor: { userId, orgId, role, source: "admin" }, action: "delete", component: "admin.messages.delete", entityType: table, entityId: params.messageId, targetMemberUuid, orgIds: [orgId], purposeCode: "case_communication", legalBasis: "GDPR Art. 6(1)(b)/(f) og 9(2)(d)", dataCategories: ["communication_data", "union_membership_data"], counts: { deleted: deleted?.length ?? 0 } });
  revalidateMessages();
  return { success: true };
}

export async function clearAdminMessageThread(params: { kind: AdminMessageThreadKind; threadId: string }) {
  const { db, table, foreignKey, orgId, userId, role, targetMemberUuid } = await threadTarget(params.kind, params.threadId);
  const { data: deleted, error } = await db.from(table).delete().eq(foreignKey, params.threadId).select("id");
  if (error) throw new Error(error.message);
  const { error: auditError } = await db.from("admin_message_deletion_audit").insert({ org_id: orgId, admin_user_id: userId, thread_kind: params.kind, thread_id: params.threadId, action: "clear_thread", deleted_count: deleted?.length ?? 0 });
  if (auditError) throw new Error(auditError.message);
  await recordSensitiveFlow({ actor: { userId, orgId, role, source: "admin" }, action: "delete", component: "admin.messages.clear-thread", entityType: table, entityId: params.threadId, targetMemberUuid, orgIds: [orgId], purposeCode: "case_communication", legalBasis: "GDPR Art. 6(1)(b)/(f) og 9(2)(d)", dataCategories: ["communication_data", "union_membership_data"], counts: { deleted: deleted?.length ?? 0 } });
  revalidateMessages();
  return { success: true };
}
