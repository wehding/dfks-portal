"use server";

import { createClient } from "@/lib/supabase/server";
import { encryptValue } from "@/lib/encryption";
import { revalidatePath } from "next/cache";
import { normalizeBankAccount, normalizeCpr, validateOnboardingField } from "@/lib/onboarding-validation";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePostLoginDestination } from "@/lib/auth/post-login";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { resolveOrgId } from "@/lib/org";
import { recordLegalDocumentAcceptances } from "@/lib/server/legal-document-records";

export async function completeOnboarding(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Ikke logget ind" };

  // Rettighedshaverens navn er fastlagt af invitationen. Formularfelter og
  // user_metadata må ikke kunne overskrive den kanoniske identitet.
  const { data: invitedProfile, error: profileError } = await supabase
    .from("rettighedshavere")
    .select("full_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) return { success: false, error: "Det inviterede navn kunne ikke kontrolleres." };
  const fullName = invitedProfile?.full_name?.trim() ?? "";
  if (!fullName) return { success: false, error: "Der mangler et navn på invitationen. Kontakt DFKS." };
  const loginEmail = user.email?.trim() ?? "";
  const phone = ((formData.get("phone") as string) ?? "").trim();
  const cpr = ((formData.get("cpr") as string) ?? "").trim();
  const bankAccount = ((formData.get("bank_account") as string) ?? "").trim();
  const validationError = [
    validateOnboardingField("name", fullName),
    validateOnboardingField("email", loginEmail),
    validateOnboardingField("phone", phone),
    validateOnboardingField("cpr", cpr),
    validateOnboardingField("bank_account", bankAccount),
  ].find(Boolean);
  if (validationError) return { success: false, error: validationError };
  const street = ((formData.get("address") as string) ?? "").trim();
  const zip = ((formData.get("zip") as string) ?? "").trim();
  const city = ((formData.get("city") as string) ?? "").trim();
  const address = [street, [zip, city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;

  const service = createServiceClient();
  const { data: holderContext } = await service.from("rettighedshavere")
    .select("id,org_affiliations(org_id,is_member,statistics_participation)").eq("user_id", user.id).maybeSingle();
  const orgId = await resolveOrgId(service, user.id) ?? undefined;
  const affiliations = Array.isArray(holderContext?.org_affiliations) ? holderContext.org_affiliations : [holderContext?.org_affiliations];
  const affiliation = affiliations.find(row => row?.org_id === orgId) ?? null;
  const isOrganisationMember = Boolean(affiliation?.is_member);
  const rawStatisticsChoice = String(formData.get("statistics_participation_choice") ?? "");
  if (!isOrganisationMember && rawStatisticsChoice !== "true" && rawStatisticsChoice !== "false") {
    return { success: false, error: "Vælg om dine overordnede vilkår må bruges til anonym markedsstatistik." };
  }
  const statisticsParticipation = isOrganisationMember ? true : rawStatisticsChoice === "true";
  let acceptedLegalDocumentIds: string[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("accepted_legal_document_ids") ?? "[]"));
    acceptedLegalDocumentIds = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return { success: false, error: "De accepterede rettighedstekster kunne ikke læses." };
  }
  const { data: organisation } = orgId ? await service.from("organisations").select("statistics_profile_config").eq("id", orgId).maybeSingle() : { data: null };
  const config = (organisation?.statistics_profile_config ?? {}) as Record<string, unknown>;
  const startYear = Number(formData.get("professional_start_year"));
  if (config.professional_start_year && formData.get("professional_start_year") && (!Number.isInteger(startYear) || startYear < 1940 || startYear > new Date().getFullYear())) {
    return { success: false, error: "Startåret er ugyldigt." };
  }
  const primaryProfessionTypeId = config.primary_profession_type && typeof formData.get("primary_profession_type_id") === "string" ? String(formData.get("primary_profession_type_id")) || null : null;
  if (primaryProfessionTypeId && orgId) {
    const { data: allowedProfession } = await service.from("organisation_profession_types").select("profession_type_id").eq("org_id", orgId).eq("profession_type_id", primaryProfessionTypeId).maybeSingle();
    if (!allowedProfession) return { success: false, error: "Den valgte faggruppe er ikke tilgængelig i organisationen." };
  }
  let secondaryProfessionTypeIds: string[] = [];
  if (config.secondary_profession_types && orgId) {
    try {
      const parsed = JSON.parse(String(formData.get("secondary_profession_type_ids") ?? "[]"));
      secondaryProfessionTypeIds = Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === "string" && id !== primaryProfessionTypeId))].slice(0, 12) : [];
    } catch { secondaryProfessionTypeIds = []; }
    if (secondaryProfessionTypeIds.length) {
      const { data: allowedRows } = await service.from("organisation_profession_types").select("profession_type_id").eq("org_id", orgId).in("profession_type_id", secondaryProfessionTypeIds);
      const allowed = new Set((allowedRows ?? []).map(row => row.profession_type_id as string));
      if (secondaryProfessionTypeIds.some(id => !allowed.has(id))) return { success: false, error: "En valgt faggruppe er ikke tilgængelig i organisationen." };
    }
  }
  const workMode = config.usual_work_mode && typeof formData.get("usual_work_mode") === "string" ? String(formData.get("usual_work_mode")) || null : null;
  const workRegionCode = config.primary_work_region && typeof formData.get("primary_work_region_code") === "string" ? String(formData.get("primary_work_region_code")) || null : null;
  if (workRegionCode && orgId) {
    const { data: allowedRegion } = await service.from("organisation_work_regions").select("code").eq("org_id", orgId).eq("code", workRegionCode).eq("active", true).maybeSingle();
    if (!allowedRegion) return { success: false, error: "Det valgte arbejdsområde er ikke tilgængeligt." };
  }

  if (!holderContext?.id || !orgId) {
    return { success: false, error: "Din organisationstilknytning blev ikke fundet." };
  }
  const { data: onboardingSaved, error: onboardingError } = await service.rpc(
    "complete_member_onboarding",
    {
      actor_user_id: user.id,
      target_rights_holder_id: holderContext.id,
      target_org_id: orgId,
      login_email: loginEmail,
      phone_value: phone,
      address_value: address ?? "",
      encrypted_cpr: encryptValue(cpr ? normalizeCpr(cpr) : null) ?? "",
      encrypted_bank_account: encryptValue(bankAccount ? normalizeBankAccount(bankAccount) : null) ?? "",
      gender_value: String(formData.get("gender") ?? ""),
      participates: statisticsParticipation,
      start_year: config.professional_start_year && Number.isInteger(startYear) ? startYear : null,
      primary_profession_id: primaryProfessionTypeId,
      secondary_profession_ids: secondaryProfessionTypeIds,
      work_mode: workMode,
      work_region_code: workRegionCode,
    },
  );
  if (onboardingError || !onboardingSaved) {
    console.error("Onboarding: den atomiske profilopdatering fejlede", { code: onboardingError?.code ?? "rejected" });
    return { success: false, error: "Onboarding kunne ikke gemmes samlet. Ingen ændringer er gennemført. Prøv igen." };
  }

  try {
    await recordLegalDocumentAcceptances(service, {
      userId: user.id,
      rightsHolderId: holderContext.id,
      orgId,
      audience: isOrganisationMember ? "member" : "non_member",
      acceptedDocumentIds: acceptedLegalDocumentIds,
    });
    await service.from("org_affiliations").update({
      statistics_participation: statisticsParticipation,
      statistics_participation_source: isOrganisationMember ? "member_default" : "non_member_onboarding_choice",
      statistics_participation_updated_at: new Date().toISOString(),
      statistics_participation_updated_by: user.id,
    }).eq("org_id", orgId).eq("rights_holder_id", holderContext.id);
  } catch (error) {
    await service.from("rettighedshavere")
      .update({ onboarding_required_at: new Date().toISOString() })
      .eq("id", holderContext.id);
    return { success: false, error: error instanceof Error ? error.message : "Rettighedsteksterne kunne ikke registreres." };
  }

  try {
    await recordAuditEvent({
      context: { actorUserId: user.id, actorOrgId: orgId ?? null, actorRole: "member", source: "portal" },
      action: "complete_onboarding",
      entityType: "rettighedshavere",
      entityId: holderContext?.id ?? null,
      entityLabel: fullName,
      orgIds: orgId ? [orgId] : [],
    });
  } catch {
    // Række-triggeren har allerede registreret statusændringen. Auditfejl må ikke
    // sende brugeren gennem et færdiggjort onboardingforløb igen.
    console.error("Onboarding: den semantiske auditregistrering fejlede");
  }

  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/portal/min-profil");
  return { success: true as const, destination: await resolvePostLoginDestination(supabase, user.id, user.last_sign_in_at) };
}

