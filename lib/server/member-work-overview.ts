import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";
import type { MemberOverviewItem } from "@/lib/member-work-overview";

export type MemberWorkOverviewParams = {
  page?: number;
  pageSize?: number;
  search?: string;
  workType?: string;
  status?: string;
  sortKey?: string;
  sortDir?: "asc" | "desc";
};

type MemberWorkOverviewContext = {
  orgId: string;
  rightsHolderId: string;
  userId: string;
};

type OverviewRow = {
  item: MemberOverviewItem | null;
  filtered_count: number | string;
  total_count: number | string;
  legacy_required_work_ids: string[] | null;
  legacy_declared_work_ids: string[] | null;
  legacy_task_count: number | string;
};

export async function loadMemberWorkOverview(
  context: MemberWorkOverviewContext,
  params: MemberWorkOverviewParams,
) {
  const db = createServiceClient();
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = [20, 50, 100].includes(params.pageSize ?? 20) ? params.pageSize ?? 20 : 20;
  const { data, error } = await db.rpc("list_member_work_overview_page", {
    p_org_id: context.orgId,
    p_rights_holder_id: context.rightsHolderId,
    p_search: params.search?.trim() ?? "",
    p_work_type: params.workType ?? "all",
    p_status: params.status ?? "all",
    p_sort: params.sortKey ?? "date",
    p_direction: params.sortDir ?? "desc",
    p_page: page,
    p_page_size: pageSize,
  });
  if (error) return { success: false as const, error: error.message, items: [] as MemberOverviewItem[] };

  const rows = (data ?? []) as unknown as OverviewRow[];
  const summary = rows[0];
  const items = rows.flatMap(row => row.item ? [row.item] : []);
  const filteredCount = Number(summary?.filtered_count ?? 0);
  const totalCount = Number(summary?.total_count ?? 0);

  await recordSensitiveFlow({
    actor: { userId: context.userId, orgId: context.orgId, role: "member", source: "portal" },
    action: params.search?.trim() ? "search" : "read",
    component: "portal.member_work_overview",
    entityType: "work_assignment",
    targetMemberUuid: context.rightsHolderId,
    purposeCode: "member_work_management",
    legalBasis: "gdpr_art_6_1_b",
    dataCategories: ["work_data", "rights_data"],
    counts: { results: items.length, filtered: filteredCount, page, pageSize },
  });

  return {
    success: true as const,
    items,
    page,
    pageSize,
    filteredCount,
    totalCount,
    hasNextPage: (page - 1) * pageSize + items.length < filteredCount,
    legacyRequiredWorkIds: summary?.legacy_required_work_ids ?? [],
    legacyDeclaredWorkIds: summary?.legacy_declared_work_ids ?? [],
    legacyDeclarationTaskCount: Number(summary?.legacy_task_count ?? 0),
  };
}
