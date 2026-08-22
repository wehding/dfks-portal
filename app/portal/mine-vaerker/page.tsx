export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireMemberContext } from "@/lib/org";
import { fetchMemberWorkOverview } from "@/app/actions/member-works";
import MineVaerkerClient from "./MineVaerkerClient";
import type { Assignment, BroadcasterLogo } from "./MineVaerkerClient";
import type { Contract } from "../mine-kontrakter/MineKontrakterClient";
import { createListLoadTimer } from "@/lib/server/list-load-timing";
import { memberOverviewItemsToAssignments } from "@/lib/member-work-overview";
import type { MemberOverviewItem } from "@/lib/member-work-overview";
import { normalizedPage, normalizedPageSize } from "@/lib/list-query";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;
const stringParam = (value: string | string[] | undefined, fallback = "") => Array.isArray(value) ? value[0] ?? fallback : value ?? fallback;

export default async function MineVaerkerPage({ searchParams }: { searchParams: PageSearchParams }) {
  const timer = createListLoadTimer("member-works");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  timer.mark("auth");

  const db = createServiceClient();
  const context = await requireMemberContext(db, user.id).catch(() => null);
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
      .eq("user_id", user.id)
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
  ]);
  timer.mark("page-data");

  const rightsHolder = rightsHolderResult.data;
  if (!rightsHolder) redirect("/admin?notice=member-org-required");
  if (!overview.success) throw new Error(overview.error ?? "Mine værker kunne ikke indlæses.");

  const assignments = memberOverviewItemsToAssignments(
    overview.items as unknown as MemberOverviewItem[],
  ) as Assignment[];
  const visibleWorkIds = [...new Set(assignments.flatMap(assignment => [
    assignment.works?.id,
    assignment.works?.parent_work_id,
    ...(assignment.works?.child_work_ids ?? []),
  ]).filter((id): id is string => typeof id === "string" && !id.startsWith("season:")))];
  const contractResult = visibleWorkIds.length
    ? await db.from("contracts")
        .select("id,type,overenskomst,status,contract_date,start_date,end_date,pdf_url,processed_pdf_url,work_id,working_title,season_number,episode_numbers,created_at,works(id,title,year,type),employers(id,name),contract_validations(has_credit_clause,has_overenskomst_incorporation,validated_at)")
        .eq("org_id", context.orgId)
        .eq("rights_holder_id", context.rightsHolderId)
        .is("superseded_by_contract_id", null)
        .in("work_id", visibleWorkIds)
    : { data: [], error: null };
  if (contractResult.error) throw new Error(contractResult.error.message);
  const contracts = (contractResult.data ?? []).map(raw => {
    const contract = raw as unknown as Contract & {
      works: Contract["works"] | Contract["works"][];
      employers: Contract["employers"] | Contract["employers"][];
    };
    return {
      ...contract,
      works: Array.isArray(contract.works) ? contract.works[0] ?? null : contract.works,
      employers: Array.isArray(contract.employers) ? contract.employers[0] ?? null : contract.employers,
      contract_attachments: [],
      contract_comments: [],
    } satisfies Contract;
  });
  const contractedWorkIds = [...new Set(contracts.map(contract => contract.work_id).filter((id): id is string => Boolean(id)))];
  timer.finish({ rowCount: assignments.length, contractCount: contracts.length });

  return (
    <MineVaerkerClient
      initialAssignments={assignments}
      allAssignments={[]}
      broadcasters={(broadcastersResult.data ?? []) as BroadcasterLogo[]}
      rightsHolderId={rightsHolder.id}
      dfiPersonId={rightsHolder.dfi_person_id ?? null}
      contractedWorkIds={contractedWorkIds}
      contracts={contracts}
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
  );
}
