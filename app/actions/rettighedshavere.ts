"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { assertRightsHolderInOrg } from "@/lib/authz";
import { encryptValue } from "@/lib/encryption";
import { isMissingGenderColumn } from "@/lib/rights-holder-gender";
import type { RettighedshaverWithAffiliation } from "@/lib/db/rettighedshavere";

export type AdminRightsHolderListItem = RettighedshaverWithAffiliation & {
  organisation_names: string[];
};

export type AdminRightsHolderCounts = Record<string, {
  contracts: number;
  works: number;
  allContractsValidated: boolean;
}>;

const ADMIN_RIGHTS_HOLDER_FIELDS = `
  id,
  full_name,
  email,
  phone,
  address,
  created_at,
  user_id,
  onboarding_completed,
  archived_at,
  invite_sent_at,
  dfi_person_id,
  tmdb_person_id,
  wikidata_qid,
  portrait_url
`;

type RightsHolderInput = {
  full_name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  cpr_no?: string | null;
  bank_account?: string | null;
  gender?: string | null;
  opt_out_statistics?: boolean | null;
};

function securePayload(input: RightsHolderInput) {
  return {
    full_name: input.full_name,
    email: input.email || null,
    phone: input.phone || null,
    address: input.address || null,
    cpr_no: encryptValue(input.cpr_no),
    bank_account: encryptValue(input.bank_account),
    ...(input.gender !== undefined ? { gender: input.gender || null } : {}),
    ...(input.opt_out_statistics !== undefined ? { opt_out_statistics: Boolean(input.opt_out_statistics) } : {}),
  };
}

function withoutGender(payload: ReturnType<typeof securePayload>) {
  const compatiblePayload: Record<string, string | boolean | null> = { ...payload };
  delete compatiblePayload.gender;
  return compatiblePayload;
}

export async function getAdminRightsHolders(options: { offset?: number; limit?: number } = {}) {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, ["superadmin", "admin", "org-admin"]);
  if (!caller) throw new Error("Du har ikke adgang til rettighedshaverlisten.");

  const db = createServiceClient();
  const canSeeAllOrganisations = caller.role === "superadmin";
  const holdersQuery = canSeeAllOrganisations
    ? db.from("rettighedshavere").select(`${ADMIN_RIGHTS_HOLDER_FIELDS}, org_affiliations(*)`)
    : db
        .from("rettighedshavere")
        .select(`${ADMIN_RIGHTS_HOLDER_FIELDS}, org_affiliations!inner(*)`)
        .eq("org_affiliations.org_id", caller.orgId);
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(200, Math.max(25, options.limit ?? 100));
  const { data: holderPage, error: holdersError } = await holdersQuery.order("full_name").range(offset, offset + limit);
  if (holdersError) throw new Error(holdersError.message);
  const hasMore = (holderPage?.length ?? 0) > limit;
  const holderRows = (holderPage ?? []).slice(0, limit);

  const orgIds = Array.from(new Set((holderRows ?? [])
    .flatMap(holder => (holder.org_affiliations ?? []).map((affiliation: { org_id: string }) => affiliation.org_id))));
  const { data: organisations, error: organisationsError } = orgIds.length
    ? await db.from("organisations").select("id, name").in("id", orgIds)
    : { data: [], error: null };
  if (organisationsError) throw new Error(organisationsError.message);
  const orgNames = new Map((organisations ?? []).map(org => [org.id as string, String(org.name)]));

  const rows = (holderRows ?? []).map(holder => ({
    ...holder,
    organisation_names: Array.from(new Set((holder.org_affiliations ?? [])
      .map((affiliation: { org_id: string }) => orgNames.get(affiliation.org_id))
      .filter((name): name is string => Boolean(name)))),
  })) as unknown as AdminRightsHolderListItem[];

  const holderIds = rows.map(holder => holder.id);
  let contractsQuery = db.from("contracts").select("rights_holder_id, status").in("rights_holder_id", holderIds.length ? holderIds : ["00000000-0000-0000-0000-000000000000"]);
  let assignmentsQuery = db.from("work_assignments").select("rights_holder_id").in("rights_holder_id", holderIds.length ? holderIds : ["00000000-0000-0000-0000-000000000000"]);
  if (!canSeeAllOrganisations) {
    contractsQuery = contractsQuery.eq("org_id", caller.orgId);
    assignmentsQuery = assignmentsQuery.eq("org_id", caller.orgId);
  }
  const [{ data: contracts, error: contractsError }, { data: assignments, error: assignmentsError }] = await Promise.all([
    contractsQuery,
    assignmentsQuery,
  ]);
  if (contractsError) throw new Error(contractsError.message);
  if (assignmentsError) throw new Error(assignmentsError.message);

  const countsByRightsHolder: AdminRightsHolderCounts = {};
  const statusesByRightsHolder: Record<string, string[]> = {};
  for (const contract of contracts ?? []) {
    const rightsHolderId = contract.rights_holder_id as string | null;
    if (!rightsHolderId) continue;
    countsByRightsHolder[rightsHolderId] ??= { contracts: 0, works: 0, allContractsValidated: false };
    countsByRightsHolder[rightsHolderId].contracts += 1;
    statusesByRightsHolder[rightsHolderId] ??= [];
    statusesByRightsHolder[rightsHolderId].push(String(contract.status ?? ""));
  }
  for (const assignment of assignments ?? []) {
    const rightsHolderId = assignment.rights_holder_id as string | null;
    if (!rightsHolderId) continue;
    countsByRightsHolder[rightsHolderId] ??= { contracts: 0, works: 0, allContractsValidated: false };
    countsByRightsHolder[rightsHolderId].works += 1;
  }
  for (const [rightsHolderId, counts] of Object.entries(countsByRightsHolder)) {
    const statuses = statusesByRightsHolder[rightsHolderId] ?? [];
    counts.allContractsValidated = statuses.length > 0 && statuses.every(status => ["valideret", "validated", "arkiveret"].includes(status));
  }

  return {
    rows,
    countsByRightsHolder,
    orgId: caller.orgId,
    canSeeAllOrganisations,
    hasMore,
  };
}

