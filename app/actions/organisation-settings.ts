"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import type { OrgBranding, OrgTerminology } from "@/lib/db/types";
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
  onboarding_keywords: string[];
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
    .select("id, name, logo_url, from_email, invite_email_text, invite_reminder_text, welcome_message_text, branding, terminology")
    .eq("id", orgId)
    .single();

  if (error || !data) throw new Error(error?.message ?? "Organisationen blev ikke fundet.");

  const branding = (data.branding ?? {}) as OrgBranding;
  const terminology = (data.terminology ?? {}) as OrgTerminology;

  const foreninglet = await getForeningLetIntegration(db, orgId);

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
    role_labels: terminology.role_labels?.length
      ? terminology.role_labels
      : ["Medskaber"],
    onboarding_keywords: terminology.onboarding_keywords?.length
      ? terminology.onboarding_keywords
      : ["klip", "edit"],
    foreninglet,
  };
}

export async function updateOrganisationSettings(payload: OrganisationSettingsPayload) {
  const orgId = await currentAdminOrg();
  const db = createServiceClient();

  const shortName = cleanString(payload.short_name);
  const longName = cleanString(payload.long_name);
  const coeditorWord = cleanString(payload.coeditor_word);
  const roleLabels = normalizeRoles(payload.role_labels);
  const onboardingKeywords = normalizeRoles(payload.onboarding_keywords).map(keyword => keyword.toLowerCase());
  const replyToEmail = cleanOptionalString(payload.from_email);

  if (!shortName || !longName) throw new Error("Kort navn og fuldt navn skal udfyldes.");
  if (!coeditorWord) throw new Error("Fagordet skal udfyldes.");
  if (roleLabels.length === 0) throw new Error("Der skal være mindst én rollebetegnelse.");
  if (onboardingKeywords.length === 0) throw new Error("Der skal være mindst ét onboarding-søgeord.");
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);

  if (error) throw new Error(error.message);

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
