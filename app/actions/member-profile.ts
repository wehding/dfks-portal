"use server";

import { createClient } from "@/lib/supabase/server";
import { encryptValue } from "@/lib/encryption";
import { revalidatePath } from "next/cache";
import { normalizeBankAccount, normalizeCpr, validateOnboardingField } from "@/lib/onboarding-validation";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePostLoginDestination } from "@/lib/auth/post-login";
import { recordAuditEvent } from "@/lib/audit-log-server";

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
    .select("id,org_affiliations(org_id)").eq("user_id", user.id).maybeSingle();
  const affiliation = Array.isArray(holderContext?.org_affiliations) ? holderContext.org_affiliations[0] : holderContext?.org_affiliations;
  const orgId = affiliation?.org_id as string | undefined;
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

  let { error } = await supabase
    .from("rettighedshavere")
    .update({
      email: loginEmail,
      phone: phone || null,
      address,
      cpr_no: encryptValue(cpr ? normalizeCpr(cpr) : null),
      bank_account: encryptValue(bankAccount ? normalizeBankAccount(bankAccount) : null),
      gender: (formData.get("gender") as string) || null,
      opt_out_statistics: formData.get("opt_out_statistics") === "true",
      professional_start_year: config.professional_start_year && Number.isInteger(startYear) ? startYear : null,
      primary_profession_type_id: primaryProfessionTypeId,
      usual_work_mode: workMode,
      primary_work_region_code: workRegionCode,
    })
    .eq("user_id", user.id);

  if (error && error.message.includes("gender")) {
    console.warn("Gender column not found in database schema, retrying without gender field...");
    const retry = await supabase
      .from("rettighedshavere")
      .update({
        email: loginEmail,
        phone: phone || null,
        address,
        cpr_no: encryptValue(cpr ? normalizeCpr(cpr) : null),
        bank_account: encryptValue(bankAccount ? normalizeBankAccount(bankAccount) : null),
        opt_out_statistics: formData.get("opt_out_statistics") === "true",
      })
      .eq("user_id", user.id);
    
    error = retry.error;
  }

  if (error) {
    console.error("Onboarding fejl:", error);
    return { success: false, error: `Kunne ikke gemme onboarding-data: ${error.message} (${error.code})` };
  }

  if (holderContext?.id) {
    const { error: deleteProfessionError } = await service.from("rights_holder_profession_types").delete().eq("rights_holder_id", holderContext.id);
    if (deleteProfessionError) return { success: false, error: "Yderligere faggrupper kunne ikke gemmes." };
    if (secondaryProfessionTypeIds.length) {
      const { error: professionError } = await service.from("rights_holder_profession_types").insert(secondaryProfessionTypeIds.map(id => ({ rights_holder_id: holderContext.id, profession_type_id: id })));
      if (professionError) return { success: false, error: "Yderligere faggrupper kunne ikke gemmes." };
    }
  }

  const completedAt = new Date().toISOString();
  const { error: completionError } = await supabase
    .from("rettighedshavere")
    .update({
      onboarding_completed: true,
      onboarding_completed_at: completedAt,
      onboarding_required_at: null,
    })
    .eq("user_id", user.id);
  if (completionError) return { success: false as const, error: "Onboarding blev gemt, men kunne ikke markeres som færdig. Prøv igen." };

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
  const { data: holder } = await db.from("rettighedshavere").select("id,opt_out_statistics,professional_start_year,primary_profession_type_id,usual_work_mode,primary_work_region_code,org_affiliations(org_id)").eq("user_id", user.id).maybeSingle();
  if (!holder) return { success: false as const, error: "Profilen blev ikke fundet" };
  const affiliation = Array.isArray(holder.org_affiliations) ? holder.org_affiliations[0] : holder.org_affiliations;
  const orgId = affiliation?.org_id as string | undefined;
  const [{ data: organisation }, { data: professions }, { data: regions }, { data: secondaryProfessions }] = await Promise.all([
    orgId ? db.from("organisations").select("statistics_profile_config,terminology").eq("id", orgId).maybeSingle() : Promise.resolve({ data: null }),
    orgId ? db.from("organisation_profession_types").select("profession_type_id,display_order,profession_types(name)").eq("org_id", orgId).order("display_order") : Promise.resolve({ data: [] }),
    orgId ? db.from("organisation_work_regions").select("code,name_da,name_en").eq("org_id", orgId).eq("active", true).order("display_order") : Promise.resolve({ data: [] }),
    db.from("rights_holder_profession_types").select("profession_type_id").eq("rights_holder_id", holder.id),
  ]);
  return {
    success: true as const,
    profile: {
      optOutStatistics: Boolean(holder.opt_out_statistics),
      professionalStartYear: holder.professional_start_year as number | null,
      primaryProfessionTypeId: holder.primary_profession_type_id as string | null,
      usualWorkMode: holder.usual_work_mode as string | null,
      primaryWorkRegionCode: holder.primary_work_region_code as string | null,
      secondaryProfessionTypeIds: (secondaryProfessions ?? []).map(row => row.profession_type_id as string),
    },
    config: (organisation?.statistics_profile_config ?? {}) as Record<string, boolean>,
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
  const { error } = await db.from("rettighedshavere").update({
    opt_out_statistics: Boolean(input.optOutStatistics),
    professional_start_year: current.config.professional_start_year ? year : null,
    primary_profession_type_id: current.config.primary_profession_type ? input.primaryProfessionTypeId || null : null,
    usual_work_mode: current.config.usual_work_mode ? input.usualWorkMode || null : null,
    primary_work_region_code: current.config.primary_work_region ? input.primaryWorkRegionCode || null : null,
  }).eq("user_id", user.id);
  if (error) return { success: false, error: "Statistikindstillingerne kunne ikke gemmes." };
  const { data: holder } = await db.from("rettighedshavere").select("id").eq("user_id", user.id).maybeSingle();
  if (holder) {
    const { error: deleteError } = await db.from("rights_holder_profession_types").delete().eq("rights_holder_id", holder.id);
    if (deleteError) return { success: false, error: "Yderligere faggrupper kunne ikke gemmes." };
    if (secondaryIds.length) {
      const { error: insertError } = await db.from("rights_holder_profession_types").insert(secondaryIds.map(id => ({ rights_holder_id: holder.id, profession_type_id: id })));
      if (insertError) return { success: false, error: "Yderligere faggrupper kunne ikke gemmes." };
    }
  }
  revalidatePath("/portal");
  revalidatePath("/portal/min-profil");
  return { success: true };
}
