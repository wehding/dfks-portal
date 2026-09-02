import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONTRACT_MATCH_VERSION } from "@/lib/contract-import";
import type {
  ContractOwnerBackfillCounts,
  ContractOwnerBackfillDisposition,
  ContractOwnerBackfillRun,
} from "@/lib/contract-owner-backfill-types";

type PreviewContractRow = {
  id: string;
  org_id: string;
  rights_holder_id: string | null;
  work_id: string | null;
  status: string;
  working_title: string | null;
  contract_validations: { extracted_data: Record<string, unknown> | null } | Array<{ extracted_data: Record<string, unknown> | null }> | null;
  contract_owner_verifications: { revision: number } | Array<{ revision: number }> | null;
  contract_episode_confirmations: Array<{ id: string; invalidated_at: string | null }> | null;
};

type PreviewItem = {
  run_id: string;
  contract_id: string;
  org_id: string;
  expected_rights_holder_id: string | null;
  proposed_rights_holder_id: string | null;
  expected_verification_revision: number;
  expected_work_id: string | null;
  source_name_sha256: string;
  match_score: number | null;
  match_signals: string[];
  disposition: ContractOwnerBackfillDisposition;
  selected: boolean;
  status: "previewed" | "unresolved";
  previous_contract_status: string;
};

