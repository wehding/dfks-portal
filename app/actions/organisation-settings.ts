"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import type { OrgBranding, OrgTerminology } from "@/lib/db/types";
import { resolveDefaultRoleLabel } from "@/lib/branding";
import { normalizeSingleEmail } from "@/lib/email/mime";
import { getGmailConfigurationStatus } from "@/lib/email/gmail-core";
import { getForeningLetIntegration, testForeningLetCredentials, upsertForeningLetIntegration } from "@/lib/org-integrations";
import { recordAuditEvent } from "@/lib/audit-log-server";
import type { FilterRule } from "@/lib/streaming-types";
import { unknownOrganisationPlaceholders, type OrganisationTextTemplateId } from "@/lib/organisation-text-templates";
import {
  MEMBER_WORK_INVITE_SUBJECT,
  MEMBER_WORK_INVITE_TEXT,
  NON_MEMBER_WORK_INVITE_SUBJECT,
  NON_MEMBER_WORK_INVITE_TEXT,
} from "@/lib/rights-holder-invitation-templates";
import { DEFAULT_BETA_INVITE_SUBJECT, DEFAULT_BETA_INVITE_TEXT } from "@/lib/beta-test";
import {
  DEFAULT_STATISTICS_DOMINANCE_LIMIT,
  MAX_STATISTICS_DOMINANCE_LIMIT,
  MAX_STATISTICS_MINIMUM_GROUP_SIZE,
  MIN_STATISTICS_DOMINANCE_LIMIT,
  MIN_STATISTICS_MINIMUM_GROUP_SIZE,
  normalizeStatisticsDominanceLimit,
  normalizeStatisticsMinimumGroupSize,
} from "@/lib/statistics-privacy";

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
  coeditor_word: string;
  role_labels: string[];
  default_role_label: string;
  producer_categories: string[];
  statistics_contract_scope: "validated_only" | "validated_and_drafts";
  statistics_minimum_group_size: number;
  statistics_dominance_limit: number;
  confirm_low_statistics_threshold?: boolean;
  confirm_high_statistics_dominance?: boolean;
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
  legacy_contract_declaration_enabled: boolean;
  legacy_contract_cutoff_year: number | null;
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
  const [organisationResult, foreninglet, { data: professionRows }, { data: producerRows }, { data: workRegionRows }] = await Promise.all([
    db.from("organisations")
      .select("id, name, logo_url, from_email, branding, terminology, contract_review_retention_months, contract_review_retention_updated_at, statistics_contract_scope, statistics_minimum_group_size, statistics_dominance_limit, statistics_profile_config, legacy_contract_declaration_enabled, legacy_contract_cutoff_year")
      .eq("id", orgId)
      .single(),
    getForeningLetIntegration(db, orgId),
    db.from("organisation_profession_types").select("display_order,profession_types(name)").eq("org_id", orgId).order("display_order"),
    db.from("organisation_producer_types").select("display_order,producer_types(name)").eq("org_id", orgId).order("display_order"),
    db.from("organisation_work_regions").select("name_da").eq("org_id", orgId).eq("active", true).order("display_order"),
  ]);
  const { data, error } = organisationResult;
  if (error || !data) throw new Error(error?.message ?? "Organisationen blev ikke fundet.");

  const branding = (data.branding ?? {}) as OrgBranding;
  const terminology = (data.terminology ?? {}) as OrgTerminology;
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
    legacy_contract_declaration_enabled: Boolean(data.legacy_contract_declaration_enabled),
    legacy_contract_cutoff_year: data.legacy_contract_cutoff_year == null ? null : Number(data.legacy_contract_cutoff_year),
    statistics_contract_scope: data.statistics_contract_scope === "validated_and_drafts" ? "validated_and_drafts" as const : "validated_only" as const,
    statistics_minimum_group_size: normalizeStatisticsMinimumGroupSize(data.statistics_minimum_group_size),
    statistics_dominance_limit: normalizeStatisticsDominanceLimit(data.statistics_dominance_limit),
    statistics_profile_config: {
      professional_start_year: (data.statistics_profile_config as Record<string, unknown> | null)?.professional_start_year !== false,
      primary_profession_type: Boolean((data.statistics_profile_config as Record<string, unknown> | null)?.primary_profession_type),
      secondary_profession_types: false,
      usual_work_mode: (data.statistics_profile_config as Record<string, unknown> | null)?.usual_work_mode !== false,
      primary_work_region: Boolean((data.statistics_profile_config as Record<string, unknown> | null)?.primary_work_region),
    },
    statistics_work_regions: (workRegionRows ?? []).map(row => row.name_da as string),
    mail_delivery_status: getGmailConfigurationStatus({
      GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL,
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
      GOOGLE_GMAIL_SENDER: process.env.GOOGLE_GMAIL_SENDER,
    }),
    foreninglet,
  };
}

