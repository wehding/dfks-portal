import type { DbOrganisation, OrgBranding, OrgTerminology } from "@/lib/db/types";

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
};

export const DEFAULT_FROM_EMAIL = "Portal <noreply@dfks.dk>";

function isEmail(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
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
  return {
    member_word: t.member_word ?? DEFAULT_TERMINOLOGY.member_word,
    coeditor_word: t.coeditor_word ?? DEFAULT_TERMINOLOGY.coeditor_word,
    role_labels: t.role_labels && t.role_labels.length ? t.role_labels : DEFAULT_TERMINOLOGY.role_labels,
  };
}

// Afsender til systemmails: foreningens arbejdsmail, ellers standard.
// Formatteres som "Navn <mail>" hvis vi har et navn.
export function resolveFromEmail(org: Pick<DbOrganisation, "name" | "from_email" | "branding"> | null): string {
  const email = org?.from_email?.trim();
  if (!email) return DEFAULT_FROM_EMAIL;
  if (email.includes("<") && email.includes(">")) return email;
  if (!isEmail(email)) return DEFAULT_FROM_EMAIL;
  const name = resolveBranding(org as DbOrganisation).short_name;
  return `${name} <${email}>`;
}