const EMPTY_COUNTS: ContractOwnerBackfillCounts = {
  total: 0,
  eligible: 0,
  selected: 0,
  sameOwner: 0,
  fillMissingOwner: 0,
  replaceOwner: 0,
  unresolved: 0,
  validatedContractsReopened: 0,
  episodeConfirmationsAtRisk: 0,
  applied: 0,
  stale: 0,
  failed: 0,
  excluded: 0,
};

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function normalizedName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLocaleLowerCase("da-DK") : "";
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function createContractOwnerBackfillPreview(
  db: SupabaseClient,
  caller: { userId: string; orgId: string },
) {
  const activeRun = await db.from("contract_owner_backfill_runs").select("id,status")
    .eq("org_id", caller.orgId)
    .in("status", ["previewing", "preview_ready", "approved", "applying"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (activeRun.error) throw new Error(activeRun.error.message);
  if (activeRun.data) throw new Error("Der findes allerede en aktiv ejerskabskørsel");

  const runResult = await db.from("contract_owner_backfill_runs").insert({
    org_id: caller.orgId,
    created_by: caller.userId,
    match_version: CONTRACT_MATCH_VERSION,
  }).select("id").single();
  if (runResult.error || !runResult.data) throw new Error(runResult.error?.message ?? "Kørslen kunne ikke oprettes");
  const runId = String(runResult.data.id);

  try {
    const contractsResult = await db.from("contracts").select(
      "id,org_id,rights_holder_id,work_id,status,working_title,contract_validations(extracted_data),contract_owner_verifications(revision),contract_episode_confirmations(id,invalidated_at)",
    ).eq("org_id", caller.orgId).order("id");
    if (contractsResult.error) throw new Error(contractsResult.error.message);
    const rows = (contractsResult.data ?? []) as unknown as PreviewContractRow[];
    const sourceRows = rows.map(row => {
      const validation = one(row.contract_validations);
      const verification = one(row.contract_owner_verifications);
      const rawName = validation?.extracted_data?.rightsHolderName;
      const name = normalizedName(rawName);
      return name && verification?.revision ? { row, name, revision: Number(verification.revision) } : null;
    }).filter((value): value is { row: PreviewContractRow; name: string; revision: number } => Boolean(value));
    const workIds = [...new Set(sourceRows.map(({ row }) => row.work_id).filter((id): id is string => Boolean(id)))];
    const today = new Date().toISOString().slice(0, 10);
    const [claimsResult, affiliationsResult, assignmentsResult] = await Promise.all([
      db.from("rights_holder_name_claims").select("normalized_name,rights_holder_id,claim_type"),
      db.from("org_affiliations").select("rights_holder_id").eq("org_id", caller.orgId)
        .or(`valid_from.is.null,valid_from.lte.${today}`).or(`valid_to.is.null,valid_to.gte.${today}`),
      workIds.length
        ? db.from("work_assignments").select("work_id,rights_holder_id").in("work_id", workIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const lookupError = claimsResult.error ?? affiliationsResult.error ?? assignmentsResult.error;
    if (lookupError) throw new Error(lookupError.message);
    const activeHolders = new Set((affiliationsResult.data ?? []).map(row => String(row.rights_holder_id)));
    const claims = new Map((claimsResult.data ?? [])
      .filter(claim => activeHolders.has(String(claim.rights_holder_id)))
      .map(claim => [String(claim.normalized_name), {
        rightsHolderId: String(claim.rights_holder_id),
        claimType: String(claim.claim_type),
      }]));
    const creditedByWork = new Map<string, Set<string>>();
    for (const assignment of assignmentsResult.data ?? []) {
      const workId = String(assignment.work_id);
      const holders = creditedByWork.get(workId) ?? new Set<string>();
      holders.add(String(assignment.rights_holder_id));
      creditedByWork.set(workId, holders);
    }

    const items = sourceRows.map(({ row, name, revision }): PreviewItem => {
      const claim = claims.get(name) ?? null;
      const credited = Boolean(claim && row.work_id && creditedByWork.get(row.work_id)?.has(claim.rightsHolderId));
      const isCanonical = claim?.claimType === "canonical";
      const safe = Boolean(claim && (isCanonical || credited));
      const proposedOwnerId = safe ? claim?.rightsHolderId ?? null : null;
      const score = claim ? Math.min(100, (isCanonical ? 92 : 88) + (credited ? 18 : 0)) : null;
      const signals = [isCanonical ? "exact_primary_name" : claim ? "exact_credit_name" : null, credited ? "credited_on_work" : null]
        .filter((signal): signal is string => Boolean(signal));
      const disposition: ContractOwnerBackfillDisposition = !proposedOwnerId
        ? "unresolved"
        : proposedOwnerId === row.rights_holder_id
          ? "same_owner"
          : row.rights_holder_id
            ? "replace_owner"
            : "fill_missing_owner";
      const selected = disposition !== "unresolved";
      return {
        run_id: runId,
        contract_id: row.id,
        org_id: caller.orgId,
        expected_rights_holder_id: row.rights_holder_id,
        proposed_rights_holder_id: proposedOwnerId,
        expected_verification_revision: revision,
        expected_work_id: row.work_id,
        source_name_sha256: sha256(name),
        match_score: score,
        match_signals: signals,
        disposition,
        selected,
        status: disposition === "unresolved" ? "unresolved" : "previewed",
        previous_contract_status: row.status,
      };
    });

    for (let offset = 0; offset < items.length; offset += 200) {
      const insert = await db.from("contract_owner_backfill_items").insert(items.slice(offset, offset + 200));
      if (insert.error) throw new Error(insert.error.message);
    }

    const changingIds = new Set(items.filter(item => ["fill_missing_owner", "replace_owner"].includes(item.disposition)).map(item => item.contract_id));
    const counts: ContractOwnerBackfillCounts = {
      ...EMPTY_COUNTS,
      total: items.length,
      eligible: items.filter(item => item.disposition !== "unresolved").length,
      selected: items.filter(item => item.selected).length,
      sameOwner: items.filter(item => item.disposition === "same_owner").length,
      fillMissingOwner: items.filter(item => item.disposition === "fill_missing_owner").length,
      replaceOwner: items.filter(item => item.disposition === "replace_owner").length,
      unresolved: items.filter(item => item.disposition === "unresolved").length,
      validatedContractsReopened: sourceRows.filter(({ row }) => changingIds.has(row.id) && row.status === "valideret").length,
      episodeConfirmationsAtRisk: sourceRows.reduce((count, { row }) => count + (
        changingIds.has(row.id) ? (row.contract_episode_confirmations ?? []).filter(item => !item.invalidated_at).length : 0
      ), 0),
    };
    const finalize = await db.rpc("finalize_contract_owner_backfill_preview", {
      p_run_id: runId,
      p_summary_counts: counts,
      p_actor_user_id: caller.userId,
      p_actor_org_id: caller.orgId,
    });
    if (finalize.error) throw new Error(finalize.error.message);
    return runId;
  } catch (error) {
    await db.from("contract_owner_backfill_runs").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", runId).eq("status", "previewing");
    throw error;
  }
}

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export async function getContractOwnerBackfillRun(
  db: SupabaseClient,
  orgId: string,
  runId?: string | null,
): Promise<ContractOwnerBackfillRun | null> {
  let query = db.from("contract_owner_backfill_runs").select("*").eq("org_id", orgId);
  query = runId ? query.eq("id", runId) : query.order("created_at", { ascending: false }).limit(1);
  const runResult = await query.maybeSingle();
  if (runResult.error) throw new Error(runResult.error.message);
  if (!runResult.data) return null;
  const itemResult = await db.from("contract_owner_backfill_items").select(
    "id,contract_id,expected_rights_holder_id,proposed_rights_holder_id,match_score,match_signals,disposition,selected,status,error_code,contracts!inner(working_title)",
  ).eq("run_id", runResult.data.id).order("contract_id");
  if (itemResult.error) throw new Error(itemResult.error.message);
  const holderIds = [...new Set((itemResult.data ?? []).flatMap(item => [item.expected_rights_holder_id, item.proposed_rights_holder_id]).filter(Boolean))];
  const holderResult = holderIds.length
    ? await db.from("rettighedshavere").select("id,full_name").in("id", holderIds)
    : { data: [], error: null };
  if (holderResult.error) throw new Error(holderResult.error.message);
  const names = new Map((holderResult.data ?? []).map(holder => [String(holder.id), String(holder.full_name)]));
  const stored = (runResult.data.summary_counts ?? {}) as Record<string, unknown>;
  const statusCounts = (itemResult.data ?? []).reduce((counts, item) => {
    counts[String(item.status)] = (counts[String(item.status)] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const counts: ContractOwnerBackfillCounts = {
    ...EMPTY_COUNTS,
    total: toNumber(stored.total), eligible: toNumber(stored.eligible), selected: (itemResult.data ?? []).filter(item => item.selected).length,
    sameOwner: toNumber(stored.sameOwner), fillMissingOwner: toNumber(stored.fillMissingOwner), replaceOwner: toNumber(stored.replaceOwner),
    unresolved: toNumber(stored.unresolved), validatedContractsReopened: toNumber(stored.validatedContractsReopened),
    episodeConfirmationsAtRisk: toNumber(stored.episodeConfirmationsAtRisk), applied: statusCounts.applied ?? 0,
    stale: statusCounts.stale ?? 0, failed: statusCounts.failed ?? 0, excluded: statusCounts.excluded ?? 0,
  };
  return {
    id: String(runResult.data.id), orgId: String(runResult.data.org_id), status: runResult.data.status,
    matchVersion: String(runResult.data.match_version), manifestSha256: runResult.data.manifest_sha256,
    revision: Number(runResult.data.revision), createdAt: String(runResult.data.created_at),
    previewedAt: runResult.data.previewed_at, approvedAt: runResult.data.approved_at, completedAt: runResult.data.completed_at,
    counts,
    items: (itemResult.data ?? []).map(item => {
      const contractRelation = Array.isArray(item.contracts) ? item.contracts[0] : item.contracts;
      const currentId = item.expected_rights_holder_id ? String(item.expected_rights_holder_id) : null;
      const proposedId = item.proposed_rights_holder_id ? String(item.proposed_rights_holder_id) : null;
      return {
        id: String(item.id), contractId: String(item.contract_id), workingTitle: contractRelation?.working_title ?? null,
        currentOwner: currentId ? { id: currentId, name: names.get(currentId) ?? "Ukendt profil" } : null,
        proposedOwner: proposedId ? { id: proposedId, name: names.get(proposedId) ?? "Ukendt profil" } : null,
        score: item.match_score === null ? null : Number(item.match_score), signals: item.match_signals ?? [],
        disposition: item.disposition, selected: Boolean(item.selected), status: item.status, errorCode: item.error_code,
      };
    }),
  } as ContractOwnerBackfillRun;
}
