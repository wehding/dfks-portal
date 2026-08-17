"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { matchRightsHolder } from "@/lib/server/contract-import-matching";

export async function findOwnersForContracts(contractIds: string[]) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return { success: false, error: "Ikke autoriseret", matched: 0, unresolved: 0, matches: [] as Array<{ contractId: string; rightsHolderId: string }> };
  const ids = [...new Set(contractIds)].filter(Boolean).slice(0, 500);
  if (!ids.length) return { success: false, error: "Vælg mindst én kontrakt", matched: 0, unresolved: 0, matches: [] as Array<{ contractId: string; rightsHolderId: string }> };
  const db = createServiceClient({ audit: { actorUserId: caller.userId, actorOrgId: caller.orgId, actorRole: caller.role, source: "admin", correlationId: crypto.randomUUID(), mode: "summary" } });
  const { data, error } = await db.from("contracts")
    .select("id,rights_holder_id,work_id,contract_validations(extracted_data)")
    .eq("org_id", caller.orgId).in("id", ids);
  if (error) return { success: false, error: error.message, matched: 0, unresolved: 0, matches: [] as Array<{ contractId: string; rightsHolderId: string }> };
  let matched = 0;
  let unresolved = 0;
  const matches: Array<{ contractId: string; rightsHolderId: string }> = [];
  for (const contract of data ?? []) {
    if (contract.rights_holder_id) { matched += 1; continue; }
    const validationRelation = contract.contract_validations as unknown;
    const validation = Array.isArray(validationRelation) ? validationRelation[0] : validationRelation as { extracted_data?: Record<string, unknown> | null } | null;
    const extracted = validation?.extracted_data ?? {};
    const result = await matchRightsHolder(db, {
      orgId: caller.orgId,
      name: extracted.rightsHolderName ? String(extracted.rightsHolderName) : null,
      workId: contract.work_id,
    });
    if (!result.id) {
      unresolved += 1;
      await db.from("contract_import_items").update({
        status: "missing_owner", owner_match_score: result.score,
        owner_match_evidence: result.evidence, match_version: result.version,
      }).eq("contract_id", contract.id).eq("org_id", caller.orgId);
      continue;
    }
    const update = await db.from("contracts").update({ rights_holder_id: result.id }).eq("id", contract.id).eq("org_id", caller.orgId);
    if (update.error) { unresolved += 1; continue; }
    matched += 1;
    matches.push({ contractId: contract.id, rightsHolderId: result.id });
    await db.from("contract_import_items").update({
      status: contract.work_id ? "ready_for_review" : "missing_work",
      owner_match_score: result.score, owner_match_evidence: result.evidence, match_version: result.version,
    }).eq("contract_id", contract.id).eq("org_id", caller.orgId);
  }
  revalidatePath("/admin/kontrakter");
  return { success: true, matched, unresolved, matches };
}

export async function getContractImportStates(contractIds: string[]) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin", "jurist"]);
  if (!caller) return { success: false, error: "Ikke autoriseret", states: {} as Record<string, string>, withAiData: [] as string[] };
  const ids = [...new Set(contractIds.filter(Boolean))].slice(0, 500);
  if (!ids.length) return { success: true, states: {} as Record<string, string>, withAiData: [] as string[] };
  const db = createServiceClient();
  const [importRes, validationRes] = await Promise.all([
    db.from("contract_import_items")
      .select("contract_id,status,created_at")
      .eq("org_id", caller.orgId)
      .in("contract_id", ids)
      .order("created_at", { ascending: false }),
    db.from("contract_validations")
      .select("contract_id,extracted_data")
      .in("contract_id", ids),
  ]);
  if (importRes.error) return { success: false, error: "Importstatus kunne ikke hentes", states: {} as Record<string, string>, withAiData: [] as string[] };
  const states: Record<string, string> = {};
  for (const item of importRes.data ?? []) if (item.contract_id && !states[item.contract_id]) states[item.contract_id] = item.status;
  const withAiData = (validationRes.data ?? [])
    .filter(v => v.extracted_data != null && typeof v.extracted_data === "object" && Object.keys(v.extracted_data as object).length > 0)
    .map(v => v.contract_id as string);
  return { success: true, states, withAiData };
}
