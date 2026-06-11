import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import MineKontrakterClient from "./MineKontrakterClient";

export default async function MineKontrakterPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const db = createServiceClient();

  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", user.id)
    .single();

  const { data: contracts } = rh
    ? await db
        .from("contracts")
        .select("id, type, overenskomst, status, contract_date, start_date, end_date, pdf_url, created_at, works(id, title, year), employers(id, name), contract_validations(svod, copydan, royalty)")
        .eq("rights_holder_id", rh.id)
        .order("uploaded_at", { ascending: false })
    : { data: [] };

  return <MineKontrakterClient initialContracts={(contracts ?? []) as any} />;
}
