import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";
import MineVaerkerClient from "./MineVaerkerClient";

export default async function MineVaerkerPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  // Brug service-klient til DB-queries (undgår cirkulære RLS-checks)
  const db = createServiceClient();

  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id, full_name, dfi_person_id")
    .eq("user_id", user.id)
    .single();

  const { data: assignments } = rh
    ? await db
        .from("work_assignments")
        .select("id, role, contract_id, episode_id, episodes(episode_number), works(id, title, type, year, dfi_id, tmdb_id, poster_url, description)")
        .eq("rights_holder_id", rh.id)
        .order("created_at", { ascending: false })
    : { data: [] };

  const workIds = (assignments ?? []).map((a: any) => a.works?.id).filter(Boolean);
  const { data: allAssignments } = workIds.length
    ? await db
        .from("work_assignments")
        .select("work_id, role, rettighedshavere(full_name)")
        .in("work_id", workIds)
        .neq("rights_holder_id", rh!.id)
    : { data: [] };

  return (
    <MineVaerkerClient
      initialAssignments={(assignments ?? []) as any}
      allAssignments={(allAssignments ?? []) as any}
      rightsHolderId={rh?.id ?? null}
      userName={rh?.full_name ?? ""}
      dfiPersonId={rh?.dfi_person_id ?? null}
    />
  );
}
