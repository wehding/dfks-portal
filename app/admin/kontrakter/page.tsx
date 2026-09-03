import { fetchAdminContractsPage } from "@/app/actions/member-contracts";
import { fetchAdminContractTaskCounts } from "@/app/actions/admin-contract-work-queues";
import ContractArchiveClient from "./ContractArchiveClient";
import type { AdminContractsPageParams } from "@/app/actions/member-contracts";
import { getRequestAppAccessContext } from "@/lib/server/request-app-access-context";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const value = (input: string | string[] | undefined, fallback: string) => Array.isArray(input) ? input[0] ?? fallback : input ?? fallback;

export default async function AdminKontrakterPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const requestedSize = Number(value(query.pageSize, "20"));
  const initialQuery: AdminContractsPageParams = {
    page: Math.max(1, Number(value(query.page, "1")) || 1),
    pageSize: [20, 50, 100].includes(requestedSize) ? requestedSize : 20,
    search: value(query.q, ""),
    status: value(query.status, "all"),
    type: value(query.type, "all"),
    ownership: value(query.ownership, "all") as AdminContractsPageParams["ownership"],
    sortKey: value(query.sort, "status") as AdminContractsPageParams["sortKey"],
    sortDir: value(query.direction, "asc") === "desc" ? "desc" : "asc",
    includeLookups: false,
    includeSummary: true,
  };
  const access = await getRequestAppAccessContext();
  const canManageOwnership = Boolean(
    access?.canUseAdmin
    && access.modules?.contract_ownership?.read,
  );
  const requestedTab = value(query.tab, "arkiv");
  const supportedNonArchiveTab = requestedTab === "valideringskoe"
    || requestedTab === "upload";
  const [initialResult, taskCountsResult] = await Promise.all([
    supportedNonArchiveTab
      ? Promise.resolve(undefined)
      : fetchAdminContractsPage(initialQuery),
    fetchAdminContractTaskCounts(),
  ]);
  const initialTaskCounts = taskCountsResult.success
    ? taskCountsResult.counts
    : { validation: null, ownership: null, messages: null };
  return <ContractArchiveClient
    initialResult={initialResult}
    initialQuery={initialQuery}
    canManageOwnership={canManageOwnership}
    initialTaskCounts={initialTaskCounts}
  />;
}
