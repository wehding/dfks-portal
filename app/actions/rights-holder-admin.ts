"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";

type DeleteBlocked = {
  id: string;
  name: string;
  reason: string;
};

export async function deleteRightsHolders(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return { success: false, error: "Vælg mindst én rettighedshaver.", deletedCount: 0, blocked: [] as DeleteBlocked[] };

  const supabase = await createClient();
  const admin = await assertAdminRole(supabase, ["superadmin", "admin", "org-admin"]);
  if (!admin) return { success: false, error: "Du har ikke adgang til at slette rettighedshavere.", deletedCount: 0, blocked: [] as DeleteBlocked[] };

  const db = createServiceClient();
  const { data: holders, error: holdersError } = await db
    .from("rettighedshavere")
    .select("id, full_name, user_id, org_affiliations!inner(org_id)")
    .in("id", uniqueIds)
    .eq("org_affiliations.org_id", admin.orgId);

  if (holdersError) return { success: false, error: holdersError.message, deletedCount: 0, blocked: [] as DeleteBlocked[] };

  const allowedIds = new Set((holders ?? []).map(holder => holder.id as string));
  const blocked: DeleteBlocked[] = uniqueIds
    .filter(id => !allowedIds.has(id))
    .map(id => ({ id, name: "Ukendt", reason: "Rettighedshaveren findes ikke i din organisation." }));

  const candidates = (holders ?? []).map(holder => ({
    id: holder.id as string,
    name: String(holder.full_name ?? "Ukendt"),
    userId: holder.user_id as string | null,
  }));

  for (const holder of candidates) {
    const [{ count: contractCount, error: contractError }, { count: assignmentCount, error: assignmentError }] = await Promise.all([
      db.from("contracts").select("id", { count: "exact", head: true }).eq("rights_holder_id", holder.id),
      db.from("work_assignments").select("id", { count: "exact", head: true }).eq("rights_holder_id", holder.id),
    ]);
    if (contractError || assignmentError) {
      blocked.push({ id: holder.id, name: holder.name, reason: contractError?.message ?? assignmentError?.message ?? "Kunne ikke tjekke tilknytninger." });
      continue;
    }
    if ((contractCount ?? 0) > 0 || (assignmentCount ?? 0) > 0) {
      blocked.push({
        id: holder.id,
        name: holder.name,
        reason: `Har ${contractCount ?? 0} kontrakter og ${assignmentCount ?? 0} værktildelinger. Fjern tilknytningerne først.`,
      });
    }
  }

  const blockedIds = new Set(blocked.map(item => item.id));
  const deletable = candidates.filter(holder => !blockedIds.has(holder.id));
  if (!deletable.length) return { success: true, deletedCount: 0, blocked };

  const { error: deleteError } = await db
    .from("rettighedshavere")
    .delete()
    .in("id", deletable.map(holder => holder.id));
  if (deleteError) return { success: false, error: deleteError.message, deletedCount: 0, blocked };

  await Promise.all(
    deletable
      .map(holder => holder.userId)
      .filter((userId): userId is string => Boolean(userId))
      .map(userId => db.auth.admin.deleteUser(userId).catch(() => null))
  );

  return { success: true, deletedCount: deletable.length, blocked };
}