export type RightsHolderRelationOption = {
  id: string;
  title: string;
  secondary: string | null;
  selected: boolean;
};

export async function getRightsHolderRelations(rightsHolderId: string) {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, ["superadmin", "admin", "org-admin"]);
  if (!caller) throw new Error("Ikke autoriseret");
  const db = createServiceClient();
  await assertRightsHolderInOrg(db, rightsHolderId, caller.orgId);
  const [{ data: assignments, error: assignmentsError }, { data: contracts, error: contractsError }, { data: works, error: worksError }] = await Promise.all([
    db.from("work_assignments").select("work_id").eq("org_id", caller.orgId).eq("rights_holder_id", rightsHolderId),
    db.from("contracts").select("id,working_title,status,rights_holder_id").eq("org_id", caller.orgId).order("created_at", { ascending: false }),
    db.from("works").select("id,title,type,year").is("parent_work_id", null).order("title").limit(1000),
  ]);
  if (assignmentsError || contractsError || worksError) throw new Error(assignmentsError?.message ?? contractsError?.message ?? worksError?.message ?? "Relationer kunne ikke hentes");
  const selectedWorkIds = new Set((assignments ?? []).map(row => row.work_id));
  return {
    works: (works ?? []).map(work => ({ id: work.id, title: work.title, secondary: [work.year, work.type].filter(Boolean).join(" · ") || null, selected: selectedWorkIds.has(work.id) })) as RightsHolderRelationOption[],
    contracts: (contracts ?? []).map(contract => ({ id: contract.id, title: contract.working_title ?? "Kontrakt uden titel", secondary: contract.status, selected: contract.rights_holder_id === rightsHolderId })) as RightsHolderRelationOption[],
  };
}

