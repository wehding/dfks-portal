import { NextRequest } from "next/server";
import ContractReviewPageClient from "./review-page-client";
import type { ContractReviewQueueInitialData } from "./review-queue";
import { GET as getContractReviews } from "@/app/api/admin/contracts/route";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ContractReviewPage({ searchParams }: PageProps) {
  const values = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["queue", "status", "productionType", "search", "page", "limit", "sort", "direction"]) {
    const value = values[key];
    if (typeof value === "string") query.set(key, value);
  }
  const response = await getContractReviews(new NextRequest(`http://internal/api/admin/contracts?${query}`));
  const initialData = response.ok
    ? await response.json() as ContractReviewQueueInitialData
    : undefined;
  return <ContractReviewPageClient initialData={initialData} />;
}
