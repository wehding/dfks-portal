import { headers } from "next/headers";
import ContractReviewPageClient from "./review-page-client";
import type { ContractReviewQueueInitialData } from "./review-queue";
import { getRequestAppAccessContext } from "@/lib/server/request-app-access-context";
import { loadContractReviewList } from "@/lib/server/contract-review-list";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ContractReviewPage({ searchParams }: PageProps) {
  const values = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["queue", "status", "productionType", "search", "page", "limit", "sort", "direction"]) {
    const value = values[key];
    if (typeof value === "string") query.set(key, value);
  }
  const access = await getRequestAppAccessContext();
  const initialData = access?.canUseAdmin && access.role
    ? await loadContractReviewList(
        { userId: access.userId, orgId: access.orgId, role: access.role },
        query,
        new Headers(await headers()),
      ).catch(() => undefined) as ContractReviewQueueInitialData | undefined
    : undefined;
  return <ContractReviewPageClient initialData={initialData} />;
}
