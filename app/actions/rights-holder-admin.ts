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

async function loadAllowedHolders(ids: string[], orgId: string, allowUnassigned: boolean) {
  const db = createServiceClient();
  const { data: holders, error: holdersError } = await db
    .from("rettighedshavere")
    .select("id, full_name, user_id, org_affiliations(org_id)")
    .in("id", ids);

  if (holdersError) throw new Error(holdersError.message);

  const candidates = (holders ?? []).flatMap(holder => {
    const affiliations = (holder.org_affiliations ?? []) as Array<{ org_id: string }>;
    const belongsToOrganisation = affiliations.some(affiliation => affiliation.org_id === orgId);
    const isUnassigned = affiliations.length === 0;
    if (!belongsToOrganisation && !(allowUnassigned && isUnassigned)) return [];
    return [{
      id: holder.id as string,
      name: String(holder.full_name ?? "Ukendt"),
      userId: holder.user_id as string | null,
      isUnassigned,
    }];
  });
  const allowedIds = new Set(candidates.map(holder => holder.id));
  const blocked: DeleteBlocked[] = ids
    .filter(id => !allowedIds.has(id))
    .map(id => ({ id, name: "Ukendt", reason: "Rettighedshaveren findes ikke i din organisation eller er tilknyttet en anden organisation." }));

  return { db, candidates, blocked };
}

export async function archiveRightsHolders(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return { success: false, error: "Vælg mindst én rettighedshaver.", archivedCount: 0, blocked: [] as DeleteBlocked[] };

  try {
    const admin = await getAdminContext("Du har ikke adgang til at arkivere rettighedshavere.");
    const { db, candidates, blocked } = await loadAllowedHolders(uniqueIds, admin.orgId, admin.role === "superadmin");
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
    const { db, candidates } = await loadAllowedHolders(uniqueIds, admin.orgId, admin.role === "superadmin");
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
  if (!uniqueIds.length) return { success: false, error: "Vælg mindst én rettighedshaver.", deletedCount: 0, deletedContracts: 0, deletedWorks: 0, deletedUsers: 0, authDeleteFailures: [] as string[], blocked: [] as DeleteBlocked[] };

  try {
    const admin = await getAdminContext("Du har ikke adgang til at slette rettighedshavere permanent.");
    const { db, candidates, blocked } = await loadAllowedHolders(uniqueIds, admin.orgId, admin.role === "superadmin");
    const holderIds = candidates.map(holder => holder.id);
    if (holderIds.length === 0) return { success: true, deletedCount: 0, deletedContracts: 0, deletedWorks: 0, deletedUsers: 0, authDeleteFailures: [] as string[], blocked };

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

    // org_affiliations er mange-til-mange: en rettighedshaver kan tilhøre flere organisationer.
    // Slet KUN selve rettighedshaver-rækken hvis den ikke længere er tilknyttet nogen organisation —
    // ellers ville vi ødelægge en holder, som en anden org stadig bruger (dangling FK / datatab).
    const { data: remainingAffiliations, error: remainingError } = await db
      .from("org_affiliations")
      .select("rights_holder_id")
      .in("rights_holder_id", holderIds);
    if (remainingError) throw new Error(remainingError.message);
    const stillAffiliated = new Set((remainingAffiliations ?? []).map(row => row.rights_holder_id as string));
    const deletableHolderIds = holderIds.filter(id => !stillAffiliated.has(id));

    if (deletableHolderIds.length) {
      const { error: deleteError } = await db
        .from("rettighedshavere")
        .delete()
        .in("id", deletableHolderIds);
      if (deleteError) throw new Error(deleteError.message);
    }

    const userIds = candidates.map(holder => holder.userId).filter((userId): userId is string => Boolean(userId));
    if (userIds.length) {
      const { error: roleDeleteError } = await db
        .from("user_org_roles")
        .delete()
        .in("user_id", userIds)
        .eq("org_id", admin.orgId);
      if (roleDeleteError) throw new Error(roleDeleteError.message);
    }

    let deletedUsers = 0;
    const authDeleteFailures: string[] = [];
    for (const userId of userIds) {
      const [{ count: remainingRoles }, { count: remainingProfiles }] = await Promise.all([
        db.from("user_org_roles").select("user_id", { count: "exact", head: true }).eq("user_id", userId),
        db.from("rettighedshavere").select("id", { count: "exact", head: true }).eq("user_id", userId),
      ]);
      if ((remainingRoles ?? 0) > 0 || (remainingProfiles ?? 0) > 0) continue;
      const { error: authDeleteError } = await db.auth.admin.deleteUser(userId);
      if (authDeleteError) {
        console.error("Rettighedshaver slettet, men loginbrugeren kunne ikke slettes", { userId, error: authDeleteError.message });
        authDeleteFailures.push(authDeleteError.message);
      } else {
        deletedUsers += 1;
      }
    }

    return { success: true, deletedCount: holderIds.length, deletedContracts, deletedWorks, deletedUsers, authDeleteFailures, blocked };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Kunne ikke slette rettighedshavere permanent.",
      deletedCount: 0,
      deletedContracts: 0,
      deletedWorks: 0,
      deletedUsers: 0,
      authDeleteFailures: [] as string[],
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
