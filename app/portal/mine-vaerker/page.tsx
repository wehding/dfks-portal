"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchMemberWorkOverview, linkApprovedCoEditorSuggestionsForRightsHolder } from "@/app/actions/member-works";
import { useRouter } from "next/navigation";
import MineVaerkerClient, { memberOverviewItemsToAssignments } from "./MineVaerkerClient";
import type { Assignment, BroadcasterLogo, OtherAssignment } from "./MineVaerkerClient";

type ContractWorkIdRow = { work_id: string | null };

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
        if (!rh) { setData({ assignments: [], allAssignments: [], broadcasters: [], rightsHolderId: null, userName: "", dfiPersonId: null, contractedWorkIds: [] }); return; }

        const overview = await fetchMemberWorkOverview({ rightsHolderId: rh.id });
        if (!overview.success) throw new Error(overview.error ?? "Mine værker kunne ikke indlæses.");

        const { data: broadcasters } = await supabase
          .from("broadcasters")
          .select("name, logo_path")
          .order("name", { ascending: true });

        const assignmentRows = memberOverviewItemsToAssignments(
          overview.items as Parameters<typeof memberOverviewItemsToAssignments>[0]
        ) as Assignment[];

        const { data: contractedWorkIds } = await supabase
          .from("contracts")
          .select("work_id")
          .eq("rights_holder_id", rh.id)
          .not("work_id", "is", null);

        const contractedWorkIdSet = new Set(
          ((contractedWorkIds ?? []) as ContractWorkIdRow[])
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
        });

        void linkApprovedCoEditorSuggestionsForRightsHolder({ rightsHolderId: rh.id, fullName: rh.full_name ?? "" }).catch(() => null);
      } catch (error) {
        console.error("Mine værker kunne ikke indlæses:", error);
        setLoadError(error instanceof Error ? error.message : "Mine værker kunne ikke indlæses.");
        setData({ assignments: [], allAssignments: [], broadcasters: [], rightsHolderId: null, userName: "", dfiPersonId: null, contractedWorkIds: [] });
      }
    }

    load();
  }, [router]);

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
        {loadError}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-500">
        Henter dine værker...
      </div>
    );
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
    />
  );
}
