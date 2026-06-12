"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import MineVaerkerClient from "./MineVaerkerClient";

export default function MineVaerkerPage() {
  const router = useRouter();
  const [data, setData] = useState<{
    assignments: any[];
    allAssignments: any[];
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

      if (!rh) { setData({ assignments: [], allAssignments: [], rightsHolderId: null, userName: "", dfiPersonId: null, contractedWorkIds: [] }); return; }

      const { data: assignments } = await supabase
        .from("work_assignments")
        .select("id, role, contract_id, episode_id, episodes(episode_number), works(id, title, type, year, dfi_id, tmdb_id, poster_url, description)")
        .eq("rights_holder_id", rh.id)
        .order("created_at", { ascending: false });

      const workIds = (assignments ?? []).map((a: any) => a.works?.id).filter(Boolean);
      const { data: allAssignments } = workIds.length
        ? await supabase
            .from("work_assignments")
            .select("work_id, role, rettighedshavere(full_name)")
            .in("work_id", workIds)
            .neq("rights_holder_id", rh.id)
        : { data: [] };

      const { data: contractedWorkIds } = await supabase
        .from("contracts")
        .select("work_id")
        .eq("rights_holder_id", rh.id)
        .not("work_id", "is", null);

      const contractedWorkIdSet = new Set(
        (contractedWorkIds ?? []).map((c: any) => c.work_id)
      );

      setData({
        assignments: assignments ?? [],
        allAssignments: allAssignments ?? [],
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
      initialAssignments={data.assignments as any}
      allAssignments={data.allAssignments as any}
      rightsHolderId={data.rightsHolderId}
      userName={data.userName}
      dfiPersonId={data.dfiPersonId}
      contractedWorkIds={data.contractedWorkIds}
    />
  );
}
