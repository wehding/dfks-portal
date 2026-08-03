"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { ADMIN_ROLES, USER_ADMIN_ROLES } from "@/lib/admin-roles";
import { assertRightsHolderInOrg } from "@/lib/authz";
import { encryptValue } from "@/lib/encryption";
import { decryptRettighedshaver } from "@/lib/encryption";
import { isMissingGenderColumn } from "@/lib/rights-holder-gender";
import type { RettighedshaverWithAffiliation } from "@/lib/db/rettighedshavere";

export type AdminRightsHolderListItem = RettighedshaverWithAffiliation & {
  organisation_names: string[];
};

const EXTERNAL_ID_SOURCES = ["dfi", "tmdb", "wikidata", "imdb"] as const;
type ExternalIdSource = (typeof EXTERNAL_ID_SOURCES)[number];

export type AdminRightsHolderProfile = {
  cpr_no: string;
  bank_account: string;
  alternative_names: string[];
  portrait_url: string | null;
  professional_start_year: number | null;
  primary_profession_type_id: string | null;
  secondary_profession_type_ids: string[];
  usual_work_mode: string | null;
  primary_work_region_code: string | null;
  external_identities: Record<ExternalIdSource, string[]>;
  profession_types: Array<{ id: string; name: string }>;
  work_regions: Array<{ code: string; name_da: string; name_en: string }>;
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
  alternative_names?: string[];
  portrait_url?: string | null;
  professional_start_year?: number | null;
  primary_profession_type_id?: string | null;
  secondary_profession_type_ids?: string[];
  usual_work_mode?: string | null;
  primary_work_region_code?: string | null;
  external_identities?: Partial<Record<ExternalIdSource, string[]>>;
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
    ...(input.alternative_names !== undefined ? { alternative_names: [...new Set(input.alternative_names.map(name => name.trim()).filter(Boolean))].slice(0, 24) } : {}),
    ...(input.portrait_url !== undefined ? { portrait_url: input.portrait_url?.trim() || null } : {}),
    ...(input.professional_start_year !== undefined ? { professional_start_year: input.professional_start_year } : {}),
    ...(input.primary_profession_type_id !== undefined ? { primary_profession_type_id: input.primary_profession_type_id || null } : {}),
    ...(input.usual_work_mode !== undefined ? { usual_work_mode: input.usual_work_mode || null } : {}),
    ...(input.primary_work_region_code !== undefined ? { primary_work_region_code: input.primary_work_region_code || null } : {}),
  };
}

function withoutGender(payload: ReturnType<typeof securePayload>) {
  const compatiblePayload: Record<string, unknown> = { ...payload };
  delete compatiblePayload.gender;
  return compatiblePayload;
}

export async function getAdminRightsHolderProfile(id: string, orgId: string): Promise<AdminRightsHolderProfile> {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, USER_ADMIN_ROLES);
  if (!caller || caller.orgId !== orgId) throw new Error("Ikke autoriseret");
  const db = createServiceClient();
  await assertRightsHolderInOrg(db, id, orgId);

  const [{ data: holder, error: holderError }, { data: secondary, error: secondaryError }, { data: identities, error: identitiesError }, { data: professionRows, error: professionsError }, { data: regionRows, error: regionsError }] = await Promise.all([
    db.from("rettighedshavere").select("cpr_no,bank_account,alternative_names,portrait_url,professional_start_year,primary_profession_type_id,usual_work_mode,primary_work_region_code").eq("id", id).single(),
    db.from("rights_holder_profession_types").select("profession_type_id").eq("rights_holder_id", id),
    db.from("rights_holder_external_identities").select("source,external_id").eq("rights_holder_id", id).order("source").order("external_id"),
    db.from("organisation_profession_types").select("profession_type_id,profession_types(name)").eq("org_id", orgId).order("display_order"),
    db.from("organisation_work_regions").select("code,name_da,name_en").eq("org_id", orgId).eq("active", true).order("display_order"),
  ]);
  const error = holderError ?? secondaryError ?? identitiesError ?? professionsError ?? regionsError;
  if (error || !holder) throw new Error(error?.message ?? "Onboardingoplysningerne kunne ikke hentes");
  const decrypted = decryptRettighedshaver(holder);
  const externalIdentities: Record<ExternalIdSource, string[]> = { dfi: [], tmdb: [], wikidata: [], imdb: [] };
  for (const identity of identities ?? []) {
    const source = identity.source as ExternalIdSource;
    if (EXTERNAL_ID_SOURCES.includes(source)) externalIdentities[source].push(String(identity.external_id));
  }

  return {
    cpr_no: decrypted?.cpr_no ?? "",
    bank_account: decrypted?.bank_account ?? "",
    alternative_names: (holder.alternative_names as string[] | null) ?? [],
    portrait_url: holder.portrait_url as string | null,
    professional_start_year: holder.professional_start_year as number | null,
    primary_profession_type_id: holder.primary_profession_type_id as string | null,
    secondary_profession_type_ids: (secondary ?? []).map(row => row.profession_type_id as string),
    usual_work_mode: holder.usual_work_mode as string | null,
    primary_work_region_code: holder.primary_work_region_code as string | null,
    external_identities: externalIdentities,
    profession_types: (professionRows ?? []).map(row => ({ id: row.profession_type_id as string, name: (row.profession_types as unknown as { name?: string } | null)?.name ?? "" })).filter(row => row.name),
    work_regions: (regionRows ?? []).map(row => ({ code: row.code as string, name_da: row.name_da as string, name_en: row.name_en as string })),
  };
}

