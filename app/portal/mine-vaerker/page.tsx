export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createServiceClient } from "@/lib/supabase/service";
import MineVaerkerClient from "./MineVaerkerClient";
import type { Assignment, BroadcasterLogo } from "./MineVaerkerClient";
import type { Contract } from "../mine-kontrakter/MineKontrakterClient";
import { createListLoadTimer } from "@/lib/server/list-load-timing";
import { memberOverviewItemsToAssignments } from "@/lib/member-work-overview";
import type { MemberOverviewItem } from "@/lib/member-work-overview";
import { normalizedPage, normalizedPageSize } from "@/lib/list-query";
import { getRequestAppAccessContext } from "@/lib/server/request-app-access-context";
import { loadMemberWorkOverview } from "@/lib/server/member-work-overview";
import { LegacyDeclarationSection } from "./LegacyDeclarationSection";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;
const stringParam = (value: string | string[] | undefined, fallback = "") => Array.isArray(value) ? value[0] ?? fallback : value ?? fallback;

export default async function MineVaerkerPage({ searchParams }: { searchParams: PageSearchParams }) {
  const timer = createListLoadTimer("member-works");
  const context = await getRequestAppAccessContext();
  if (!context) redirect("/");
  timer.mark("auth");

  const db = createServiceClient();
  if (!context?.rightsHolderId) redirect("/admin?notice=member-org-required");
  timer.mark("access");

  const query = await searchParams;
  const page = normalizedPage(stringParam(query.page));
  const requestedPageSize = normalizedPageSize(stringParam(query.pageSize), 20, 100);
  const pageSize = [20, 50, 100].includes(requestedPageSize) ? requestedPageSize : 20;
  const initialQuery = {
    search: stringParam(query.q),
    workType: stringParam(query.type, "all"),
    status: stringParam(query.status, "all"),
    sortKey: stringParam(query.sort, "date"),
    sortDir: stringParam(query.direction, "desc") === "asc" ? "asc" as const : "desc" as const,
  };
  const [rightsHolderResult, overview, broadcastersResult] = await Promise.all([
    db.from("rettighedshavere")
      .select("id,full_name,dfi_person_id")
      .eq("id", context.rightsHolderId)
      .eq("user_id", context.userId)
      .maybeSingle(),
    loadMemberWorkOverview({
      orgId: context.orgId,
      rightsHolderId: context.rightsHolderId,
      userId: context.userId,
    }, {
      page,
      pageSize,
      search: initialQuery.search,
      workType: initialQuery.workType,
      status: initialQuery.status,
      sortKey: initialQuery.sortKey,
      sortDir: initialQuery.sortDir,
    }),
    db.from("broadcasters").select("name,logo_path").order("name", { ascending: true }),
  ]);
  timer.mark("page-data");

  const rightsHolder = rightsHolderResult.data;
  if (!rightsHolder) redirect("/admin?notice=member-org-required");
  if (!overview.success) throw new Error(overview.error ?? "Mine værker kunne ikke indlæses.");

  const assignments = memberOverviewItemsToAssignments(
    overview.items as unknown as MemberOverviewItem[],
  ) as Assignment[];
  const contractedWorkIds = [...new Set(assignments.flatMap(assignment => {
    const work = assignment.works;
    if (!work || (work.overview_contract_count ?? 0) < 1) return [];
    return work.is_season_group ? work.child_work_ids ?? [] : [work.id];
  }))];
  timer.finish({ rowCount: assignments.length, contractCount: contractedWorkIds.length });

  return (
    <div className="space-y-6">
      <Suspense fallback={null}><LegacyDeclarationSection /></Suspense>
    <MineVaerkerClient
      initialAssignments={assignments}
      allAssignments={[]}
      broadcasters={(broadcastersResult.data ?? []) as BroadcasterLogo[]}
      rightsHolderId={rightsHolder.id}
      dfiPersonId={rightsHolder.dfi_person_id ?? null}
      contractedWorkIds={contractedWorkIds}
      legacyDeclarationRequiredWorkIds={overview.legacyRequiredWorkIds ?? []}
      legacyDeclaredWorkIds={overview.legacyDeclaredWorkIds ?? []}
      legacyDeclarationTaskCount={overview.legacyDeclarationTaskCount ?? 0}
      contracts={[] as Contract[]}
      organisationShortName={context.brand.short_name}
      defaultRoleLabel={context.terminology.default_role_label}
      coeditorWord={context.terminology.coeditor_word}
      pageResult={{
        page: overview.page ?? page,
        pageSize: overview.pageSize ?? pageSize,
        filteredCount: overview.filteredCount ?? assignments.length,
        totalCount: overview.totalCount ?? assignments.length,
        hasNextPage: overview.hasNextPage ?? false,
      }}
      initialQuery={initialQuery}
    />
    </div>
  );
}
