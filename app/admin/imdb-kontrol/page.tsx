import { redirect } from "next/navigation";
import { ImdbControlClient } from "@/components/admin/imdb-control-client";
import { listWorkIdentityQueue } from "@/app/actions/work-identity";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ImdbControlPage() {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin"]);
  if (!caller) redirect("/admin");
  const items = await listWorkIdentityQueue();
  return <ImdbControlClient initialItems={items} />;
}
