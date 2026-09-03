"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { matchRightsHolder } from "@/lib/server/contract-import-matching";
import { getContractImportStatesForOrg } from "@/lib/server/contract-import-state";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";
import { recordContractOwnerCandidate } from "@/lib/server/contract-owner-verifications";
import { getRequestAppAccessContext } from "@/lib/server/request-app-access-context";

export async function findOwnersForContracts(contractIds: string[]) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return { success: false, error: "Ikke autoriseret", matched: 0, unresolved: 0, skipped: 0, matches: [] as Array<{ contractId: string; rightsHolderId: string }> };
  const access = await getRequestAppAccessContext();
  if (access?.orgId !== caller.orgId || !access.modules?.contract_ownership?.write) {
    return { success: false, error: "Ikke autoriseret", matched: 0, unresolved: 0, skipped: 0, matches: [] as Array<{ contractId: string; rightsHolderId: string }> };
  }
  const ids = [...new Set(contractIds)].filter(Boolean).slice(0, 500);
  if (!ids.length) return { success: false, error: "Vælg mindst én kontrakt", matched: 0, unresolved: 0, skipped: 0, matches: [] as Array<{ contractId: string; rightsHolderId: string }> };
  const db = createServiceClient({ audit: { actorUserId: caller.userId, actorOrgId: caller.orgId, actorRole: caller.role, source: "admin", correlationId: crypto.randomUUID(), mode: "summary" } });
  const { data, error } = await db.from("contracts")
    .select("id,rights_holder_id,work_id")
    .eq("org_id", caller.orgId).in("id", ids);
  if (error) return { success: false, error: error.message, matched: 0, unresolved: 0, skipped: 0, matches: [] as Array<{ contractId: string; rightsHolderId: string }> };
  const aiJobs = await db.from("contract_ai_jobs")
    .select("id,contract_id,result_data,input_storage_path,completed_at")
    .eq("org_id", caller.orgId).in("contract_id", (data ?? []).map(contract => contract.id))
    .eq("status", "done").eq("stage", "complete").is("attachment_id", null).is("superseded_by_job_id", null)
    .order("completed_at", { ascending: false });
  if (aiJobs.error) return { success: false, error: aiJobs.error.message, matched: 0, unresolved: 0, skipped: 0, matches: [] as Array<{ contractId: string; rightsHolderId: string }> };
  const latestJobByContract = new Map<string, typeof aiJobs.data[number]>();
  for (const job of aiJobs.data ?? []) if (!latestJobByContract.has(job.contract_id)) latestJobByContract.set(job.contract_id, job);
  let matched = 0;
  let unresolved = 0;
  let skipped = 0;
  const matches: Array<{ contractId: string; rightsHolderId: string }> = [];
  for (const contract of data ?? []) {
    const job = latestJobByContract.get(contract.id);
    const extracted = job?.result_data && typeof job.result_data === "object"
      ? job.result_data as Record<string, unknown>
      : {};
    if (!job) { unresolved += 1; continue; }
    const result = await matchRightsHolder(db, {
      orgId: caller.orgId,
      name: extracted.rightsHolderName ? String(extracted.rightsHolderName) : null,
      workId: contract.work_id,
    });
    if (!result.id) {
      unresolved += 1;
      // A failed search is not new ownership evidence. In particular, it must
      // not clear a candidate/proposal that was established by an earlier AI
      // job and leave the verification in a contradictory state.
      await db.from("contract_import_items").update({
        status: "missing_owner", owner_match_score: result.score,
        owner_match_evidence: result.evidence, match_version: result.version,
      }).eq("contract_id", contract.id).eq("org_id", caller.orgId);
      continue;
    }
    const documentEvidence = await db.from("contract_document_jobs")
      .select("id,output_storage_path,original_storage_path,original_view_storage_path,spatial_sha256,spatial_schema_version,completed_at,created_at")
      .eq("contract_id", contract.id).eq("org_id", caller.orgId)
      .eq("status", "completed").is("superseded_by_job_id", null)
      .order("completed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(20);
    if (documentEvidence.error) { unresolved += 1; continue; }
    const exactDocumentEvidence = (documentEvidence.data ?? []).find(documentJob => [
      documentJob.output_storage_path,
      documentJob.original_storage_path,
      documentJob.original_view_storage_path,
    ].some(path => path === job.input_storage_path)) ?? null;
    const recorded = await recordContractOwnerCandidate(db, {
      contractId: contract.id,
      orgId: caller.orgId,
      proposedRightsHolderId: result.id,
      evidenceAiJobId: job.id,
      evidenceDocumentJobId: exactDocumentEvidence?.id ?? null,
      matchVersion: result.version,
      matchScore: result.score,
    });
    if (!recorded || recorded.skipped) {
      skipped += 1;
      continue;
    }
    matched += 1;
    matches.push({ contractId: contract.id, rightsHolderId: result.id });
    await db.from("contract_import_items").update({
      status: contract.rights_holder_id ? (contract.work_id ? "ready_for_review" : "missing_work") : "missing_owner",
      owner_match_score: result.score, owner_match_evidence: result.evidence, match_version: result.version,
    }).eq("contract_id", contract.id).eq("org_id", caller.orgId);
  }
  await recordSensitiveFlow({
    actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" },
    action: "update", component: "admin.contract_import.owner_matching", entityType: "contract_import",
    targetMemberUuids: [...new Set([
      ...matches.map(match => match.rightsHolderId),
      ...(data ?? []).map(contract => contract.rights_holder_id).filter((id): id is string => Boolean(id)),
    ])], purposeCode: "contract_import_review",
    orgIds: [caller.orgId],
    legalBasis: "GDPR Art. 6(1)(c)/(f) og Art. 9(2)(d)",
    dataCategories: ["contract_data", "union_membership_data", "ai_analysis"],
    outcome: unresolved || skipped ? "partial" : "success", counts: { requested: ids.length, matched, unresolved, skipped },
  });
  revalidatePath("/admin/kontrakter");
  return { success: true, matched, unresolved, skipped, matches };
}

export async function getContractValidationData(contractId: string) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin", "jurist"]);
  if (!caller) return { success: false as const, error: "Ikke autoriseret", data: null };
  const db = createServiceClient();
  const { data: contract, error: contractError } = await db.from("contracts")
    .select("rights_holder_id")
    .eq("id", contractId)
    .eq("org_id", caller.orgId)
    .maybeSingle();
  if (contractError) return { success: false as const, error: "Kontrakten kunne ikke kontrolleres", data: null };
  if (!contract) return { success: false as const, error: "Kontrakten blev ikke fundet", data: null };
  const { data, error } = await db.from("contract_validations")
    .select("*")
    .eq("contract_id", contractId)
    .eq("org_id", caller.orgId)
    .maybeSingle();
  if (error) return { success: false as const, error: error.message, data: null };
  await recordSensitiveFlow({
    actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" },
    action: "read", component: "admin.contract_import.validation", entityType: "contract", entityId: contractId,
    targetMemberUuid: contract.rights_holder_id ?? null, purposeCode: "contract_import_review",
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