export async function getAdminRightsHolders(options: { offset?: number; limit?: number } = {}) {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, ADMIN_ROLES);
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
  kind: "work" | "contract";
};

export async function getRightsHolderRelations(rightsHolderId: string) {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, ADMIN_ROLES);
  if (!caller) throw new Error("Ikke autoriseret");
  const db = createServiceClient();
  await assertRightsHolderInOrg(db, rightsHolderId, caller.orgId);
  const [{ data: assignments, error: assignmentsError }, { data: contracts, error: contractsError }] = await Promise.all([
    db.from("work_assignments")
      .select("work_id,works(id,title,type,year)")
      .eq("org_id", caller.orgId)
      .eq("rights_holder_id", rightsHolderId),
    db.from("contracts")
      .select("id,working_title,status,works(title)")
      .eq("org_id", caller.orgId)
      .eq("rights_holder_id", rightsHolderId)
      .order("created_at", { ascending: false }),
  ]);
  if (assignmentsError || contractsError) throw new Error(assignmentsError?.message ?? contractsError?.message ?? "Relationer kunne ikke hentes");
  const workRelations = (assignments ?? []) as unknown as Array<{ work_id: string; works: { id: string; title: string; type: string | null; year: number | null } | null }>;
  const contractRelations = (contracts ?? []) as unknown as Array<{ id: string; working_title: string | null; status: string; works: { title: string } | null }>;
  return {
    works: workRelations.flatMap(row => row.works ? [{ id: row.works.id, title: row.works.title, secondary: [row.works.year, row.works.type].filter(Boolean).join(" · ") || null, kind: "work" as const }] : []),
    contracts: contractRelations.map(contract => ({ id: contract.id, title: contract.works?.title ?? contract.working_title ?? "Kontrakt uden titel", secondary: contract.status, kind: "contract" as const })),
  };
}

