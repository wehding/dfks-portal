"use server";

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase query builders change their generic shape after each ordered column. */

import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";
import {
  ADMIN_CONTRACT_QUEUE_KINDS,
  type AdminContractQueueContext,
  type AdminContractQueueItem,
  type CreateAdminContractQueueInput,
} from "@/lib/admin-contract-work-queue";
import {
  ADMIN_CONTRACT_OWNERSHIP_FILTERS,
  applyAdminContractFilters,
  matchingAdminContractIds,
  type AdminContractFilterParams,
} from "@/lib/server/admin-contract-filtering";
import { getRequestAppAccessContext } from "@/lib/server/request-app-access-context";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/uuid";

const MAX_QUEUE_ITEMS = 5000;
const MAX_SELECTED_ITEMS = 1000;

export type AdminContractTaskCounts = {
  validation: number | null;
  ownership: number | null;
  messages: number | null;
};
const VALID_STATUSES = new Set([
  "all", "kladde", "valideret", "arkiveret", "beskeder", "missingWork",
  "validationPending", "validationRecommended", "documentProcessing", "documentReady",
  "documentNeedsReview", "documentFailed",
]);
const VALID_TYPES = new Set(["all", "a-løn", "leverandør"]);
const VALID_SORT_KEYS = new Set(["production", "rightsHolder", "employer", "type", "overenskomst", "period", "status"]);

type QueueCaller = {
  userId: string;
  orgId: string;
  role: string;
  canManageOwnership: boolean;
};

type QueueContractRow = {
  id: string;
  rights_holder_id: string | null;
  working_title: string | null;
  status: string;
  works: { title?: string | null } | Array<{ title?: string | null }> | null;
};

type QueueRow = {
  id: string;
  org_id: string;
  created_by: string;
  kind: string;
  label: string;
  current_position: number;
  expires_at: string;
};

async function requireQueueCaller(requireOwnership = false): Promise<QueueCaller | null> {
  const context = await getRequestAppAccessContext();
  if (!context?.canUseAdmin || !context.role || !context.modules?.contracts?.read) return null;
  const canManageOwnership = Boolean(context.modules.contract_ownership?.write);
  if (requireOwnership && !canManageOwnership) return null;
  return { userId: context.userId, orgId: context.orgId, role: context.role, canManageOwnership };
}

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function normalizeFilters(input: AdminContractFilterParams | undefined): AdminContractFilterParams | null {
  const raw = input ?? {};
  const search = typeof raw.search === "string" ? raw.search.trim().slice(0, 120) : "";
  const status = typeof raw.status === "string" && VALID_STATUSES.has(raw.status) ? raw.status : "all";
  const type = typeof raw.type === "string" && VALID_TYPES.has(raw.type) ? raw.type : "all";
  const ownership = typeof raw.ownership === "string" && (ADMIN_CONTRACT_OWNERSHIP_FILTERS as readonly string[]).includes(raw.ownership)
    ? raw.ownership
    : "all";
  const sortKey = typeof raw.sortKey === "string" && VALID_SORT_KEYS.has(raw.sortKey) ? raw.sortKey : "status";
  const sortDir = raw.sortDir === "desc" ? "desc" : "asc";
  const rightsHolderId = raw.rightsHolderId == null || raw.rightsHolderId === ""
    ? null
    : isUuid(raw.rightsHolderId) ? raw.rightsHolderId : undefined;
  if (rightsHolderId === undefined) return null;
  return { search, status, type, ownership, sortKey, sortDir, rightsHolderId } as AdminContractFilterParams;
}

function queueLabel(kind: CreateAdminContractQueueInput["kind"], count: number) {
  if (kind === "validation") return `Valideringsafklaring · ${count}`;
  if (kind === "ownership") return `Ejerskab skal afklares · ${count}`;
  if (kind === "messages") return `Ulæste beskeder · ${count}`;
  if (kind === "selected") return `Valgte kontrakter · ${count}`;
  return `Aktuel liste · ${count}`;
}

async function existingScopedContractIds(
  db: ReturnType<typeof createServiceClient>,
  orgId: string,
  ids: Set<string> | null,
) {
  if (!ids?.size) return new Set<string>();
  const result = await db.from("contracts").select("id")
    .eq("org_id", orgId)
    .is("superseded_by_contract_id", null)
    .in("id", [...ids]);
  if (result.error) throw new Error(result.error.message);
  return new Set((result.data ?? []).map(row => row.id));
}

