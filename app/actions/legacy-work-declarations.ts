"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getRequestAppAccessContext } from "@/lib/server/request-app-access-context";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import type { LegacyDeclarationTask } from "@/lib/work-documentation";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

const ADMIN_ORG_ROLES = ["superadmin", "admin", "org-admin"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toTask(row: Record<string, unknown>): LegacyDeclarationTask {
  return {
    rootWorkId: String(row.root_work_id),
    title: String(row.title ?? "Ukendt værk"),
    role: String(row.role ?? "Klipper"),
    premiereYear: row.premiere_year == null ? null : Number(row.premiere_year),
    productionYear: row.production_year == null ? null : Number(row.production_year),
    qualifyingScopeCount: Number(row.qualifying_scope_count ?? 1),
    qualifyingScopeIds: Array.isArray(row.qualifying_scope_ids) ? row.qualifying_scope_ids.map(String) : [],
  };
}

export async function fetchLegacyDeclarationTasks() {
  const context = await getRequestAppAccessContext();
  if (!context?.rightsHolderId) throw new Error("Du skal være logget ind som rettighedshaver.");
  const db = createServiceClient();
  const [{ data: rows, error }, { data: organisation }, { data: affiliation }] = await Promise.all([
    db.rpc("list_member_legacy_declaration_tasks", {
      p_org_id: context.orgId,
      p_rights_holder_id: context.rightsHolderId,
    }),
    db.from("organisations")
      .select("name,legacy_contract_declaration_enabled,legacy_contract_cutoff_year")
      .eq("id", context.orgId)
      .single(),
    db.from("org_affiliations")
      .select("is_member")
      .eq("org_id", context.orgId)
      .eq("rights_holder_id", context.rightsHolderId)
      .single(),
  ]);
  if (error) throw new Error(error.message);
  const audience = affiliation?.is_member ? "member" : "non_member";
  const { data: document, error: documentError } = await db.from("legal_document_versions")
    .select("id,title,body,version,content_hash,published_at")
    .eq("org_id", context.orgId)
    .eq("document_type", "legacy_work_declaration")
    .eq("audience", audience)
    .eq("status", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (documentError) throw new Error(documentError.message);
  const tasks = ((rows ?? []) as Array<Record<string, unknown>>).map(toTask);
  await recordSensitiveFlow({
    actor: { userId: context.userId, orgId: context.orgId, role: "member", source: "portal" },
    action: "read",
    component: "portal.legacy_work_declaration.tasks",
    entityType: "legacy_work_declaration_task",
    targetMemberUuid: context.rightsHolderId,
    purposeCode: "legacy_work_documentation",
    legalBasis: "member_declaration",
    dataCategories: ["work_data", "rights_data"],
    counts: { results: tasks.length },
  });
  return {
    tasks,
    enabled: Boolean(organisation?.legacy_contract_declaration_enabled),
    cutoffYear: organisation?.legacy_contract_cutoff_year == null ? null : Number(organisation.legacy_contract_cutoff_year),
    organisationName: organisation?.name ?? "Organisationen",
    document,
  };
}

export async function acceptLegacyDeclarations(rootWorkIds: string[]) {
  const context = await getRequestAppAccessContext();
  if (!context?.rightsHolderId) throw new Error("Du skal være logget ind som rettighedshaver.");
  const selected = [...new Set(rootWorkIds.filter(value => UUID_PATTERN.test(value)))];
  if (!selected.length || selected.length > 500) throw new Error("Vælg mindst én titel.");
  const db = createServiceClient();
  const { data, error } = await db.rpc("accept_member_legacy_declarations", {
    p_org_id: context.orgId,
    p_rights_holder_id: context.rightsHolderId,
    p_actor_user_id: context.userId,
    p_root_work_ids: selected,
    p_batch_id: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/portal");
  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/admin/vaerker");
  return { success: true as const, acceptedCount: Number(data ?? 0) };
}

export async function disputeLegacyDeclarationTask(rootWorkId: string) {
  const context = await getRequestAppAccessContext();
  if (!context?.rightsHolderId || !UUID_PATTERN.test(rootWorkId)) throw new Error("Værket kunne ikke findes.");
  const db = createServiceClient();
  const { error } = await db.rpc("reject_member_legacy_declaration_task", {
    p_org_id: context.orgId,
    p_rights_holder_id: context.rightsHolderId,
    p_actor_user_id: context.userId,
    p_root_work_id: rootWorkId,
    p_correlation_id: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/portal");
  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/admin/vaerker");
  return { success: true as const };
}

export async function invalidateLegacyDeclaration(input: { declarationId: string; reason: string }) {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES);
  const { data: { user } } = await supabase.auth.getUser();
  if (!caller?.orgId || !user || !UUID_PATTERN.test(input.declarationId)) throw new Error("Ingen adgang.");
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 1000) throw new Error("Angiv en kort begrundelse.");
  const db = createServiceClient();
  const { error } = await db.rpc("invalidate_legacy_work_declaration", {
    p_org_id: caller.orgId,
    p_declaration_id: input.declarationId,
    p_actor_user_id: user.id,
    p_reason: reason,
    p_correlation_id: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/vaerker");
  revalidatePath("/portal");
  revalidatePath("/portal/mine-vaerker");
  return { success: true as const };
}

export async function fetchAdminLegacyDeclarationsForWork(workId: string) {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES);
  const { data: { user } } = await supabase.auth.getUser();
  if (!caller?.orgId || !user || !UUID_PATTERN.test(workId)) throw new Error("Ingen adgang.");
  const db = createServiceClient();
  const { data: work, error: workError } = await db.from("works")
    .select("id,parent_work_id")
    .eq("org_id", caller.orgId)
    .eq("id", workId)
    .maybeSingle();
  if (workError) throw new Error(workError.message);
  if (!work) throw new Error("Værket kunne ikke findes.");
  const rootWorkId = work.parent_work_id ?? work.id;
  const { data, error } = await db.from("legacy_work_declarations")
    .select("id,rights_holder_id,document_version,accepted_at,invalidated_at,invalidation_reason,rettighedshavere(full_name)")
    .eq("org_id", caller.orgId)
    .eq("root_work_id", rootWorkId)
    .order("accepted_at", { ascending: false });
  if (error) throw new Error(error.message);
  const memberIds = [...new Set((data ?? []).map(row => row.rights_holder_id).filter(Boolean))];
  await recordSensitiveFlow({
    actor: { userId: user.id, orgId: caller.orgId, role: caller.role, source: "admin" },
    action: "read",
    component: "admin.legacy_work_declaration.detail",
    entityType: "legacy_work_declaration",
    entityId: rootWorkId,
    targetMemberUuids: memberIds,
    purposeCode: "legacy_work_documentation",
    legalBasis: "administrative_review",
    dataCategories: ["work_data", "rights_data"],
    counts: { results: data?.length ?? 0 },
  });
  return (data ?? []).map(row => {
    const relation = row.rettighedshavere as unknown as { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
    return {
      id: row.id,
      rightsHolderId: row.rights_holder_id,
      rightsHolderName: Array.isArray(relation) ? relation[0]?.full_name ?? "Ukendt" : relation?.full_name ?? "Ukendt",
      documentVersion: row.document_version,
      acceptedAt: row.accepted_at,
      invalidatedAt: row.invalidated_at,
      invalidationReason: row.invalidation_reason,
    };
  });
}