export async function createRettighedshaverSecure(
  input: RightsHolderInput,
  orgId: string,
  isMember: boolean,
  memberNo?: string
) {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, USER_ADMIN_ROLES);
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
  const caller = await assertAdminRole(supabase, USER_ADMIN_ROLES);
  if (!caller || caller.orgId !== orgId) return { success: false, error: "Ikke autoriseret" };

  const db = createServiceClient();
  try {
    await assertRightsHolderInOrg(db, id, orgId);
  } catch {
    return { success: false, error: "Rettighedshaveren tilhører ikke din organisation" };
  }

  const year = input.professional_start_year;
  if (year != null && (!Number.isInteger(year) || year < 1940 || year > new Date().getFullYear())) {
    return { success: false, error: "Startåret er ugyldigt" };
  }
  const allowedWorkModes = new Set(["employee", "company", "both", "other", "prefer_not_to_say"]);
  if (input.usual_work_mode && !allowedWorkModes.has(input.usual_work_mode)) {
    return { success: false, error: "Arbejdsformen er ugyldig" };
  }
  if (input.portrait_url && !/^https?:\/\//i.test(input.portrait_url.trim())) {
    return { success: false, error: "Portræt-URL skal begynde med http:// eller https://" };
  }
  const professionIds = [...new Set([input.primary_profession_type_id, ...(input.secondary_profession_type_ids ?? [])].filter((value): value is string => Boolean(value)))];
  if (professionIds.length) {
    const { data: allowedRows, error: allowedError } = await db.from("organisation_profession_types").select("profession_type_id").eq("org_id", orgId).in("profession_type_id", professionIds);
    if (allowedError) return { success: false, error: allowedError.message };
    const allowedIds = new Set((allowedRows ?? []).map(row => row.profession_type_id as string));
    if (professionIds.some(professionId => !allowedIds.has(professionId))) return { success: false, error: "En valgt faggruppe er ikke tilgængelig i organisationen" };
  }
  if (input.primary_work_region_code) {
    const { data: region, error: regionError } = await db.from("organisation_work_regions").select("code").eq("org_id", orgId).eq("code", input.primary_work_region_code).eq("active", true).maybeSingle();
    if (regionError) return { success: false, error: regionError.message };
    if (!region) return { success: false, error: "Arbejdsområdet er ikke tilgængeligt i organisationen" };
  }

  const normalizedIdentities: Record<ExternalIdSource, string[]> = { dfi: [], tmdb: [], wikidata: [], imdb: [] };
  const identityPatterns: Record<ExternalIdSource, RegExp> = {
    dfi: /^\d+$/,
    tmdb: /^\d+$/,
    wikidata: /^Q\d+$/i,
    imdb: /^nm\d+$/i,
  };
  if (input.external_identities) {
    for (const source of EXTERNAL_ID_SOURCES) {
      normalizedIdentities[source] = [...new Set((input.external_identities[source] ?? []).map(value => value.trim()).filter(Boolean))].slice(0, 12);
      if (normalizedIdentities[source].some(value => !identityPatterns[source].test(value))) return { success: false, error: `Et ${source.toUpperCase()}-id har ugyldigt format` };
    }
    const allIdentities = EXTERNAL_ID_SOURCES.flatMap(source => normalizedIdentities[source].map(externalId => ({ source, externalId })));
    if (allIdentities.length) {
      const { data: conflicts, error: conflictError } = await db.from("rights_holder_external_identities").select("source,external_id,rights_holder_id").in("external_id", allIdentities.map(identity => identity.externalId)).neq("rights_holder_id", id);
      if (conflictError) return { success: false, error: conflictError.message };
      if ((conflicts ?? []).some(conflict => allIdentities.some(identity => identity.source === conflict.source && identity.externalId.toLowerCase() === String(conflict.external_id).toLowerCase()))) {
        return { success: false, error: "Et eksternt person-id er allerede knyttet til en anden rettighedshaver" };
      }
    }
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

  if (input.secondary_profession_type_ids !== undefined) {
    const secondaryIds = [...new Set(input.secondary_profession_type_ids.filter(professionId => professionId !== input.primary_profession_type_id))].slice(0, 12);
    const { error: deleteError } = await db.from("rights_holder_profession_types").delete().eq("rights_holder_id", id);
    if (deleteError) return { success: false, error: deleteError.message };
    if (secondaryIds.length) {
      const { error: insertError } = await db.from("rights_holder_profession_types").insert(secondaryIds.map(professionTypeId => ({ rights_holder_id: id, profession_type_id: professionTypeId })));
      if (insertError) return { success: false, error: insertError.message };
    }
  }
  if (input.external_identities !== undefined) {
    const { error: deleteError } = await db.from("rights_holder_external_identities").delete().eq("rights_holder_id", id);
    if (deleteError) return { success: false, error: deleteError.message };
    const identityRows = EXTERNAL_ID_SOURCES.flatMap(source => normalizedIdentities[source].map(externalId => ({ rights_holder_id: id, source, external_id: externalId, display_name: input.full_name, match_score: 1, match_reason: "admin", selected_automatically: false })));
    if (identityRows.length) {
      const { error: insertError } = await db.from("rights_holder_external_identities").insert(identityRows);
      if (insertError) return { success: false, error: insertError.message };
    }
    await db.from("rettighedshavere").update({
      dfi_person_id: normalizedIdentities.dfi[0] ? Number(normalizedIdentities.dfi[0]) : null,
      tmdb_person_id: normalizedIdentities.tmdb[0] ? Number(normalizedIdentities.tmdb[0]) : null,
      wikidata_qid: normalizedIdentities.wikidata[0] ?? null,
      imdb_nm: normalizedIdentities.imdb[0] ?? null,
    }).eq("id", id);
  }
  revalidatePath("/admin/rettighedshavere");
  return { success: true };
}
