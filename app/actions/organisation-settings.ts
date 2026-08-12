"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import type { OrgBranding, OrgTerminology } from "@/lib/db/types";
import { resolveDefaultRoleLabel } from "@/lib/branding";
import { normalizeSingleEmail } from "@/lib/email/mime";
import { getForeningLetIntegration, testForeningLetCredentials, upsertForeningLetIntegration } from "@/lib/org-integrations";

const LOGO_BUCKET = "organisation-logos";
const LOGO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_LOGO_SIZE = 2 * 1024 * 1024;

type OrganisationSettingsPayload = {
  short_name: string;
  long_name: string;
  logo_url: string | null;
  primary_color: string;
  from_email: string | null;
  invite_email_text: string | null;
  invite_reminder_text: string | null;
  welcome_message_text: string | null;
  coeditor_word: string;
  role_labels: string[];
  default_role_label: string;
  producer_categories: string[];
  statistics_contract_scope: "validated_only" | "validated_and_drafts";
  statistics_profile_config: {
    professional_start_year: boolean;
    primary_profession_type: boolean;
    secondary_profession_types: boolean;
    usual_work_mode: boolean;
    primary_work_region: boolean;
  };
  statistics_work_regions: string[];
  onboarding_keywords: string[];
  contract_review_retention_months: number;
  foreninglet_base_url?: string | null;
  foreninglet_username?: string | null;
  foreninglet_password?: string | null;
  foreninglet_enabled?: boolean;
};

const ADMIN_ORG_ROLES = ["superadmin", "admin", "org-admin"] as const;

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanOptionalString(value: unknown) {
  const cleaned = cleanString(value);
  return cleaned || null;
}

function normalizeColor(value: string) {
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value) ? value : "#111827";
}

function normalizeRoles(value: unknown): string[] {
  const rows = Array.isArray(value) ? value : [];
  const cleaned = rows.map(cleanString).filter(Boolean);
  return Array.from(new Set(cleaned)).slice(0, 12);
}

async function currentAdminOrg() {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES);
  if (!caller?.orgId) throw new Error("Din bruger er ikke knyttet til en organisation.");
  return caller.orgId;
}

export async function getOrganisationSettings() {
  const orgId = await currentAdminOrg();
  const db = createServiceClient();
  const { data, error } = await db
    .from("organisations")
    .select("id, name, logo_url, from_email, invite_email_text, invite_reminder_text, welcome_message_text, branding, terminology, contract_review_retention_months, contract_review_retention_updated_at, statistics_contract_scope, statistics_profile_config")
    .eq("id", orgId)
    .single();

  if (error || !data) throw new Error(error?.message ?? "Organisationen blev ikke fundet.");

  const branding = (data.branding ?? {}) as OrgBranding;
  const terminology = (data.terminology ?? {}) as OrgTerminology;

  const foreninglet = await getForeningLetIntegration(db, orgId);
  const [{ data: professionRows }, { data: producerRows }, { data: workRegionRows }] = await Promise.all([
    db.from("organisation_profession_types").select("display_order,profession_types(name)").eq("org_id", orgId).order("display_order"),
    db.from("organisation_producer_types").select("display_order,producer_types(name)").eq("org_id", orgId).order("display_order"),
    db.from("organisation_work_regions").select("name_da").eq("org_id", orgId).eq("active", true).order("display_order"),
  ]);
  const professionTypes = (professionRows ?? []).map(row => (row.profession_types as unknown as { name?: string } | null)?.name).filter((name): name is string => Boolean(name));
  const producerCategories = (producerRows ?? []).map(row => (row.producer_types as unknown as { name?: string } | null)?.name).filter((name): name is string => Boolean(name));
  const roleLabels = professionTypes.length ? professionTypes : terminology.role_labels?.length
    ? terminology.role_labels
    : ["Medskaber"];

  return {
    id: data.id as string,
    name: data.name as string,
    logo_url: (data.logo_url as string | null) ?? null,
    from_email: (data.from_email as string | null) ?? null,
    invite_email_text: (data.invite_email_text as string | null) ?? null,
    invite_reminder_text: (data.invite_reminder_text as string | null) ?? null,
    welcome_message_text: (data.welcome_message_text as string | null) ?? null,
    short_name: branding.short_name ?? data.name,
    long_name: branding.long_name ?? data.name,
    primary_color: branding.primary_color ?? "#111827",
    coeditor_word: terminology.coeditor_word ?? "medskaber",
    member_word: terminology.member_word ?? "medlem",
    role_labels: roleLabels,
    default_role_label: resolveDefaultRoleLabel(roleLabels, terminology.default_role_label),
    producer_categories: producerCategories,
    onboarding_keywords: terminology.onboarding_keywords?.length
      ? terminology.onboarding_keywords
      : ["klip", "edit"],
    contract_review_retention_months: data.contract_review_retention_months ?? 24,
    contract_review_retention_updated_at: data.contract_review_retention_updated_at ?? null,
    statistics_contract_scope: data.statistics_contract_scope === "validated_and_drafts" ? "validated_and_drafts" as const : "validated_only" as const,
    statistics_profile_config: {
      professional_start_year: (data.statistics_profile_config as Record<string, unknown> | null)?.professional_start_year !== false,
      primary_profession_type: Boolean((data.statistics_profile_config as Record<string, unknown> | null)?.primary_profession_type),
      secondary_profession_types: Boolean((data.statistics_profile_config as Record<string, unknown> | null)?.secondary_profession_types),
      usual_work_mode: Boolean((data.statistics_profile_config as Record<string, unknown> | null)?.usual_work_mode),
      primary_work_region: Boolean((data.statistics_profile_config as Record<string, unknown> | null)?.primary_work_region),
    },
    statistics_work_regions: (workRegionRows ?? []).map(row => row.name_da as string),
    foreninglet,
  };
}

