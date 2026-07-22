import type { DbOrganisation, OrgBranding, OrgTerminology } from "@/lib/db/types";
import { normalizeSingleEmail } from "@/lib/email/mime";

// Standardværdier (DFKS/klipper-domænet) der bruges når en forening ikke selv
// har sat branding/terminologi. Gør white-label bagud-kompatibel.
export const DEFAULT_BRANDING: Required<OrgBranding> = {
  primary_color: "#111827",
  short_name: "DFKS",
  long_name: "Dansk Filmklipperselskab",
};

export const DEFAULT_TERMINOLOGY: Required<OrgTerminology> = {
  member_word: "klipper",
  coeditor_word: "medklipper",
  role_labels: ["Klipper", "B-klipper", "Konceptuerende klipper"],
  onboarding_keywords: ["klip", "edit"],
};

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
  return {
    member_word: t.member_word ?? DEFAULT_TERMINOLOGY.member_word,
    coeditor_word: t.coeditor_word ?? DEFAULT_TERMINOLOGY.coeditor_word,
    role_labels: t.role_labels && t.role_labels.length ? t.role_labels : DEFAULT_TERMINOLOGY.role_labels,
    onboarding_keywords: t.onboarding_keywords && t.onboarding_keywords.length ? t.onboarding_keywords : DEFAULT_TERMINOLOGY.onboarding_keywords,
  };
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