async function ownershipTaskIds(db: ReturnType<typeof createServiceClient>, orgId: string) {
  const [missing, review] = await Promise.all([
    matchingAdminContractIds(db, orgId, { ownership: "missing" }),
    matchingAdminContractIds(db, orgId, { ownership: "review" }),
  ]);
  return existingScopedContractIds(db, orgId, new Set([...(missing ?? []), ...(review ?? [])]));
}

function applyQueueOrder(query: any, params: AdminContractFilterParams) {
  const ascending = params.sortDir !== "desc";
  if (params.sortKey === "rightsHolder") return query.order("rights_holder_id", { ascending, nullsFirst: false }).order("id", { ascending: true });
  if (params.sortKey === "employer") return query.order("employer_id", { ascending, nullsFirst: false }).order("id", { ascending: true });
  if (params.sortKey === "type") return query.order("type", { ascending }).order("id", { ascending: true });
  if (params.sortKey === "overenskomst") return query.order("overenskomst", { ascending, nullsFirst: false }).order("id", { ascending: true });
  if (params.sortKey === "status") return query.order("status", { ascending }).order("created_at", { ascending: false }).order("id", { ascending: true });
  if (params.sortKey === "period") return query.order("start_date", { ascending, nullsFirst: false }).order("contract_date", { ascending, nullsFirst: false }).order("id", { ascending: true });
  return query.order("created_at", { ascending: false }).order("id", { ascending: true });
}

async function resolveQueueContracts(
  db: ReturnType<typeof createServiceClient>,
  caller: QueueCaller,
  input: CreateAdminContractQueueInput,
  filters: AdminContractFilterParams,
) {
  let matchedIds: Set<string> | null;
  if (input.kind === "selected") {
    const selected = [...new Set(input.selectedContractIds ?? [])];
    if (!selected.length || selected.length > MAX_SELECTED_ITEMS || selected.some(id => !isUuid(id))) {
      throw new Error(`Vælg mellem 1 og ${MAX_SELECTED_ITEMS} kontrakter`);
    }
    matchedIds = new Set(selected);
  } else {
    const queueFilters: AdminContractFilterParams = input.kind === "validation"
      ? {
          ...filters,
          search: "",
          status: "validationPending",
          type: "all",
          ownership: "all",
          rightsHolderId: null,
        }
      : input.kind === "ownership"
        ? {
            ...filters,
            search: "",
            status: "all",
            type: "all",
            ownership: "review",
            rightsHolderId: null,
          }
        : input.kind === "messages"
          ? {
              ...filters,
              search: "",
              status: "beskeder",
              type: "all",
              ownership: "all",
              rightsHolderId: null,
            }
        : filters;
    matchedIds = input.kind === "ownership"
      ? await ownershipTaskIds(db, caller.orgId)
      : await matchingAdminContractIds(db, caller.orgId, queueFilters);
    filters = queueFilters;
  }

  if (matchedIds?.size === 0) return [];
  let query = db.from("contracts")
    .select("id,rights_holder_id,working_title,status,created_at,employer_id,type,overenskomst,start_date,contract_date,works(title)")
    .eq("org_id", caller.orgId)
    .is("superseded_by_contract_id", null);
  if (input.kind === "selected") query = query.in("id", [...matchedIds!]);
  else query = applyAdminContractFilters(query, filters, matchedIds);
  const result = await applyQueueOrder(query, filters).limit(MAX_QUEUE_ITEMS);
  if (result.error) throw new Error(result.error.message);
  let rows = (result.data ?? []) as QueueContractRow[];

  if (input.kind === "ownership" && rows.length) {
    const verificationResult = await db.from("contract_owner_verifications")
      .select("contract_id,proposed_rights_holder_id")
      .eq("org_id", caller.orgId)
      .in("contract_id", rows.map(row => row.id));
    if (verificationResult.error) throw new Error(verificationResult.error.message);
    const hasProposal = new Set((verificationResult.data ?? [])
      .filter(row => Boolean(row.proposed_rights_holder_id))
      .map(row => row.contract_id));
    rows = rows.map((row, index) => ({ row, index }))
      .sort((left, right) => Number(hasProposal.has(right.row.id)) - Number(hasProposal.has(left.row.id)) || left.index - right.index)
      .map(item => item.row);
  }
  return rows;
}

