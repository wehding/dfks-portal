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
  } | null>(null);

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      console.log("[mine-vaerker] user:", user?.id, "authErr:", authErr?.message);
      if (!user) { router.push("/"); return; }

      const { data: rh, error: rhErr } = await supabase
        .from("rettighedshavere")
        .select("id, full_name, dfi_person_id")
        .eq("user_id", user.id)
        .single();
      console.log("[mine-vaerker] rh:", rh?.id, "rhErr:", rhErr?.message);

      if (!rh) { setData({ assignments: [], allAssignments: [], rightsHolderId: null, userName: "", dfiPersonId: null }); return; }

      const { data: assignments, error: assErr } = await supabase
        .from("work_assignments")
        .select("id, role, contract_id, episode_id, episodes(episode_number), works(id, title, type, year, dfi_id, tmdb_id, poster_url, description)")
        .eq("rights_holder_id", rh.id)
        .order("created_at", { ascending: false });

      console.log("[mine-vaerker] assignments:", assignments?.length, "assErr:", assErr?.message);
      const workIds = (assignments ?? []).map((a: any) => a.works?.id).filter(Boolean);
      const { data: allAssignments } = workIds.length
        ? await supabase
            .from("work_assignments")
            .select("work_id, role, rettighedshavere(full_name)")
            .in("work_id", workIds)
            .neq("rights_holder_id", rh.id)
        : { data: [] };

      setData({
        assignments: assignments ?? [],
        allAssignments: allAssignments ?? [],
        rightsHolderId: rh.id,
        userName: rh.full_name ?? "",
        dfiPersonId: rh.dfi_person_id ?? null,
      });
    }

    load();
  }, [router]);

  if (!data) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px", color: "var(--on-surface-variant)" }}>
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
    />
  );
}