export async function updateOrganisationSettings(payload: OrganisationSettingsPayload) {
  const orgId = await currentAdminOrg();
  const db = createServiceClient();
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();

  const shortName = cleanString(payload.short_name);
  const longName = cleanString(payload.long_name);
  const coeditorWord = cleanString(payload.coeditor_word);
  const roleLabels = normalizeRoles(payload.role_labels);
  const requestedDefaultRole = cleanString(payload.default_role_label);
  const producerCategories = normalizeRoles(payload.producer_categories);
  const onboardingKeywords = normalizeRoles(payload.onboarding_keywords).map(keyword => keyword.toLowerCase());
  const replyToEmail = cleanOptionalString(payload.from_email);
  const retentionMonths = Number(payload.contract_review_retention_months);
  const statisticsContractScope = payload.statistics_contract_scope === "validated_and_drafts" ? "validated_and_drafts" : "validated_only";
  const statisticsProfileConfig = {
    professional_start_year: Boolean(payload.statistics_profile_config?.professional_start_year),
    primary_profession_type: Boolean(payload.statistics_profile_config?.primary_profession_type),
    secondary_profession_types: Boolean(payload.statistics_profile_config?.primary_profession_type && payload.statistics_profile_config?.secondary_profession_types),
    usual_work_mode: Boolean(payload.statistics_profile_config?.usual_work_mode),
    primary_work_region: Boolean(payload.statistics_profile_config?.primary_work_region),
  };
  const statisticsWorkRegions = normalizeRoles(payload.statistics_work_regions).slice(0, 30);

  if (!shortName || !longName) throw new Error("Kort navn og fuldt navn skal udfyldes.");
  if (!coeditorWord) throw new Error("Fagordet skal udfyldes.");
  if (roleLabels.length === 0) throw new Error("Der skal være mindst én rollebetegnelse.");
  const defaultRoleLabel = roleLabels.find(role => role.localeCompare(requestedDefaultRole, "da", { sensitivity: "base" }) === 0);
  if (!defaultRoleLabel) throw new Error("Standardfaggruppen skal være en af organisationens faggrupper.");
  if (onboardingKeywords.length === 0) throw new Error("Der skal være mindst ét onboarding-søgeord.");
  if (!Number.isInteger(retentionMonths) || retentionMonths < 1 || retentionMonths > 120) throw new Error("Opbevaringsperioden skal være mellem 1 og 120 måneder.");
  if (replyToEmail) {
    try {
      normalizeSingleEmail(replyToEmail);
    } catch {
      throw new Error("Svaradressen skal være én gyldig e-mailadresse uden afsendernavn.");
    }
  }

  const branding: OrgBranding = {
    short_name: shortName,
    long_name: longName,
    primary_color: normalizeColor(payload.primary_color),
  };
  const terminology: OrgTerminology = {
    member_word: "medlem",
    coeditor_word: coeditorWord,
    role_labels: roleLabels,
    default_role_label: defaultRoleLabel,
    onboarding_keywords: onboardingKeywords,
  };

  const { error } = await db
    .from("organisations")
    .update({
      name: longName,
      logo_url: cleanOptionalString(payload.logo_url),
      from_email: replyToEmail,
      invite_email_text: cleanOptionalString(payload.invite_email_text),
      invite_reminder_text: cleanOptionalString(payload.invite_reminder_text),
      welcome_message_text: cleanOptionalString(payload.welcome_message_text),
      branding,
      terminology,
      contract_review_retention_months: retentionMonths,
      contract_review_retention_updated_at: new Date().toISOString(),
      contract_review_retention_updated_by: user?.id ?? null,
      statistics_contract_scope: statisticsContractScope,
      statistics_profile_config: statisticsProfileConfig,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);

  if (error) throw new Error(error.message);

  async function replaceOrganisationTypes(table: "profession_types", relationTable: "organisation_profession_types", foreignKey: "profession_type_id", names: string[]) {
    const ids: string[] = [];
    for (const name of names) {
      const { data: typeRow, error: typeError } = await db.from(table)
        .upsert({ name }, { onConflict: "normalized_name" })
        .select("id").single();
      if (typeError || !typeRow) throw new Error(typeError?.message ?? "Typen kunne ikke gemmes.");
      ids.push(typeRow.id as string);
    }
    const { error: deleteError } = await db.from(relationTable).delete().eq("org_id", orgId);
    if (deleteError) throw new Error(deleteError.message);
    if (ids.length) {
      const { error: relationError } = await db.from(relationTable).insert(ids.map((id, index) => ({ org_id: orgId, [foreignKey]: id, display_order: index })));
      if (relationError) throw new Error(relationError.message);
    }
  }
  await replaceOrganisationTypes("profession_types", "organisation_profession_types", "profession_type_id", roleLabels);
  const producerTypeResult = await db.rpc("replace_organisation_producer_types", {
    target_org_id: orgId,
    target_names: producerCategories,
  });
  if (producerTypeResult.error) throw new Error(producerTypeResult.error.message);

  const regionCode = (name: string) => name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("da")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  const { error: regionDeleteError } = await db.from("organisation_work_regions").delete().eq("org_id", orgId);
  if (regionDeleteError) throw new Error(regionDeleteError.message);
  if (statisticsProfileConfig.primary_work_region && statisticsWorkRegions.length) {
    const usedCodes = new Set<string>();
    const regions = statisticsWorkRegions.map((name, index) => {
      const baseCode = regionCode(name) || "omraade";
      let code = baseCode;
      let suffix = 2;
      while (usedCodes.has(code)) code = `${baseCode}_${suffix++}`;
      usedCodes.add(code);
      return {
      org_id: orgId,
      code,
      name_da: name,
      name_en: name,
      display_order: index,
      };
    });
    const { error: regionError } = await db.from("organisation_work_regions").insert(regions);
    if (regionError) throw new Error(regionError.message);
  }

  await upsertForeningLetIntegration(db, orgId, {
    base_url: payload.foreninglet_base_url,
    username: payload.foreninglet_username,
    password: payload.foreninglet_password,
    enabled: payload.foreninglet_enabled ?? true,
  });

  revalidatePath("/admin/organisation");
  revalidatePath("/admin");
  revalidatePath("/portal");
  return { success: true };
}

export async function uploadOrganisationLogo(formData: FormData) {
  const orgId = await currentAdminOrg();
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) throw new Error("Vælg en logofil.");
  if (!LOGO_TYPES[file.type]) throw new Error("Logoet skal være PNG, JPG eller WebP.");
  if (file.size > MAX_LOGO_SIZE) throw new Error("Logoet må højst fylde 2 MB.");

  const db = createServiceClient();
  const folder = orgId;
  const { data: existing } = await db.storage.from(LOGO_BUCKET).list(folder);
  if (existing?.length) {
    await db.storage.from(LOGO_BUCKET).remove(existing.map(item => `${folder}/${item.name}`));
  }

  const path = `${folder}/logo.${LOGO_TYPES[file.type]}`;
  const { error: uploadError } = await db.storage
    .from(LOGO_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: true });
  if (uploadError) throw new Error(uploadError.message);

  const { data: publicUrl } = db.storage.from(LOGO_BUCKET).getPublicUrl(path);
  const logoUrl = `${publicUrl.publicUrl}?v=${Date.now()}`;
  const { error } = await db.from("organisations").update({ logo_url: logoUrl }).eq("id", orgId);
  if (error) throw new Error(error.message);

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/portal");
  return { success: true, logo_url: logoUrl };
}

export async function removeOrganisationLogo() {
  const orgId = await currentAdminOrg();
  const db = createServiceClient();
  const { data: existing } = await db.storage.from(LOGO_BUCKET).list(orgId);
  if (existing?.length) {
    const { error: removeError } = await db.storage
      .from(LOGO_BUCKET)
      .remove(existing.map(item => `${orgId}/${item.name}`));
    if (removeError) throw new Error(removeError.message);
  }
  const { error } = await db.from("organisations").update({ logo_url: null }).eq("id", orgId);
  if (error) throw new Error(error.message);

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/portal");
  return { success: true };
}

export async function testOrganisationForeningLetConnection() {
  const orgId = await currentAdminOrg();
  const result = await testForeningLetCredentials(createServiceClient(), orgId);
  return { success: true, ...result };
}