export async function saveRightsHolderRelations(params: { rightsHolderId: string; workIds: string[]; contractIds: string[] }) {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, ["superadmin", "admin", "org-admin"]);
  if (!caller) return { success: false, error: "Ikke autoriseret" };
  const db = createServiceClient();
  await assertRightsHolderInOrg(db, params.rightsHolderId, caller.orgId);
  const workIds = [...new Set(params.workIds)].slice(0, 1000);
  const contractIds = [...new Set(params.contractIds)].slice(0, 1000);
  const { data: existingAssignments, error: assignmentReadError } = await db
    .from("work_assignments")
    .select("id,work_id")
    .eq("org_id", caller.orgId)
    .eq("rights_holder_id", params.rightsHolderId);
  if (assignmentReadError) return { success: false, error: assignmentReadError.message };
  const removeAssignmentIds = (existingAssignments ?? []).filter(row => !workIds.includes(row.work_id)).map(row => row.id);
  if (removeAssignmentIds.length) {
    const removed = await db.from("work_assignments").delete().in("id", removeAssignmentIds).eq("org_id", caller.orgId);
    if (removed.error) return { success: false, error: removed.error.message };
  }
  const existingWorkIds = new Set((existingAssignments ?? []).map(row => row.work_id));
  const additions = workIds.filter(id => !existingWorkIds.has(id));
  if (additions.length) {
    const { data: validWorks, error: validWorksError } = await db.from("works").select("id").in("id", additions);
    if (validWorksError) return { success: false, error: validWorksError.message };
    const validIds = new Set((validWorks ?? []).map(work => work.id));
    const added = await db.from("work_assignments").insert(additions.filter(id => validIds.has(id)).map(workId => ({
      work_id: workId,
      org_id: caller.orgId,
      rights_holder_id: params.rightsHolderId,
      role: "Klipper",
    })));
    if (added.error) return { success: false, error: added.error.message };
    await Promise.all(additions.filter(id => validIds.has(id)).map(workId => db.from("work_organisations").upsert({ work_id: workId, org_id: caller.orgId, relation_role: "catalogue" }, { onConflict: "work_id,org_id" })));
  }
  let ownedContracts = db.from("contracts").update({ rights_holder_id: null }).eq("org_id", caller.orgId).eq("rights_holder_id", params.rightsHolderId);
  if (contractIds.length) ownedContracts = ownedContracts.not("id", "in", `(${contractIds.join(",")})`);
  const cleared = await ownedContracts;
  if (cleared.error) return { success: false, error: cleared.error.message };
  if (contractIds.length) {
    const assigned = await db.from("contracts").update({ rights_holder_id: params.rightsHolderId }).eq("org_id", caller.orgId).in("id", contractIds);
    if (assigned.error) return { success: false, error: assigned.error.message };
  }
  revalidatePath("/admin/rettighedshavere");
  revalidatePath("/admin/kontrakter");
  revalidatePath("/admin/vaerker");
  return { success: true };
}

export async function createRettighedshaverSecure(
  input: RightsHolderInput,
  orgId: string,
  isMember: boolean,
  memberNo?: string
) {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase);
  if (!caller || caller.orgId !== orgId) return { success: false, error: "Ikke autoriseret" };

  const db = createServiceClient();
  const payload = securePayload(input);
  let createResult = await db
    .from("rettighedshavere")
    .insert(payload)
    .select("id")
    .single();

  if (isMissingGenderColumn(createResult.error)) {
    createResult = await db
      .from("rettighedshavere")
      .insert(withoutGender(payload))
      .select("id")
      .single();
  }

  const { data: rh, error } = createResult;

  if (error || !rh) return { success: false, error: error?.message ?? "Kunne ikke oprette rettighedshaver" };

  const { error: affiliationError } = await db.from("org_affiliations").insert({
    org_id: orgId,
    rights_holder_id: rh.id,
    is_member: isMember,
    member_no: memberNo ?? null,
  });

  if (affiliationError) {
    await db.from("rettighedshavere").delete().eq("id", rh.id);
    return { success: false, error: affiliationError.message };
  }

  revalidatePath("/admin/rettighedshavere");
  return { success: true, rightsHolder: rh };
}

export async function updateRettighedshaverSecure(
  id: string,
  orgId: string,
  input: RightsHolderInput
) {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase);
  if (!caller || caller.orgId !== orgId) return { success: false, error: "Ikke autoriseret" };

  const db = createServiceClient();
  try {
    await assertRightsHolderInOrg(db, id, orgId);
  } catch {
    return { success: false, error: "Rettighedshaveren tilhører ikke din organisation" };
  }

  const payload = Object.fromEntries(
    Object.entries(securePayload(input)).filter(([key, value]) => {
      if ((key === "cpr_no" || key === "bank_account") && value === null) return false;
      return true;
    })
  ) as ReturnType<typeof securePayload>;

  let updateResult = await db
    .from("rettighedshavere")
    .update(payload)
    .eq("id", id);

  if (isMissingGenderColumn(updateResult.error)) {
    updateResult = await db
      .from("rettighedshavere")
      .update(withoutGender(payload))
      .eq("id", id);
  }

  if (updateResult.error) return { success: false, error: updateResult.error.message };
  revalidatePath("/admin/rettighedshavere");
  return { success: true };
}
