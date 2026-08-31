export type WorkShareQueueTaskType = "all" | "shares" | "disputes" | "unresolved" | "missing_responses";

export type WorkShareQueueReference = {
  kind: "share" | "dispute";
  id: string;
  workId: string;
  title: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  participantCount: number;
  missingResponseCount: number;
  unresolvedCount: number;
  updatedAt: string;
};

export type AdminWorkShareQueueItem = {
  key: string;
  caseId: string | null;
  disputeIds: string[];
  workId: string;
  title: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  participantCount: number;
  missingResponseCount: number;
  unresolvedCount: number;
  hasDispute: boolean;
  reasons: Array<"shares" | "dispute" | "unresolved" | "missing_responses">;
  updatedAt: string;
};

export type WorkShareQueuePage = {
  rows: AdminWorkShareQueueItem[];
  page: number;
  pageSize: number;
  filteredCount: number;
  totalCount: number;
  hasNextPage: boolean;
};

function scopeKey(row: Pick<WorkShareQueueReference, "workId" | "seasonNumber" | "episodeNumber">) {
  return `${row.workId}:${row.seasonNumber ?? "work"}:${row.episodeNumber ?? "scope"}`;
}

export function buildWorkShareQueue(references: WorkShareQueueReference[]) {
  const tasks = new Map<string, AdminWorkShareQueueItem>();
  for (const reference of references) {
    const scope = scopeKey(reference);
    const current = tasks.get(scope) ?? {
      key: `${reference.kind}:${reference.id}`,
      caseId: null,
      disputeIds: [],
      workId: reference.workId,
      title: reference.title,
      seasonNumber: reference.seasonNumber,
      episodeNumber: reference.episodeNumber,
      participantCount: 0,
      missingResponseCount: 0,
      unresolvedCount: 0,
      hasDispute: false,
      reasons: [] as AdminWorkShareQueueItem["reasons"],
      updatedAt: reference.updatedAt,
    };
    if (reference.kind === "share") {
      current.key = `share:${reference.id}`;
      current.caseId = reference.id;
      current.participantCount = reference.participantCount;
      current.missingResponseCount = reference.missingResponseCount;
      current.unresolvedCount = reference.unresolvedCount;
      if (!current.reasons.includes("shares")) current.reasons.push("shares");
      if (reference.missingResponseCount && !current.reasons.includes("missing_responses")) current.reasons.push("missing_responses");
      if (reference.unresolvedCount && !current.reasons.includes("unresolved")) current.reasons.push("unresolved");
    } else {
      current.disputeIds.push(reference.id);
      current.hasDispute = true;
      if (!current.reasons.includes("dispute")) current.reasons.push("dispute");
    }
    if (reference.updatedAt > current.updatedAt) current.updatedAt = reference.updatedAt;
    tasks.set(scope, current);
  }
  return [...tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title, "da"));
}

export function paginateWorkShareQueue(input: {
  references: WorkShareQueueReference[];
  page: number;
  pageSize: number;
  search?: string;
  taskType?: WorkShareQueueTaskType;
}): WorkShareQueuePage {
  const all = buildWorkShareQueue(input.references);
  const search = input.search?.trim().toLocaleLowerCase("da-DK") ?? "";
  const taskType = input.taskType ?? "all";
  const filtered = all.filter(row => {
    if (search && !row.title.toLocaleLowerCase("da-DK").includes(search)) return false;
    if (taskType === "shares" && !row.caseId) return false;
    if (taskType === "disputes" && !row.hasDispute) return false;
    if (taskType === "unresolved" && !row.unresolvedCount) return false;
    if (taskType === "missing_responses" && !row.missingResponseCount) return false;
    return true;
  });
  const pageSize = [20, 50, 100].includes(input.pageSize) ? input.pageSize : 20;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, input.page), totalPages);
  const start = (page - 1) * pageSize;
  return {
    rows: filtered.slice(start, start + pageSize),
    page,
    pageSize,
    filteredCount: filtered.length,
    totalCount: all.length,
    hasNextPage: page < totalPages,
  };
}
