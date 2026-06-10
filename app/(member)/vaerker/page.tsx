import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import VaerkerClient from "./VaerkerClient";

export default async function VaerkerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: rh } = await supabase
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id)
    .single();

  const { data: assignments } = rh
    ? await supabase
        .from("work_assignments")
        .select("*, works(id, title, type, year, dfi_id, tmdb_id, poster_url, description)")
        .eq("rights_holder_id", rh.id)
        .order("created_at", { ascending: false })
    : { data: [] };

  return <VaerkerClient initialAssignments={assignments ?? []} rightsHolderId={rh?.id ?? null} />;
}
