"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchMemberWorkOverview, linkApprovedCoEditorSuggestionsForRightsHolder } from "@/app/actions/member-works";
import { useRouter } from "next/navigation";
import MineVaerkerClient, { memberOverviewItemsToAssignments } from "./MineVaerkerClient";
import type { Assignment, BroadcasterLogo, OtherAssignment } from "./MineVaerkerClient";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/data-skeletons";
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
    defaultRoleLabel: string;
    coeditorWord: string;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      setLoadError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.push("/"); return; }

        const contextResponse = await fetch("/api/access/context", { cache: "no-store" });
        if (!contextResponse.ok) throw new Error("Organisationsadgangen kunne ikke indlæses.");
        const context = await contextResponse.json() as {
          rightsHolderId: string | null;
          canUseAdmin: boolean;
          canUseMember: boolean;
          brand: { short_name: string };
          terminology: { default_role_label: string; coeditor_word: string };
        };
        if (!context.canUseMember || !context.rightsHolderId) {
          router.replace(context.canUseAdmin ? "/admin?notice=member-org-required" : "/");
          return;
        }

        const { data: rh, error: rhError } = await supabase
          .from("rettighedshavere")
          .select("id, full_name, dfi_person_id")
          .eq("id", context.rightsHolderId)
          .maybeSingle();

        if (rhError) throw rhError;
        if (!rh) { setData({ assignments: [], allAssignments: [], broadcasters: [], rightsHolderId: null, userName: "", dfiPersonId: null, contractedWorkIds: [], contracts: [], organisationShortName: "DFKS", defaultRoleLabel: "Klipper", coeditorWord: "Medklipper" }); return; }

        const organisationShortName = context.brand.short_name;

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
          defaultRoleLabel: context.terminology.default_role_label,
          coeditorWord: context.terminology.coeditor_word,
        });

        void linkApprovedCoEditorSuggestionsForRightsHolder({ rightsHolderId: rh.id, fullName: rh.full_name ?? "" }).catch(() => null);
      } catch (error) {
        console.error("Mine værker kunne ikke indlæses:", error);
        setLoadError(error instanceof Error ? error.message : "Mine værker kunne ikke indlæses.");
        setData({ assignments: [], allAssignments: [], broadcasters: [], rightsHolderId: null, userName: "", dfiPersonId: null, contractedWorkIds: [], contracts: [], organisationShortName: "DFKS", defaultRoleLabel: "Klipper", coeditorWord: "Medklipper" });
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
      defaultRoleLabel={data.defaultRoleLabel}
      coeditorWord={data.coeditorWord}
    />
  );
}
