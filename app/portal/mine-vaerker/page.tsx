"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchMemberWorkOverview, linkApprovedCoEditorSuggestionsForRightsHolder } from "@/app/actions/member-works";
import { useRouter } from "next/navigation";
import MineVaerkerClient, { memberOverviewItemsToAssignments } from "./MineVaerkerClient";
import type { Assignment, BroadcasterLogo, OtherAssignment } from "./MineVaerkerClient";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/data-skeletons";
import { resolveBranding } from "@/lib/branding";
import { fetchMemberContractsList } from "@/app/actions/member-contracts";
import type { Contract } from "../mine-kontrakter/MineKontrakterClient";

export default function MineVaerkerPage() {
  const router = useRouter();
  const [data, setData] = useState<{
    assignments: Assignment[];
    allAssignments: OtherAssignment[];
    broadcasters: BroadcasterLogo[];
    rightsHolderId: string | null;
    userName: string;
    dfiPersonId: number | null;
    contractedWorkIds: string[];
    contracts: Contract[];
    organisationShortName: string;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      setLoadError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.push("/"); return; }

        const { data: rh, error: rhError } = await supabase
          .from("rettighedshavere")
          .select("id, full_name, dfi_person_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (rhError) throw rhError;
        if (!rh) { setData({ assignments: [], allAssignments: [], broadcasters: [], rightsHolderId: null, userName: "", dfiPersonId: null, contractedWorkIds: [], contracts: [], organisationShortName: "DFKS" }); return; }

        const { data: roleRow } = await supabase
          .from("user_org_roles")
          .select("org_id")
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle();
        const { data: organisation } = roleRow?.org_id
          ? await supabase
              .from("organisations")
              .select("name, branding")
              .eq("id", roleRow.org_id)
              .maybeSingle()
          : { data: null };
        const organisationShortName = organisation
          ? resolveBranding(organisation as never).short_name
          : "DFKS";

        const overview = await fetchMemberWorkOverview({ rightsHolderId: rh.id });
        if (!overview.success) throw new Error(overview.error ?? "Mine værker kunne ikke indlæses.");

        const { data: broadcasters } = await supabase
          .from("broadcasters")
          .select("name, logo_path")
          .order("name", { ascending: true });

        const assignmentRows = memberOverviewItemsToAssignments(
          overview.items as Parameters<typeof memberOverviewItemsToAssignments>[0]
        ) as Assignment[];

        const contractResult = await fetchMemberContractsList();
        if (!contractResult.success) throw new Error(contractResult.error ?? "Kontrakterne kunne ikke indlæses.");
        const memberContracts = (contractResult.contracts ?? []).map(raw => {
          const contract = raw as unknown as Contract & { works: Contract["works"] | Contract["works"][]; employers: Contract["employers"] | Contract["employers"][] };
          return {
            ...contract,
            works: Array.isArray(contract.works) ? contract.works[0] ?? null : contract.works,
            employers: Array.isArray(contract.employers) ? contract.employers[0] ?? null : contract.employers,
            contract_attachments: [],
            contract_comments: [],
          } satisfies Contract;
        });

        const contractedWorkIdSet = new Set(
          memberContracts
            .map(c => c.work_id)
            .filter((id): id is string => Boolean(id))
        );

        setData({
          assignments: assignmentRows,
          allAssignments: [],
          broadcasters: (broadcasters ?? []) as BroadcasterLogo[],
          rightsHolderId: rh.id,
          userName: rh.full_name ?? "",
          dfiPersonId: rh.dfi_person_id ?? null,
          contractedWorkIds: [...contractedWorkIdSet],
          contracts: memberContracts,
          organisationShortName,
        });

        void linkApprovedCoEditorSuggestionsForRightsHolder({ rightsHolderId: rh.id, fullName: rh.full_name ?? "" }).catch(() => null);
      } catch (error) {
        console.error("Mine værker kunne ikke indlæses:", error);
        setLoadError(error instanceof Error ? error.message : "Mine værker kunne ikke indlæses.");
        setData({ assignments: [], allAssignments: [], broadcasters: [], rightsHolderId: null, userName: "", dfiPersonId: null, contractedWorkIds: [], contracts: [], organisationShortName: "DFKS" });
      }
    }

    load();
  }, [router]);

  if (loadError) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="font-medium text-destructive">Mine værker kunne ikke indlæses</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{loadError}</p>
        <Button type="button" variant="outline" className="mt-4" onClick={() => window.location.reload()}>Prøv igen</Button>
      </div>
    );
  }

  if (!data) {
    return <TableSkeleton columns={6} rows={6} />;
  }

  return (
    <MineVaerkerClient
      initialAssignments={data.assignments}
      allAssignments={data.allAssignments}
      broadcasters={data.broadcasters}
      rightsHolderId={data.rightsHolderId}
      userName={data.userName}
      dfiPersonId={data.dfiPersonId}
      contractedWorkIds={data.contractedWorkIds}
      contracts={data.contracts}
      organisationShortName={data.organisationShortName}
    />
  );
}
