export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireMemberContext } from "@/lib/org";
import { fetchMemberWorkOverview } from "@/app/actions/member-works";
import { fetchMemberContractsList } from "@/app/actions/member-contracts";
import MineVaerkerClient from "./MineVaerkerClient";
import type { Assignment, BroadcasterLogo } from "./MineVaerkerClient";
import type { Contract } from "../mine-kontrakter/MineKontrakterClient";
import { createListLoadTimer } from "@/lib/server/list-load-timing";
import { memberOverviewItemsToAssignments } from "@/lib/member-work-overview";
import type { MemberOverviewItem } from "@/lib/member-work-overview";

export default async function MineVaerkerPage() {
  const timer = createListLoadTimer("member-works");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  timer.mark("auth");

  const db = createServiceClient();
  const context = await requireMemberContext(db, user.id).catch(() => null);
  if (!context?.rightsHolderId) redirect("/admin?notice=member-org-required");
  timer.mark("access");

  const [rightsHolderResult, overview, broadcastersResult, contractResult] = await Promise.all([
    db.from("rettighedshavere")
      .select("id,full_name,dfi_person_id")
      .eq("id", context.rightsHolderId)
      .eq("user_id", user.id)
      .maybeSingle(),
    fetchMemberWorkOverview({ rightsHolderId: context.rightsHolderId }),
    db.from("broadcasters").select("name,logo_path").order("name", { ascending: true }),
    fetchMemberContractsList(),
  ]);
  timer.mark("page-data");

  const rightsHolder = rightsHolderResult.data;
  if (!rightsHolder) redirect("/admin?notice=member-org-required");
  if (!overview.success) throw new Error(overview.error ?? "Mine værker kunne ikke indlæses.");
  if (!contractResult.success) throw new Error(contractResult.error ?? "Kontrakterne kunne ikke indlæses.");

  const assignments = memberOverviewItemsToAssignments(
    overview.items as unknown as MemberOverviewItem[],
  ) as Assignment[];
  const contracts = (contractResult.contracts ?? []).map(raw => {
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
      userName={rightsHolder.full_name ?? ""}
      dfiPersonId={rightsHolder.dfi_person_id ?? null}
      contractedWorkIds={contractedWorkIds}
      contracts={contracts}
      organisationShortName={context.brand.short_name}
      defaultRoleLabel={context.terminology.default_role_label}
      coeditorWord={context.terminology.coeditor_word}
    />
  );
}
