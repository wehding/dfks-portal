export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchMemberWorkOverview } from "@/app/actions/member-works";
import MineVaerkerClient from "./MineVaerkerClient";
import type { Assignment, BroadcasterLogo } from "./MineVaerkerClient";
import type { Contract } from "../mine-kontrakter/MineKontrakterClient";
import { createListLoadTimer } from "@/lib/server/list-load-timing";
import { memberOverviewItemsToAssignments } from "@/lib/member-work-overview";
import type { MemberOverviewItem } from "@/lib/member-work-overview";
import { normalizedPage, normalizedPageSize } from "@/lib/list-query";
import { getRequestAppAccessContext } from "@/lib/server/request-app-access-context";
import { fetchLegacyDeclarationTasks } from "@/app/actions/legacy-work-declarations";
import { LegacyDeclarationPanel } from "./LegacyDeclarationPanel";

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
  const [rightsHolderResult, overview, broadcastersResult, legacyDeclarations] = await Promise.all([
    db.from("rettighedshavere")
      .select("id,full_name,dfi_person_id")
      .eq("id", context.rightsHolderId)
      .eq("user_id", context.userId)
      .maybeSingle(),
    fetchMemberWorkOverview({
      rightsHolderId: context.rightsHolderId,
      page,
      pageSize,
      search: initialQuery.search,
      workType: initialQuery.workType,
      status: initialQuery.status,
      sortKey: initialQuery.sortKey,
      sortDir: initialQuery.sortDir,
    }),
    db.from("broadcasters").select("name,logo_path").order("name", { ascending: true }),
    fetchLegacyDeclarationTasks(),
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
  const { data: activeDeclarationScopes, error: declarationScopeError } = await db.rpc("list_member_legacy_declared_scope_ids", {
    p_org_id: context.orgId,
    p_rights_holder_id: context.rightsHolderId,
  });
  if (declarationScopeError) throw new Error(declarationScopeError.message);
  timer.finish({ rowCount: assignments.length, contractCount: contractedWorkIds.length });

  return (
    <div className="space-y-6">
      <LegacyDeclarationPanel
        initialTasks={legacyDeclarations.tasks}
        enabled={legacyDeclarations.enabled}
        cutoffYear={legacyDeclarations.cutoffYear}
        organisationName={legacyDeclarations.organisationName}
        document={legacyDeclarations.document}
      />
    <MineVaerkerClient
      initialAssignments={assignments}
      allAssignments={[]}
      broadcasters={(broadcastersResult.data ?? []) as BroadcasterLogo[]}
      rightsHolderId={rightsHolder.id}
      dfiPersonId={rightsHolder.dfi_person_id ?? null}
      contractedWorkIds={contractedWorkIds}
      legacyDeclarationRequiredWorkIds={legacyDeclarations.tasks.flatMap(task => task.qualifyingScopeIds)}
      legacyDeclaredWorkIds={((activeDeclarationScopes ?? []) as Array<{ work_id: string }>).map(row => row.work_id)}
      legacyDeclarationTaskCount={legacyDeclarations.tasks.length}
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
