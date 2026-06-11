import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import MineVaerkerClient from "./MineVaerkerClient";

export default async function MineVaerkerPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: rh } = await supabase
    .from("rettighedshavere")
    .select("id, full_name, dfi_person_id")
    .eq("user_id", user.id)
    .single();

  const { data: assignments } = rh
    ? await supabase
        .from("work_assignments")
        .select("id, role, contract_id, works(id, title, type, year, dfi_id, tmdb_id, poster_url, description)")
        .eq("rights_holder_id", rh.id)
        .order("created_at", { ascending: false })
    : { data: [] };

  return (
    <MineVaerkerClient
      initialAssignments={(assignments ?? []) as any}
      rightsHolderId={rh?.id ?? null}
      userName={rh?.full_name ?? ""}
      dfiPersonId={rh?.dfi_person_id ?? null}
    />
  );
}