export async function updateSensitiveMemberProfile(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Ikke logget ind" };

  const cpr = ((formData.get("cpr") as string) ?? "").trim();
  const bankAccount = ((formData.get("bank_account") as string) ?? "").trim();
  const validationError = [
    validateOnboardingField("cpr", cpr),
    validateOnboardingField("bank_account", bankAccount),
  ].find(Boolean);
  if (validationError) return { success: false, error: validationError };

  const updates: { cpr_no?: string | null; bank_account?: string | null } = {};
  if (cpr) updates.cpr_no = encryptValue(normalizeCpr(cpr));
  if (bankAccount) updates.bank_account = encryptValue(normalizeBankAccount(bankAccount));
  if (!Object.keys(updates).length) return { success: true, updated: false };

  const { error } = await supabase
    .from("rettighedshavere")
    .update(updates)
    .eq("user_id", user.id);
  if (error) {
    console.error("Profil: følsomme oplysninger kunne ikke gemmes", error);
    return { success: false, error: "CPR- eller bankoplysningerne kunne ikke gemmes." };
  }

  revalidatePath("/portal/min-profil");
  return { success: true, updated: true };
}

export async function getMemberStatisticsProfile() {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return { success: false as const, error: "Ikke logget ind" };
  const db = createServiceClient();
  const { data: holder } = await db.from("rettighedshavere").select("id,opt_out_statistics,professional_start_year,primary_profession_type_id,usual_work_mode,primary_work_region_code,org_affiliations(org_id,is_member,statistics_participation)").eq("user_id", user.id).maybeSingle();
  if (!holder) return { success: false as const, error: "Profilen blev ikke fundet" };
  const orgId = await resolveOrgId(db, user.id);
  const affiliations = Array.isArray(holder.org_affiliations) ? holder.org_affiliations : [holder.org_affiliations];
  const affiliation = affiliations.find(row => row?.org_id === orgId) ?? null;
  const [{ data: organisation }, { data: professions }, { data: regions }, { data: secondaryProfessions }] = await Promise.all([
    orgId ? db.from("organisations").select("statistics_profile_config,statistics_minimum_group_size,terminology").eq("id", orgId).maybeSingle() : Promise.resolve({ data: null }),
    orgId ? db.from("organisation_profession_types").select("profession_type_id,display_order,profession_types(name)").eq("org_id", orgId).order("display_order") : Promise.resolve({ data: [] }),
    orgId ? db.from("organisation_work_regions").select("code,name_da,name_en").eq("org_id", orgId).eq("active", true).order("display_order") : Promise.resolve({ data: [] }),
    db.from("rights_holder_profession_types").select("profession_type_id").eq("rights_holder_id", holder.id),
  ]);
  return {
    success: true as const,
    profile: {
      optOutStatistics: Boolean(affiliation?.is_member) ? false : typeof affiliation?.statistics_participation === "boolean"
        ? !affiliation.statistics_participation
        : Boolean(holder.opt_out_statistics),
      isOrganisationMember: Boolean(affiliation?.is_member),
      professionalStartYear: holder.professional_start_year as number | null,
      primaryProfessionTypeId: holder.primary_profession_type_id as string | null,
      usualWorkMode: holder.usual_work_mode as string | null,
      primaryWorkRegionCode: holder.primary_work_region_code as string | null,
      secondaryProfessionTypeIds: (secondaryProfessions ?? []).map(row => row.profession_type_id as string),
    },
    config: (organisation?.statistics_profile_config ?? {}) as Record<string, boolean>,
    minimumGroupSize: Number(organisation?.statistics_minimum_group_size ?? 5),
    professionLabel: ((organisation?.terminology as { role_labels?: string[] } | null)?.role_labels?.[0] ?? "faget"),
    professionTypes: (professions ?? []).map(row => ({ id: row.profession_type_id as string, name: (row.profession_types as unknown as { name?: string } | null)?.name ?? "" })).filter(row => row.name),
    workRegions: (regions ?? []).map(row => ({ code: row.code as string, nameDa: row.name_da as string, nameEn: row.name_en as string })),
  };
}

