"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import type { OrgBranding, OrgTerminology } from "@/lib/db/types";

type OrganisationSettingsPayload = {
  short_name: string;
  long_name: string;
  logo_url: string | null;
  primary_color: string;
  from_email: string | null;
  coeditor_word: string;
  role_labels: string[];
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
    .select("id, name, logo_url, from_email, branding, terminology")
    .eq("id", orgId)
    .single();

  if (error || !data) throw new Error(error?.message ?? "Organisationen blev ikke fundet.");

  const branding = (data.branding ?? {}) as OrgBranding;
  const terminology = (data.terminology ?? {}) as OrgTerminology;

  return {
    id: data.id as string,
    name: data.name as string,
    logo_url: (data.logo_url as string | null) ?? null,
    from_email: (data.from_email as string | null) ?? null,
    short_name: branding.short_name ?? data.name,
    long_name: branding.long_name ?? data.name,
    primary_color: branding.primary_color ?? "#111827",
    coeditor_word: terminology.coeditor_word ?? "medklipper",
    member_word: terminology.member_word ?? "klipper",
    role_labels: terminology.role_labels?.length
      ? terminology.role_labels
      : ["B-klipper", "Klipper", "Konceptuerende klipper"],
  };
}

export async function updateOrganisationSettings(payload: OrganisationSettingsPayload) {
  const orgId = await currentAdminOrg();
  const db = createServiceClient();

  const shortName = cleanString(payload.short_name);
  const longName = cleanString(payload.long_name);
  const coeditorWord = cleanString(payload.coeditor_word);
  const roleLabels = normalizeRoles(payload.role_labels);

  if (!shortName || !longName) throw new Error("Kort navn og fuldt navn skal udfyldes.");
  if (!coeditorWord) throw new Error("Fagordet skal udfyldes.");
  if (roleLabels.length === 0) throw new Error("Der skal være mindst én rollebetegnelse.");

  const branding: OrgBranding = {
    short_name: shortName,
    long_name: longName,
    primary_color: normalizeColor(payload.primary_color),
  };
  const terminology: OrgTerminology = {
    member_word: "klipper",
    coeditor_word: coeditorWord,
    role_labels: roleLabels,
  };

  const { error } = await db
    .from("organisations")
    .update({
      name: longName,
      logo_url: cleanOptionalString(payload.logo_url),
      from_email: cleanOptionalString(payload.from_email),
      branding,
      terminology,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/organisation");
  revalidatePath("/admin");
  revalidatePath("/portal");
  return { success: true };
}
