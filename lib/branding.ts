import type { DbOrganisation, OrgBranding, OrgTerminology } from "@/lib/db/types";
import { normalizeSingleEmail } from "@/lib/email/mime";

// Standardværdier (DFKS/klipper-domænet) der bruges når en forening ikke selv
// har sat branding/terminologi. Gør white-label bagud-kompatibel.
export const DEFAULT_BRANDING: Required<OrgBranding> = {
  primary_color: "#111827",
  short_name: "Portal",
  long_name: "Medlemsportal",
};

export const DEFAULT_TERMINOLOGY: Required<OrgTerminology> = {
  member_word: "medlem",
  coeditor_word: "medskaber",
  role_labels: ["Medskaber"],
  default_role_label: "Medskaber",
  onboarding_keywords: ["klip", "edit"],
};

export function resolveDefaultRoleLabel(roleLabels: string[], configured?: string | null): string {
  const labels = roleLabels.map(label => label.trim()).filter(Boolean);
  const configuredMatch = configured?.trim()
    ? labels.find(label => label.localeCompare(configured.trim(), "da", { sensitivity: "base" }) === 0)
    : undefined;
  if (configuredMatch) return configuredMatch;

  // Bagudkompatibilitet for DFKS-konfigurationer fra før en eksplicit standardrolle.
  const klipper = labels.find(label => label.localeCompare("Klipper", "da", { sensitivity: "base" }) === 0);
  return klipper ?? labels[0] ?? DEFAULT_TERMINOLOGY.default_role_label;
}

export function resolveBranding(org: Pick<DbOrganisation, "name" | "branding"> | null): Required<OrgBranding> {
  const b = org?.branding ?? {};
  return {
    primary_color: b.primary_color ?? DEFAULT_BRANDING.primary_color,
    short_name: b.short_name ?? DEFAULT_BRANDING.short_name,
    long_name: b.long_name ?? org?.name ?? DEFAULT_BRANDING.long_name,
  };
}

export function resolveTerminology(org: Pick<DbOrganisation, "terminology"> | null): Required<OrgTerminology> {
  const t = org?.terminology ?? {};
  const coeditorWord = t.coeditor_word ?? DEFAULT_TERMINOLOGY.coeditor_word;
  const configuredRoleLabels = t.role_labels && t.role_labels.length ? t.role_labels : DEFAULT_TERMINOLOGY.role_labels;
  const roleLabels = configuredRoleLabels.filter(label => {
    const normalized = label.trim();
    return normalized.localeCompare("Medklipper", "da", { sensitivity: "base" }) !== 0
      && normalized.localeCompare(coeditorWord, "da", { sensitivity: "base" }) !== 0;
  });
  const selectableRoleLabels = roleLabels.length ? roleLabels : DEFAULT_TERMINOLOGY.role_labels;
  return {
    member_word: t.member_word ?? DEFAULT_TERMINOLOGY.member_word,
    coeditor_word: coeditorWord,
    role_labels: selectableRoleLabels,
    default_role_label: resolveDefaultRoleLabel(selectableRoleLabels, t.default_role_label),
    onboarding_keywords: t.onboarding_keywords && t.onboarding_keywords.length ? t.onboarding_keywords : DEFAULT_TERMINOLOGY.onboarding_keywords,
  };
}

export function resolveDefaultRole(org: Pick<DbOrganisation, "terminology"> | null): string {
  return resolveTerminology(org).default_role_label;
}

export function resolveEmailSenderName(org: Pick<DbOrganisation, "name" | "branding"> | null): string {
  return resolveBranding(org).short_name;
}

// Organisationen styrer kun svaradressen. Den faktiske From-adresse kommer
// altid fra den serverbeskyttede GOOGLE_GMAIL_SENDER.
export function resolveReplyToEmail(org: Pick<DbOrganisation, "from_email"> | null): string | undefined {
  if (!org?.from_email?.trim()) return undefined;
  try {
    return normalizeSingleEmail(org.from_email);
  } catch {
    return undefined;
  }
}