export async function fetchAdminContractTaskCounts() {
  const caller = await requireQueueCaller(false);
  if (!caller) return { success: false as const, error: "Ikke autoriseret" };
  const db = createServiceClient();
  const countFiltered = async (status: "validationPending" | "beskeder") => {
    const raw = await matchingAdminContractIds(db, caller.orgId, { status });
    return (await existingScopedContractIds(db, caller.orgId, raw)).size;
  };
  const results = await Promise.allSettled([
    countFiltered("validationPending"),
    caller.canManageOwnership ? ownershipTaskIds(db, caller.orgId).then(ids => ids.size) : Promise.resolve(0),
    countFiltered("beskeder"),
  ]);
  (["validation", "ownership", "messages"] as const).forEach((task, index) => {
    if (results[index]?.status === "rejected") {
      console.error("[admin-contract-tasks] count unavailable", { task });
    }
  });
  const countAt = (index: number) => results[index]?.status === "fulfilled"
    ? results[index].value
    : null;
  return {
    success: true as const,
    counts: {
      validation: countAt(0),
      ownership: countAt(1),
      messages: countAt(2),
    } satisfies AdminContractTaskCounts,
  };
}

async function deleteQueue(db: ReturnType<typeof createServiceClient>, queueId: string) {
  await db.from("admin_contract_work_queues").delete().eq("id", queueId);
}

export async function createAdminContractWorkQueue(input: CreateAdminContractQueueInput) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !(ADMIN_CONTRACT_QUEUE_KINDS as readonly string[]).includes(input.kind)) {
    return { success: false as const, error: "Ugyldig kø" };
  }
  const caller = await requireQueueCaller(input.kind === "ownership");
  if (!caller) return { success: false as const, error: "Ikke autoriseret" };
  const filters = normalizeFilters(input.filters);
  if (!filters) return { success: false as const, error: "Ugyldige filtre" };
  const db = createServiceClient();
  let queueId: string | null = null;
  try {
    await db.from("admin_contract_work_queues").delete().eq("created_by", caller.userId).lt("expires_at", new Date().toISOString());
    const rows = await resolveQueueContracts(db, caller, input, filters);
    if (!rows.length) return { success: false as const, error: "Ingen kontrakter matcher køen" };
    const queueResult = await db.from("admin_contract_work_queues").insert({
      org_id: caller.orgId,
      created_by: caller.userId,
      kind: input.kind,
      label: queueLabel(input.kind, rows.length),
      filter_context: {
        status: filters.status ?? "all",
        type: filters.type ?? "all",
        ownership: filters.ownership ?? "all",
        sortKey: filters.sortKey ?? "status",
        sortDir: filters.sortDir ?? "asc",
        hasSearch: Boolean(filters.search),
        rightsHolderScoped: Boolean(filters.rightsHolderId),
      },
    }).select("id").single();
    if (queueResult.error || !queueResult.data?.id) throw new Error(queueResult.error?.message ?? "Køen kunne ikke oprettes");
    queueId = queueResult.data.id;
    for (let offset = 0; offset < rows.length; offset += 250) {
      const items = rows.slice(offset, offset + 250).map((row, index) => ({
        queue_id: queueId,
        position: offset + index + 1,
        contract_id: row.id,
      }));
      const itemResult = await db.from("admin_contract_work_queue_items").insert(items);
      if (itemResult.error) throw new Error(itemResult.error.message);
    }
    const contractIds = rows.map(row => row.id);
    const ownershipResult = await db.from("contract_owner_verifications")
      .select("assigned_rights_holder_id,proposed_rights_holder_id")
      .eq("org_id", caller.orgId)
      .in("contract_id", contractIds);
    if (ownershipResult.error) throw new Error(ownershipResult.error.message);
    const targets = [...new Set([
      ...rows.map(row => row.rights_holder_id),
      ...(ownershipResult.data ?? []).flatMap(row => [row.assigned_rights_holder_id, row.proposed_rights_holder_id]),
    ].filter((id): id is string => Boolean(id)))];
    await recordSensitiveFlow({
      actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" },
      action: "read",
      component: "admin.contracts.work_queue",
      entityType: "admin_contract_work_queue",
      entityId: queueId,
      targetMemberUuids: targets,
      orgIds: [caller.orgId],
      purposeCode: "contract_case_management",
      legalBasis: "GDPR Art. 6(1)(c)/(f) og Art. 9(2)(d)",
      dataCategories: ["contract_data", "union_membership_data"],
      counts: { contractCount: rows.length, memberCount: targets.length },
    });
    return { success: true as const, queueId, firstContractId: rows[0]!.id, total: rows.length };
  } catch (error) {
    if (queueId) await deleteQueue(db, queueId);
    return { success: false as const, error: error instanceof Error ? error.message : "Køen kunne ikke oprettes" };
  }
}

