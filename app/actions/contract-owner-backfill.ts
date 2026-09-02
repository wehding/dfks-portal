"use server";

import { revalidatePath } from "next/cache";
import {
  createContractOwnerBackfillPreview,
  getContractOwnerBackfillRun,
} from "@/lib/server/contract-owner-backfill";
import { getRequestAppAccessContext } from "@/lib/server/request-app-access-context";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/uuid";

async function requireBackfillSuperadmin() {
  const context = await getRequestAppAccessContext();
  if (!context?.canUseAdmin || context.role !== "superadmin" || !context.modules?.contract_ownership?.write) return null;
  return { userId: context.userId, orgId: context.orgId, role: "superadmin" as const };
}

function auditSubjects(run: Awaited<ReturnType<typeof getContractOwnerBackfillRun>>) {
  return [...new Set((run?.items ?? []).flatMap(item => [item.currentOwner?.id, item.proposedOwner?.id]).filter((id): id is string => Boolean(id)))];
}

export async function fetchContractOwnerBackfillRun(runId?: string | null) {
  const caller = await requireBackfillSuperadmin();
  if (!caller) return { success: false as const, error: "Ikke autoriseret", code: "forbidden" as const };
  if (runId && !isUuid(runId)) return { success: false as const, error: "Ugyldig kørsel", code: "invalid_input" as const };
  try {
    const run = await getContractOwnerBackfillRun(createServiceClient(), caller.orgId, runId);
    if (run) {
      await recordSensitiveFlow({
        actor: { ...caller, source: "admin" }, action: "read",
        component: "admin.contract-owner-backfill.status", entityType: "contract_owner_backfill_run",
        entityId: run.id, targetMemberUuids: auditSubjects(run), orgIds: [caller.orgId],
        purposeCode: "contract_owner_data_quality",
        legalBasis: "GDPR Art. 6(1)(c)/(f), Art. 9(2)(d)",
        dataCategories: ["identity_data", "contract_data", "union_membership_data", "ai_analysis"],
        counts: { total: run.counts.total, selected: run.counts.selected, applied: run.counts.applied },
      });
    }
    return { success: true as const, run };
  } catch {
    return { success: false as const, error: "Ejerskabskørslen kunne ikke hentes", code: "read_failed" as const };
  }
}

export async function createContractOwnerBackfillRun() {
  const caller = await requireBackfillSuperadmin();
  if (!caller) return { success: false as const, error: "Kun superadmin kan oprette engangskørslen", code: "forbidden" as const };
  try {
    const db = createServiceClient();
    const runId = await createContractOwnerBackfillPreview(db, caller);
    const run = await getContractOwnerBackfillRun(db, caller.orgId, runId);
    if (!run) throw new Error("Kørslen mangler efter oprettelse");
    // Preview creation is audit-atomic in finalize_contract_owner_backfill_preview.
    revalidatePath("/admin/kontrakter");
    return { success: true as const, run };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Forhåndsvisningen kunne ikke oprettes", code: "create_failed" as const };
  }
}

export async function setContractOwnerBackfillItemSelected(input: {
  runId: string;
  contractId: string;
  selected: boolean;
  expectedRevision: number;
}) {
  const caller = await requireBackfillSuperadmin();
  if (!caller) return { success: false as const, error: "Ikke autoriseret", code: "forbidden" as const };
  if (!input || !isUuid(input.runId) || !isUuid(input.contractId) || typeof input.selected !== "boolean"
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    return { success: false as const, error: "Ugyldigt valg", code: "invalid_input" as const };
  }
  const db = createServiceClient();
  const result = await db.rpc("set_contract_owner_backfill_selection", {
    p_run_id: input.runId, p_contract_id: input.contractId, p_selected: input.selected,
    p_expected_revision: input.expectedRevision, p_actor_user_id: caller.userId, p_actor_org_id: caller.orgId,
  });
  if (result.error) return { success: false as const, error: "Kørslen er ændret. Genindlæs den.", code: "conflict" as const };
  const run = await getContractOwnerBackfillRun(db, caller.orgId, input.runId);
  if (!run) return { success: false as const, error: "Kørslen findes ikke", code: "not_found" as const };
  return { success: true as const, run };
}

export async function approveContractOwnerBackfillRun(input: {
  runId: string;
  expectedManifestSha256: string;
  expectedRevision: number;
}) {
  const caller = await requireBackfillSuperadmin();
  if (!caller) return { success: false as const, error: "Kun superadmin kan godkende engangskørslen", code: "forbidden" as const };
  if (!input || !isUuid(input.runId) || !/^[0-9a-f]{64}$/.test(input.expectedManifestSha256)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    return { success: false as const, error: "Ugyldig godkendelse", code: "invalid_input" as const };
  }
  const db = createServiceClient();
  const result = await db.rpc("approve_contract_owner_backfill_run", {
    p_run_id: input.runId, p_expected_manifest_sha256: input.expectedManifestSha256,
    p_expected_revision: input.expectedRevision, p_actor_user_id: caller.userId, p_actor_org_id: caller.orgId,
  });
  if (result.error) return { success: false as const, error: "Kørslen er ændret og blev ikke godkendt", code: "conflict" as const };
  const run = await getContractOwnerBackfillRun(db, caller.orgId, input.runId);
  if (!run) return { success: false as const, error: "Kørslen findes ikke", code: "not_found" as const };
  // Approval and its complete member subject set are written atomically by the RPC.
  revalidatePath("/admin/kontrakter");
  return { success: true as const, run };
}

export async function processContractOwnerBackfillRun(runId: string) {
  const caller = await requireBackfillSuperadmin();
  if (!caller) return { success: false as const, error: "Kun superadmin kan anvende engangskørslen", code: "forbidden" as const };
  if (!isUuid(runId)) return { success: false as const, error: "Ugyldig kørsel", code: "invalid_input" as const };
  const db = createServiceClient();
  for (let index = 0; index < 20; index += 1) {
    const result = await db.rpc("apply_contract_owner_backfill_item", {
      p_run_id: runId, p_actor_user_id: caller.userId, p_actor_org_id: caller.orgId,
    });
    if (result.error) return { success: false as const, error: "Kørslen stoppede sikkert. Den kan genoptages.", code: "apply_failed" as const };
    const value = (Array.isArray(result.data) ? result.data[0] : result.data) as { empty?: boolean } | null;
    if (value?.empty) break;
  }
  const run = await getContractOwnerBackfillRun(db, caller.orgId, runId);
  if (!run) return { success: false as const, error: "Kørslen findes ikke", code: "not_found" as const };
  revalidatePath("/admin/kontrakter");
  return { success: true as const, run };
}
