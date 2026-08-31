"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { matchRightsHolder } from "@/lib/server/contract-import-matching";
import { getContractImportStatesForOrg } from "@/lib/server/contract-import-state";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

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
  await recordSensitiveFlow({
    actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" },
    action: "update", component: "admin.contract_import.owner_matching", entityType: "contract_import",
    targetMemberUuids: matches.map(match => match.rightsHolderId), purposeCode: "contract_import_review",
    legalBasis: "gdpr_art_6_1_f", dataCategories: ["contract_data", "membership_data"],
    outcome: unresolved ? "partial" : "success", counts: { requested: ids.length, matched, unresolved },
  });
  revalidatePath("/admin/kontrakter");
  return { success: true, matched, unresolved, matches };
}

export async function getContractValidationData(contractId: string) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin", "jurist"]);
  if (!caller) return { success: false as const, error: "Ikke autoriseret", data: null };
  const db = createServiceClient();
  const { data: contract } = await db.from("contracts").select("rights_holder_id").eq("id", contractId).eq("org_id", caller.orgId).maybeSingle();
  const { data, error } = await db.from("contract_validations")
    .select("*")
    .eq("contract_id", contractId)
    .maybeSingle();
  if (error) return { success: false as const, error: error.message, data: null };
  await recordSensitiveFlow({
    actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" },
    action: "read", component: "admin.contract_import.validation", entityType: "contract", entityId: contractId,
    targetMemberUuid: contract?.rights_holder_id ?? null, purposeCode: "contract_import_review",
    legalBasis: "gdpr_art_6_1_f", dataCategories: ["contract_data", "ai_analysis"], counts: { found: Boolean(data) },
  });
  return { success: true as const, data };
}

export async function getContractImportStates(contractIds: string[]) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin", "jurist"]);
  if (!caller) return { success: false, error: "Ikke autoriseret", states: {} as Record<string, string>, withAiData: [] as string[], needsManualSalaryReview: [] as string[] };
  const db = createServiceClient();
  return getContractImportStatesForOrg(db, caller.orgId, contractIds);
}