async function loadOwnedQueue(db: ReturnType<typeof createServiceClient>, caller: QueueCaller, queueId: string) {
  if (!isUuid(queueId)) return null;
  const result = await db.from("admin_contract_work_queues").select("*")
    .eq("id", queueId).eq("org_id", caller.orgId).eq("created_by", caller.userId).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (result.error || !result.data) return null;
  const queue = result.data as QueueRow;
  if (queue.kind === "ownership" && !caller.canManageOwnership) return null;
  return queue;
}

export async function fetchAdminContractWorkQueue(queueId: string, currentContractId: string) {
  const caller = await requireQueueCaller(false);
  if (!caller || !isUuid(currentContractId)) return { success: false as const, error: "Ikke autoriseret" };
  const db = createServiceClient();
  const queue = await loadOwnedQueue(db, caller, queueId);
  if (!queue) return { success: false as const, error: "Køen er udløbet eller utilgængelig" };
  const itemResult = await db.from("admin_contract_work_queue_items")
    .select("position,contract_id,status")
    .eq("queue_id", queue.id)
    .order("position", { ascending: true });
  if (itemResult.error) return { success: false as const, error: "Køen kunne ikke hentes" };
  const rawItems = itemResult.data ?? [];
  const currentIndex = rawItems.findIndex(item => item.contract_id === currentContractId);
  if (currentIndex < 0) return { success: false as const, error: "Kontrakten findes ikke i køen" };
  const contractIds = rawItems.map(item => item.contract_id);
  const [contractsResult, ownershipResult] = await Promise.all([
    db.from("contracts").select("id,working_title,status,rights_holder_id,works(title)").eq("org_id", caller.orgId).in("id", contractIds),
    db.from("contract_owner_verifications")
      .select("contract_id,status,proposed_rights_holder_id,proposed_rights_holder:rettighedshavere!contract_owner_verifications_proposed_rights_holder_id_fkey(full_name)")
      .eq("org_id", caller.orgId).in("contract_id", contractIds),
  ]);
  const readError = contractsResult.error ?? ownershipResult.error;
  if (readError) return { success: false as const, error: "Køen kunne ikke hentes" };
  const contractById = new Map((contractsResult.data ?? []).map(row => [row.id, row]));
  const ownerByContract = new Map((ownershipResult.data ?? []).map(row => [row.contract_id, row]));
  const items: AdminContractQueueItem[] = rawItems.flatMap(item => {
    const contract = contractById.get(item.contract_id);
    if (!contract) return [];
    const ownership = ownerByContract.get(item.contract_id);
    const work = one(contract.works);
    const proposed = one(ownership?.proposed_rights_holder);
    return [{
      contractId: item.contract_id,
      position: item.position,
      status: item.status as AdminContractQueueItem["status"],
      title: work?.title ?? contract.working_title ?? "Kontrakt",
      contractStatus: contract.status,
      rightsHolderId: contract.rights_holder_id ?? null,
      ownershipStatus: ownership?.status ?? null,
      proposedRightsHolderId: ownership?.proposed_rights_holder_id ?? null,
      proposedRightsHolderName: proposed?.full_name ?? null,
    }];
  });
  const currentPosition = rawItems[currentIndex]!.position;
  await db.from("admin_contract_work_queues").update({ current_position: currentPosition, updated_at: new Date().toISOString() }).eq("id", queue.id);
  const context: AdminContractQueueContext = {
    id: queue.id,
    kind: queue.kind as AdminContractQueueContext["kind"],
    label: queue.label,
    position: currentPosition,
    total: rawItems.length,
    previousContractId: rawItems[currentIndex - 1]?.contract_id ?? null,
    nextContractId: rawItems[currentIndex + 1]?.contract_id ?? null,
    items,
    expiresAt: queue.expires_at,
  };
  return { success: true as const, data: context };
}

export async function markAdminContractQueueItem(
  queueId: string,
  contractId: string,
  status: "completed" | "skipped" = "completed",
) {
  const caller = await requireQueueCaller(false);
  if (!caller || !isUuid(contractId) || !["completed", "skipped"].includes(status)) {
    return { success: false as const, error: "Ikke autoriseret" };
  }
  const db = createServiceClient();
  const queue = await loadOwnedQueue(db, caller, queueId);
  if (!queue) return { success: false as const, error: "Køen er udløbet eller utilgængelig" };
  const result = await db.from("admin_contract_work_queue_items")
    .update({ status, completed_at: new Date().toISOString() })
    .eq("queue_id", queue.id).eq("contract_id", contractId)
    .select("position").maybeSingle();
  if (result.error || !result.data) return { success: false as const, error: "Køelementet kunne ikke opdateres" };
  return { success: true as const };
}
