"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";

export type AdminMessageThreadKind = "work" | "contract" | "screening";

async function adminContext() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || !(await assertAdminRole(supabase))) throw new Error("Mangler adminrettigheder.");
  const db = createServiceClient();
  const { data: role } = await db.from("user_org_roles").select("org_id").eq("user_id", data.user.id).limit(1).maybeSingle();
  if (!role?.org_id) throw new Error("Organisationen kunne ikke bestemmes.");
  return { db, orgId: role.org_id, userId: data.user.id };
}

async function threadTarget(kind: AdminMessageThreadKind, threadId: string) {
  const { db, orgId, userId } = await adminContext();
  if (kind === "work") {
    const { data } = await db.from("work_change_requests").select("id").eq("id", threadId).eq("org_id", orgId).maybeSingle();
    if (!data) throw new Error("Beskedtråden findes ikke i din organisation.");
    return { db, table: "work_change_request_comments" as const, foreignKey: "request_id", orgId, userId };
  }
  if (kind === "contract") {
    const { data } = await db.from("contracts").select("id").eq("id", threadId).eq("org_id", orgId).maybeSingle();
    if (!data) throw new Error("Beskedtråden findes ikke i din organisation.");
    return { db, table: "contract_comments" as const, foreignKey: "contract_id", orgId, userId };
  }
  const { data } = await db.from("screening_claims").select("id").eq("id", threadId).eq("org_id", orgId).maybeSingle();
  if (!data) throw new Error("Beskedtråden findes ikke i din organisation.");
  return { db, table: "screening_claim_comments" as const, foreignKey: "claim_id", orgId, userId };
}

function revalidateMessages() {
  for (const path of ["/admin/vaerker", "/admin/kontrakter", "/admin/aftalelicens", "/portal/mine-vaerker", "/portal/mine-kontrakter", "/portal/mine-visninger"]) revalidatePath(path);
}

export async function deleteAdminMessage(params: { kind: AdminMessageThreadKind; threadId: string; messageId: string }) {
  const { db, table, foreignKey, orgId, userId } = await threadTarget(params.kind, params.threadId);
  const { data: deleted, error } = await db.from(table).delete().eq("id", params.messageId).eq(foreignKey, params.threadId).select("id");
  if (error) throw new Error(error.message);
  const { error: auditError } = await db.from("admin_message_deletion_audit").insert({ org_id: orgId, admin_user_id: userId, thread_kind: params.kind, thread_id: params.threadId, message_id: params.messageId, action: "delete_message", deleted_count: deleted?.length ?? 0 });
  if (auditError) throw new Error(auditError.message);
  revalidateMessages();
  return { success: true };
}

export async function clearAdminMessageThread(params: { kind: AdminMessageThreadKind; threadId: string }) {
  const { db, table, foreignKey, orgId, userId } = await threadTarget(params.kind, params.threadId);
  const { data: deleted, error } = await db.from(table).delete().eq(foreignKey, params.threadId).select("id");
  if (error) throw new Error(error.message);
  const { error: auditError } = await db.from("admin_message_deletion_audit").insert({ org_id: orgId, admin_user_id: userId, thread_kind: params.kind, thread_id: params.threadId, action: "clear_thread", deleted_count: deleted?.length ?? 0 });
  if (auditError) throw new Error(auditError.message);
  revalidateMessages();
  return { success: true };
}