export async function getOrganisationTextSettings() {
  const orgId = await currentAdminOrg();
  const db = createServiceClient();
  let { data, error } = await db
    .from("organisations")
    .select("invite_email_text,invite_reminder_text,beta_invite_subject,beta_invite_text,beta_default_duration_days,member_work_invite_subject,member_work_invite_text,non_member_work_invite_subject,non_member_work_invite_text,welcome_message_text")
    .eq("id", orgId)
    .single();
  if (error && ["42703", "PGRST204"].includes(error.code) && error.message.includes("beta_invite")) {
    const fallback = await db.from("organisations")
      .select("invite_email_text,invite_reminder_text,member_work_invite_subject,member_work_invite_text,non_member_work_invite_subject,non_member_work_invite_text,welcome_message_text")
      .eq("id", orgId)
      .single();
    data = fallback.data ? { ...fallback.data, beta_invite_subject: null, beta_invite_text: null, beta_default_duration_days: 10 } : null;
    error = fallback.error;
  }
  if (error || !data) throw new Error(error?.message ?? "Tekstskabelonerne blev ikke fundet.");

  return {
    invite: { subject: null, body: data.invite_email_text ?? "", durationDays: null },
    reminder: { subject: null, body: data.invite_reminder_text ?? "", durationDays: null },
    beta_invite: { subject: data.beta_invite_subject ?? DEFAULT_BETA_INVITE_SUBJECT, body: data.beta_invite_text ?? DEFAULT_BETA_INVITE_TEXT, durationDays: Number(data.beta_default_duration_days ?? 10) },
    member_work_invite: { subject: data.member_work_invite_subject ?? MEMBER_WORK_INVITE_SUBJECT, body: data.member_work_invite_text ?? MEMBER_WORK_INVITE_TEXT, durationDays: null },
    non_member_work_invite: { subject: data.non_member_work_invite_subject ?? NON_MEMBER_WORK_INVITE_SUBJECT, body: data.non_member_work_invite_text ?? NON_MEMBER_WORK_INVITE_TEXT, durationDays: null },
    welcome: { subject: null, body: data.welcome_message_text ?? "", durationDays: null },
  };
}

