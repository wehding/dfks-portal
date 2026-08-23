import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { createListLoadTimer } from "@/lib/server/list-load-timing";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProducerListAccess = { orgId: string; role: string };

export type ProducerListPayload = {
  data: unknown[];
  filteredCount: number;
  totalCount: number;
  summary: Record<string, number>;
  page: number;
  pageSize: number;
  canMerge: boolean;
  canDelete: boolean;
};

export async function loadAdminProducerList(
  access: ProducerListAccess,
  searchParams: URLSearchParams,
): Promise<ProducerListPayload> {
  const timer = createListLoadTimer("admin-producers");
  const query = (searchParams.get("query") ?? "").trim().toLocaleLowerCase("da");
  const status = searchParams.get("status");
  const associationGroup = searchParams.get("associationGroup");
  const producerType = searchParams.get("producerType");
  const rightsHolderId = searchParams.get("rightsHolderId");
  const sort = searchParams.get("sort") ?? "name";
  const direction = searchParams.get("direction") === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1") || 1);
  const requestedPageSize = Number.parseInt(searchParams.get("pageSize") ?? "20") || 20;
  const pageSize = [20, 50, 100].includes(requestedPageSize) ? requestedPageSize : 20;
  const db = createServiceClient();

  const result = await db.rpc("list_admin_producer_summaries", {
    target_org_id: access.orgId,
    search_text: query || null,
    status_filter: status && ["attention", "active", "inactive"].includes(status) ? status : null,
    association_filter: associationGroup && associationGroup !== "all" ? associationGroup : null,
    producer_type_filter: producerType && producerType !== "all" ? producerType : null,
    rights_holder_filter: rightsHolderId && UUID_PATTERN.test(rightsHolderId) ? rightsHolderId : null,
    sort_field: ["name", "parent", "status", "works", "contracts", "latest"].includes(sort) ? sort : "name",
    sort_direction: direction,
    page_number: page,
    page_size: pageSize,
  });
  if (result.error) {
    console.error("[admin-producers] summary list failed", result.error.code);
    throw new Error("Producenter kunne ikke hentes");
  }
  timer.mark("list");
  const payload = (result.data ?? {}) as {
    rows?: unknown[];
    filteredCount?: number;
    totalCount?: number;
    summary?: Record<string, number>;
    page?: number;
    pageSize?: number;
  };
  timer.finish({ route: "/admin/producenter", rows: payload.rows?.length ?? 0 });
  return {
    data: payload.rows ?? [],
    filteredCount: Number(payload.filteredCount ?? 0),
    totalCount: Number(payload.totalCount ?? 0),
    summary: payload.summary ?? {},
    page: Number(payload.page ?? page),
    pageSize: Number(payload.pageSize ?? pageSize),
    canMerge: access.role === "superadmin",
    canDelete: access.role === "superadmin",
  };
}
