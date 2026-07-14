"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";

type DeleteBlocked = {
  id: string;
  name: string;
  reason: string;
};

async function getAdminContext(errorPrefix: string) {
  const supabase = await createClient();
  const admin = await assertAdminRole(supabase, ["superadmin", "admin", "org-admin"]);
  if (!admin) throw new Error(errorPrefix);
  return admin;
}

async function loadAllowedHolders(ids: string[], orgId: string) {
  const db = createServiceClient();
  const { data: holders, error: holdersError } = await db
    .from("rettighedshavere")
    .select("id, full_name, user_id, org_affiliations!inner(org_id)")
    .in("id", ids)
    .eq("org_affiliations.org_id", orgId);

  if (holdersError) throw new Error(holdersError.message);

  const allowedIds = new Set((holders ?? []).map(holder => holder.id as string));
  const blocked: DeleteBlocked[] = ids
    .filter(id => !allowedIds.has(id))
    .map(id => ({ id, name: "Ukendt", reason: "Rettighedshaveren findes ikke i din organisation." }));

  const candidates = (holders ?? []).map(holder => ({
    id: holder.id as string,
    name: String(holder.full_name ?? "Ukendt"),
    userId: holder.user_id as string | null,
  }));

  return { db, candidates, blocked };
}

export async function archiveRightsHolders(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return { success: false, error: "Vælg mindst én rettighedshaver.", archivedCount: 0, blocked: [] as DeleteBlocked[] };

  try {
    const admin = await getAdminContext("Du har ikke adgang til at arkivere rettighedshavere.");
    const { db, candidates, blocked } = await loadAllowedHolders(uniqueIds, admin.orgId);
    const archiveIds = candidates.map(holder => holder.id);
    if (archiveIds.length === 0) return { success: true, archivedCount: 0, blocked };

    const { error } = await db
      .from("rettighedshavere")
      .update({ archived_at: new Date().toISOString() })
      .in("id", archiveIds);
    if (error) throw new Error(error.message);
    return { success: true, archivedCount: archiveIds.length, blocked };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Kunne ikke arkivere rettighedshavere.", archivedCount: 0, blocked: [] as DeleteBlocked[] };
  }
}

export async function restoreRightsHolders(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return { success: false, error: "Vælg mindst én rettighedshaver.", restoredCount: 0 };

  try {
    const admin = await getAdminContext("Du har ikke adgang til at gendanne rettighedshavere.");
    const { db, candidates } = await loadAllowedHolders(uniqueIds, admin.orgId);
    const restoreIds = candidates.map(holder => holder.id);
    if (restoreIds.length === 0) return { success: true, restoredCount: 0 };
    const { error } = await db
      .from("rettighedshavere")
      .update({ archived_at: null })
      .in("id", restoreIds);
    if (error) throw new Error(error.message);
    return { success: true, restoredCount: restoreIds.length };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Kunne ikke gendanne rettighedshavere.", restoredCount: 0 };
  }
}

export async function permanentlyDeleteRightsHolders(
  ids: string[],
  options: { deleteContracts: boolean; deleteUnsharedWorks: boolean }
) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return { success: false, error: "Vælg mindst én rettighedshaver.", deletedCount: 0, deletedContracts: 0, deletedWorks: 0, blocked: [] as DeleteBlocked[] };

  try {
    const admin = await getAdminContext("Du har ikke adgang til at slette rettighedshavere permanent.");
    const { db, candidates, blocked } = await loadAllowedHolders(uniqueIds, admin.orgId);
    const holderIds = candidates.map(holder => holder.id);
    if (holderIds.length === 0) return { success: true, deletedCount: 0, deletedContracts: 0, deletedWorks: 0, blocked };

    let deletedContracts = 0;
    let deletedWorks = 0;

    if (options.deleteContracts) {
      const { count, error } = await db
        .from("contracts")
        .delete({ count: "exact" })
        .in("rights_holder_id", holderIds)
        .eq("org_id", admin.orgId);
      if (error) throw new Error(error.message);
      deletedContracts = count ?? 0;
    } else {
      const { error } = await db
        .from("contracts")
        .update({ rights_holder_id: null })
        .in("rights_holder_id", holderIds)
        .eq("org_id", admin.orgId);
      if (error) throw new Error(error.message);
    }

    if (options.deleteUnsharedWorks) {
      const { data: assignments, error: assignmentError } = await db
        .from("work_assignments")
        .select("work_id, rights_holder_id")
        .in("rights_holder_id", holderIds)
        .eq("org_id", admin.orgId);
      if (assignmentError) throw new Error(assignmentError.message);
      const workIds = Array.from(new Set((assignments ?? []).map(row => row.work_id as string).filter(Boolean)));
      const { data: allAssignments, error: allAssignmentsError } = workIds.length
        ? await db
            .from("work_assignments")
            .select("work_id, rights_holder_id")
            .in("work_id", workIds)
            .eq("org_id", admin.orgId)
        : { data: [], error: null };
      if (allAssignmentsError) throw new Error(allAssignmentsError.message);
      for (const workId of workIds) {
        const hasOtherHolder = ((allAssignments ?? []) as Array<{ work_id: string; rights_holder_id: string | null }>).some(row =>
          row.work_id === workId && row.rights_holder_id && !holderIds.includes(row.rights_holder_id)
        );
        if (!hasOtherHolder) {
          const { error: deleteWorkError } = await db
            .from("works")
            .delete()
            .eq("id", workId)
            .eq("org_id", admin.orgId);
          if (deleteWorkError) throw new Error(deleteWorkError.message);
          deletedWorks += 1;
        }
      }
    }

    const { error: assignmentsError } = await db
      .from("work_assignments")
      .delete()
      .in("rights_holder_id", holderIds)
      .eq("org_id", admin.orgId);
    if (assignmentsError) throw new Error(assignmentsError.message);

    await db.from("org_affiliations").delete().in("rights_holder_id", holderIds).eq("org_id", admin.orgId);

    const { error: deleteError } = await db
      .from("rettighedshavere")
      .delete()
      .in("id", holderIds);
    if (deleteError) throw new Error(deleteError.message);

    await Promise.all(
      candidates
        .map(holder => holder.userId)
        .filter((userId): userId is string => Boolean(userId))
        .map(userId => db.auth.admin.deleteUser(userId).catch(() => null))
    );

    return { success: true, deletedCount: holderIds.length, deletedContracts, deletedWorks, blocked };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Kunne ikke slette rettighedshavere permanent.",
      deletedCount: 0,
      deletedContracts: 0,
      deletedWorks: 0,
      blocked: [] as DeleteBlocked[],
    };
  }
}

export async function deleteRightsHolders(ids: string[]) {
  const result = await archiveRightsHolders(ids);
  return {
    success: result.success,
    error: result.error,
    deletedCount: result.archivedCount,
    blocked: result.blocked,
  };
}