export async function updateOrganisationTextTemplate(payload: {
  templateId: OrganisationTextTemplateId;
  subject: string | null;
  body: string;
  durationDays?: number | null;
}) {
  const orgId = await currentAdminOrg();
  const db = createServiceClient();
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  const subject = payload.subject == null ? null : payload.subject.trim().slice(0, 240);
  const body = payload.body.trim().slice(0, 30_000);
  if (subject?.includes("\n")) throw new Error("Emnet må kun fylde én linje.");
  const unknown = unknownOrganisationPlaceholders(payload.templateId, subject ?? "", body);
  if (unknown.length) throw new Error(`Ukendte pladsholdere: ${unknown.map(value => `{${value}}`).join(", ")}.`);

  const update: Record<string, string | number | null> = { updated_at: new Date().toISOString() };
  if (payload.templateId === "invite") update.invite_email_text = cleanOptionalString(body);
  if (payload.templateId === "reminder") update.invite_reminder_text = cleanOptionalString(body);
  if (payload.templateId === "welcome") update.welcome_message_text = cleanOptionalString(body);
  if (payload.templateId === "member_work_invite") {
    if (!subject || !body) throw new Error("Emne og tekst skal udfyldes.");
    update.member_work_invite_subject = subject;
    update.member_work_invite_text = body;
  }
  if (payload.templateId === "non_member_work_invite") {
    if (!subject || !body) throw new Error("Emne og tekst skal udfyldes.");
    update.non_member_work_invite_subject = subject;
    update.non_member_work_invite_text = body;
  }
  if (payload.templateId === "beta_invite") {
    const durationDays = Number(payload.durationDays);
    if (!subject || !body) throw new Error("Emne og tekst skal udfyldes.");
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) throw new Error("Betatestperioden skal være mellem 1 og 365 dage.");
    update.beta_invite_subject = subject;
    update.beta_invite_text = body;
    update.beta_default_duration_days = durationDays;
  }

  const { error } = await db.from("organisations").update(update).eq("id", orgId);
  if (error) throw new Error(error.message);
  await recordAuditEvent({
    context: { actorUserId: user?.id ?? null, actorOrgId: orgId, actorRole: "admin", source: "admin" },
    action: "update",
    entityType: "organisation_text_template",
    entityId: orgId,
    entityLabel: payload.templateId,
    orgIds: [orgId],
    purposeCode: "portal_communication_configuration",
    legalBasis: "GDPR Art. 6(1)(f) og 9(2)(d)",
    dataCategories: ["configuration_data"],
    systemComponent: "admin.organisation.text-editor",
    metadata: { templateId: payload.templateId },
  });
  revalidatePath("/admin/organisation");
  return { success: true as const };
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
  const legacyDeclarationEnabled = Boolean(payload.legacy_contract_declaration_enabled);
  const legacyCutoffYear = payload.legacy_contract_cutoff_year == null ? null : Number(payload.legacy_contract_cutoff_year);
  const statisticsContractScope = payload.statistics_contract_scope === "validated_and_drafts" ? "validated_and_drafts" : "validated_only";
  const rawStatisticsMinimumGroupSize = Number(payload.statistics_minimum_group_size);
  if (!Number.isInteger(rawStatisticsMinimumGroupSize)
    || rawStatisticsMinimumGroupSize < MIN_STATISTICS_MINIMUM_GROUP_SIZE
    || rawStatisticsMinimumGroupSize > MAX_STATISTICS_MINIMUM_GROUP_SIZE) {
    throw new Error(`Statistikgrænsen skal være et helt tal mellem ${MIN_STATISTICS_MINIMUM_GROUP_SIZE} og ${MAX_STATISTICS_MINIMUM_GROUP_SIZE}.`);
  }
  const statisticsMinimumGroupSize = normalizeStatisticsMinimumGroupSize(rawStatisticsMinimumGroupSize);
  const rawStatisticsDominanceLimit = Number(payload.statistics_dominance_limit);
  if (!Number.isFinite(rawStatisticsDominanceLimit)
    || rawStatisticsDominanceLimit < MIN_STATISTICS_DOMINANCE_LIMIT
    || rawStatisticsDominanceLimit > MAX_STATISTICS_DOMINANCE_LIMIT) {
    throw new Error(`Dominansgrænsen skal være mellem ${Math.round(MIN_STATISTICS_DOMINANCE_LIMIT * 100)} og ${Math.round(MAX_STATISTICS_DOMINANCE_LIMIT * 100)} procent.`);
  }
  const statisticsDominanceLimit = normalizeStatisticsDominanceLimit(rawStatisticsDominanceLimit);
  const statisticsProfileConfig = {
    professional_start_year: Boolean(payload.statistics_profile_config?.professional_start_year),
    primary_profession_type: Boolean(payload.statistics_profile_config?.primary_profession_type),
    secondary_profession_types: false,
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
  if (legacyDeclarationEnabled && (!Number.isInteger(legacyCutoffYear) || legacyCutoffYear! < 1888 || legacyCutoffYear! > 2200)) {
    throw new Error("Skæringsåret skal være et firecifret år mellem 1888 og 2200.");
  }
  if (replyToEmail) {
    try {
      normalizeSingleEmail(replyToEmail);
    } catch {
      throw new Error("Svaradressen skal være én gyldig e-mailadresse uden afsendernavn.");
    }
  }

  const { data: previousOrganisation, error: previousOrganisationError } = await db.from("organisations")
    .select("statistics_minimum_group_size,statistics_dominance_limit,legacy_contract_declaration_enabled,legacy_contract_cutoff_year")
    .eq("id", orgId)
    .single();
  if (previousOrganisationError) throw new Error(previousOrganisationError.message);
  const previousStatisticsMinimum = normalizeStatisticsMinimumGroupSize(previousOrganisation.statistics_minimum_group_size);
  const previousStatisticsDominance = normalizeStatisticsDominanceLimit(previousOrganisation.statistics_dominance_limit);
  if (statisticsMinimumGroupSize < 5
    && statisticsMinimumGroupSize !== previousStatisticsMinimum
    && payload.confirm_low_statistics_threshold !== true) {
    throw new Error("Bekræft, at en statistikgrænse under standarden på 5 kræver skærpet diskretion.");
  }
  if (statisticsDominanceLimit > DEFAULT_STATISTICS_DOMINANCE_LIMIT
    && statisticsDominanceLimit !== previousStatisticsDominance
    && payload.confirm_high_statistics_dominance !== true) {
    throw new Error("Bekræft, at en dominansgrænse over 80 % viser flere tal og kræver en tydelig auditmæssig begrundelse.");
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
      branding,
      terminology,
      contract_review_retention_months: retentionMonths,
      contract_review_retention_updated_at: new Date().toISOString(),
      contract_review_retention_updated_by: user?.id ?? null,
      statistics_contract_scope: statisticsContractScope,
      statistics_minimum_group_size: statisticsMinimumGroupSize,
      statistics_dominance_limit: statisticsDominanceLimit,
      statistics_profile_config: statisticsProfileConfig,
      legacy_contract_declaration_enabled: legacyDeclarationEnabled,
      legacy_contract_cutoff_year: legacyCutoffYear,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);

  if (error) throw new Error(error.message);

  const statisticsChanges = [
    ...(statisticsMinimumGroupSize !== previousStatisticsMinimum ? [{
      field: "statistics_minimum_group_size",
      old: previousStatisticsMinimum,
      new: statisticsMinimumGroupSize,
    }] : []),
    ...(statisticsDominanceLimit !== previousStatisticsDominance ? [{
      field: "statistics_dominance_limit",
      old: previousStatisticsDominance,
      new: statisticsDominanceLimit,
    }] : []),
  ];
  if (statisticsChanges.length) {
    await recordAuditEvent({
      context: {
        actorUserId: user?.id ?? null,
        actorOrgId: orgId,
        actorRole: "admin",
        source: "admin",
      },
      action: "update",
      entityType: "organisation_statistics_settings",
      entityId: orgId,
      entityLabel: longName,
      orgIds: [orgId],
      purposeCode: "collective_statistics",
      legalBasis: "GDPR Art. 9(2)(d)",
      dataCategories: ["aggregated_statistics", "union_membership_data"],
      metadata: {
        auditNote: "Ændring af statistikpolicy påvirker sløring og skal kunne forklares ved revision.",
      },
      changes: statisticsChanges,
    });
  }

  if (legacyDeclarationEnabled !== Boolean(previousOrganisation.legacy_contract_declaration_enabled)
    || legacyCutoffYear !== (previousOrganisation.legacy_contract_cutoff_year == null ? null : Number(previousOrganisation.legacy_contract_cutoff_year))) {
    await recordAuditEvent({
      context: { actorUserId: user?.id ?? null, actorOrgId: orgId, actorRole: "admin", source: "admin" },
      action: "update",
      entityType: "organisation_documentation_rule",
      entityId: orgId,
      entityLabel: longName,
      orgIds: [orgId],
      purposeCode: "legacy_work_documentation",
      legalBasis: "administrative_policy",
      dataCategories: ["rights_data"],
      changes: [
        { field: "enabled", old: Boolean(previousOrganisation.legacy_contract_declaration_enabled), new: legacyDeclarationEnabled },
        { field: "cutoff_year", old: previousOrganisation.legacy_contract_cutoff_year ?? null, new: legacyCutoffYear },
      ],
    });
  }

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

// ── Aftalelicens-vægtningskonfiguration ─────────────────────────────────
// Erstatter de tidligere, ikke-org-specifikke localStorage-nøgler
// (dfks_vaerkvaegte, dfks_vaegt_extra, dfks_hensaettelser_pct,
// dfks_sociale_pct) — se migration
// 20260820200000_organisations_aftalelicens_weight_config.sql.

export type AftalelicensWeightConfig = {
  weights: Record<string, number>;
  extra: {
    dokLangPoints: number; dokMellemPoints: number; dokKortPoints: number;
    dokLangMin: number; dokMellemMin: number;
    dokSerieLangMin: number; dokSerieKortPoints: number;
    supplerendeKlipFaktor: number; genudsendelseFaktor: number; genudsendelseMaaneder: number;
  };
  reservePercent: number;
  socialPercent: number;
};

export async function getAftalelicensWeightConfig() {
  const orgId = await currentAdminOrg();
  const db = createServiceClient();
  const { data, error } = await db
    .from("organisations")
    .select("aftalelicens_weight_config")
    .eq("id", orgId)
    .single();
  if (error) throw new Error(error.message);
  return { success: true, config: (data?.aftalelicens_weight_config ?? null) as AftalelicensWeightConfig | null };
}

export async function updateAftalelicensWeightConfig(config: AftalelicensWeightConfig) {
  const orgId = await currentAdminOrg();
  const db = createServiceClient();
  const { error } = await db
    .from("organisations")
    .update({ aftalelicens_weight_config: config, updated_at: new Date().toISOString() })
    .eq("id", orgId);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/aftalelicens");
  return { success: true };
}

const FILTER_RULE_TYPES = new Set<FilterRule["type"]>(["title_keyword", "title_regex", "channel"]);

function normalizeFilterRules(value: unknown, scope: FilterRule["scope"]): FilterRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): FilterRule[] => {
    if (!row || typeof row !== "object") return [];
    const raw = row as Record<string, unknown>;
    const type = typeof raw.type === "string" ? raw.type as FilterRule["type"] : null;
    const id = cleanString(raw.id);
    const name = cleanString(raw.name);
    const ruleValue = cleanString(raw.value);
    if (!id || !name || !ruleValue || !type || !FILTER_RULE_TYPES.has(type)) return [];
    return [{
      id,
      name,
      type,
      value: ruleValue,
      active: raw.active !== false,
      createdAt: cleanString(raw.createdAt) || new Date().toISOString(),
      scope,
    }];
  }).slice(0, 500);
}

export async function getAftalelicensFilterRules() {
  const orgId = await currentAdminOrg();
  const db = createServiceClient();
  const { data, error } = await db
    .from("organisations")
    .select("aftalelicens_filter_rules")
    .eq("id", orgId)
    .single();
  if (error) throw new Error(error.message);
  return { success: true, rules: normalizeFilterRules(data?.aftalelicens_filter_rules, "global") };
}

export async function updateAftalelicensFilterRules(rules: FilterRule[]) {
  const orgId = await currentAdminOrg();
  const normalized = normalizeFilterRules(rules, "global");
  const db = createServiceClient();
  const { error } = await db
    .from("organisations")
    .update({ aftalelicens_filter_rules: normalized, updated_at: new Date().toISOString() })
    .eq("id", orgId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/stamdata");
  revalidatePath("/admin/aftalelicens");
  return { success: true, rules: normalized };
}
