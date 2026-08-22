export const dynamic = "force-dynamic";

import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import MineKontrakterClient from "./MineKontrakterClient";
import type { Contract } from "./MineKontrakterClient";
import { requireMemberContext } from "@/lib/org";
import { createListLoadTimer } from "@/lib/server/list-load-timing";
import { fetchMemberContractsPage, type MemberContractsPageParams } from "@/app/actions/member-contracts";
import { normalizedPage, normalizedPageSize } from "@/lib/list-query";

type WorkRelation = { id: string; title: string; year: number | null; type: string };
type WorkAssignmentRow = { works: WorkRelation | WorkRelation[] | null };
type RawContract = Omit<Contract, "works" | "employers"> & {
  works: Contract["works"] | Contract["works"][];
  employers: Contract["employers"] | Contract["employers"][];
  contract_attachments?: Contract["contract_attachments"] | null;
  contract_comments?: Contract["contract_comments"] | null;
};

function getWorkRelation(row: WorkAssignmentRow) {
  return Array.isArray(row.works) ? row.works[0] ?? null : row.works;
}

function isWorkRelation(work: WorkRelation | null): work is WorkRelation {
  return Boolean(work);
}

function firstRelation<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function stringParam(value: string | string[] | undefined, fallback = "") {
  return Array.isArray(value) ? value[0] ?? fallback : value ?? fallback;
}

export default async function MineKontrakterPage({ searchParams }: { searchParams: PageSearchParams }) {
  const timer = createListLoadTimer("member-contracts");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/")
  timer.mark("auth");

  const db = createServiceClient();
  const memberContext = await requireMemberContext(db, user.id).catch(() => null);
  if (!memberContext?.rightsHolderId) redirect("/admin?notice=member-org-required");
  timer.mark("access");

  const query = await searchParams;
  const pageParams: MemberContractsPageParams = {
    page: normalizedPage(stringParam(query.page)),
    pageSize: normalizedPageSize(stringParam(query.pageSize), 20, 100),
    search: stringParam(query.q),
    status: stringParam(query.status, "all"),
    workType: stringParam(query.type, "all"),
    sortKey: stringParam(query.sort, "date") as MemberContractsPageParams["sortKey"],
    sortDir: stringParam(query.direction, "desc") === "asc" ? "asc" : "desc",
  };
  if (![20, 50, 100].includes(pageParams.pageSize ?? 20)) pageParams.pageSize = 20;

  const [pageResult, myWorksResult] = await Promise.all([
    fetchMemberContractsPage(pageParams),
    db
      .from("work_assignments")
      .select("works(id, title, year, type)")
      .eq("org_id", memberContext.orgId)
      .eq("rights_holder_id", memberContext.rightsHolderId),
  ]);
  timer.mark("lists");

  if (!pageResult.success) throw new Error(pageResult.error);

  const uniqueWorks = Object.values(
    Object.fromEntries(
      ((myWorksResult.data ?? []) as WorkAssignmentRow[])
        .map(getWorkRelation)
        .filter(isWorkRelation)
        .map(w => [w.id, w])
    )
  ) as { id: string; title: string; year: number | null; type: string }[];

  const normalizedContracts: Contract[] = (pageResult.result.rows as unknown as RawContract[]).map(contract => ({
    ...contract,
    works: firstRelation(contract.works),
    employers: firstRelation(contract.employers),
    contract_attachments: [],
    contract_comments: contract.contract_comments ?? [],
    episode_confirmed: contract.episode_confirmed,
  }));
  timer.mark("row-details");
  timer.finish({ rowCount: normalizedContracts.length, workOptionCount: uniqueWorks.length });

  return (
    <Suspense>
      <MineKontrakterClient
        initialContracts={normalizedContracts}
        myWorks={uniqueWorks}
        rightsHolderId={memberContext.rightsHolderId}
        pageResult={{
          page: pageResult.result.page,
          pageSize: pageResult.result.pageSize,
          filteredCount: pageResult.result.filteredCount,
          totalCount: pageResult.result.totalCount,
          hasNextPage: pageResult.result.hasNextPage,
        }}
        initialQuery={{
          search: pageParams.search ?? "",
          status: pageParams.status ?? "all",
          workType: pageParams.workType ?? "all",
          sortKey: pageParams.sortKey ?? "date",
          sortDir: pageParams.sortDir ?? "desc",
        }}
      />
    </Suspense>
  );
}
