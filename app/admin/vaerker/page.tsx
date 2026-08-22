import { fetchAdminWorksPage } from "@/app/actions/work-management";
import WorkArchiveClient from "./WorkArchiveClient";
import type { AdminWorksPageParams } from "@/app/actions/work-management";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const value = (input: string | string[] | undefined, fallback: string) => Array.isArray(input) ? input[0] ?? fallback : input ?? fallback;

export default async function VaerksadministrationPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const requestedSize = Number(value(query.pageSize, "20"));
  const initialQuery: AdminWorksPageParams = {
    page: Math.max(1, Number(value(query.page, "1")) || 1),
    pageSize: [20, 50, 100].includes(requestedSize) ? requestedSize : 20,
    search: value(query.q, ""),
    status: value(query.status, "all"),
    type: value(query.type, "all"),
    connection: value(query.connection, "all"),
    missingConnection: value(query.missingConnection, "none"),
    sortKey: value(query.sort, "status") as AdminWorksPageParams["sortKey"],
    sortDir: value(query.direction, "asc") === "desc" ? "desc" : "asc",
    includeLookups: false,
    includeSummary: true,
  };
  const initialResult = await fetchAdminWorksPage(initialQuery);
  return <WorkArchiveClient initialResult={initialResult} initialQuery={initialQuery} />;
}