export async function updateMemberStatisticsProfile(input: {
  optOutStatistics: boolean;
  professionalStartYear?: number | null;
  primaryProfessionTypeId?: string | null;
  secondaryProfessionTypeIds?: string[];
  usualWorkMode?: string | null;
  primaryWorkRegionCode?: string | null;
}) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return { success: false, error: "Ikke logget ind" };
  const db = createServiceClient();
  const current = await getMemberStatisticsProfile();
  if (!current.success) return current;
  const year = input.professionalStartYear == null ? null : Number(input.professionalStartYear);
  if (year != null && (!Number.isInteger(year) || year < 1940 || year > new Date().getFullYear())) return { success: false, error: "Startåret er ugyldigt." };
  const allowedProfession = !input.primaryProfessionTypeId || current.professionTypes.some(option => option.id === input.primaryProfessionTypeId);
  const allowedRegion = !input.primaryWorkRegionCode || current.workRegions.some(option => option.code === input.primaryWorkRegionCode);
  const secondaryIds = current.config.secondary_profession_types ? [...new Set((input.secondaryProfessionTypeIds ?? []).filter(id => id !== input.primaryProfessionTypeId))].slice(0, 12) : [];
  const allowedSecondary = secondaryIds.every(id => current.professionTypes.some(option => option.id === id));
  if (!allowedProfession || !allowedRegion || !allowedSecondary) return { success: false, error: "Et statistikvalg er ikke tilgængeligt i organisationen." };
  const { data: holder } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).maybeSingle();
  const orgId = await resolveOrgId(db, user.id);
  if (!holder || !orgId) return { success: false, error: "Profilen er ikke knyttet til en organisation." };
  const participates = current.profile.isOrganisationMember ? true : !Boolean(input.optOutStatistics);
  const { data: updated, error } = await db.rpc("update_member_statistics_profile", {
    target_rights_holder_id: holder.id,
    target_org_id: orgId,
    actor_user_id: user.id,
    participates,
    start_year: current.config.professional_start_year ? year : null,
    primary_profession_id: current.config.primary_profession_type ? input.primaryProfessionTypeId || null : null,
    secondary_profession_ids: secondaryIds,
    work_mode: current.config.usual_work_mode ? input.usualWorkMode || null : null,
    work_region_code: current.config.primary_work_region ? input.primaryWorkRegionCode || null : null,
  });
  if (error || !updated) return { success: false, error: "Statistikindstillingerne kunne ikke gemmes samlet." };
  await db.from("org_affiliations").update({
    statistics_participation: participates,
    statistics_participation_source: current.profile.isOrganisationMember ? "member_default" : "non_member_profile_choice",
    statistics_participation_updated_at: new Date().toISOString(),
    statistics_participation_updated_by: user.id,
  }).eq("org_id", orgId).eq("rights_holder_id", holder.id);
  revalidatePath("/portal");
  revalidatePath("/portal/min-profil");
  return { success: true };
}
