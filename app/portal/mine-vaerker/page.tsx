"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { linkApprovedCoEditorSuggestionsForRightsHolder } from "@/app/actions/member-works";
import { useRouter } from "next/navigation";
import MineVaerkerClient from "./MineVaerkerClient";
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

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/"); return; }

      const { data: rh } = await supabase
        .from("rettighedshavere")
        .select("id, full_name, dfi_person_id")
        .eq("user_id", user.id)
        .single();

      if (!rh) { setData({ assignments: [], allAssignments: [], broadcasters: [], rightsHolderId: null, userName: "", dfiPersonId: null, contractedWorkIds: [] }); return; }

      await linkApprovedCoEditorSuggestionsForRightsHolder({ rightsHolderId: rh.id, fullName: rh.full_name ?? "" }).catch(() => null);

      const { data: assignments } = await supabase
        .from("work_assignments")
        .select("id, role, contract_id, episode_id, created_at, episodes(episode_number,title), works(id, title, type, year, duration_minutes, episode_count, genre, status, dfi_id, tmdb_id, poster_url, description, work_production_numbers(tv_station, number), work_change_requests(*, work_change_request_comments(*)))")
        .eq("rights_holder_id", rh.id)
        .order("created_at", { ascending: false });

      const { data: broadcasters } = await supabase
        .from("broadcasters")
        .select("name, logo_path")
        .order("name", { ascending: true });

      const assignmentRows = (assignments ?? []) as unknown as Assignment[];
      const workIds = assignmentRows.map(a => a.works?.id).filter((id): id is string => Boolean(id));
      const { data: allAssignments } = workIds.length
        ? await supabase
            .from("work_assignments")
            .select("id, work_id, role, rights_holder_id, rettighedshavere(id, full_name)")
            .in("work_id", workIds)
            .neq("rights_holder_id", rh.id)
        : { data: [] };

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
        allAssignments: (allAssignments ?? []) as unknown as OtherAssignment[],
        broadcasters: (broadcasters ?? []) as BroadcasterLogo[],
        rightsHolderId: rh.id,
        userName: rh.full_name ?? "",
        dfiPersonId: rh.dfi_person_id ?? null,
        contractedWorkIds: [...contractedWorkIdSet],
      });
    }

    load();
  }, [router]);

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
