"use client";

import { AlertCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const COPY = {
  "member-org-required": {
    da: "Du er ikke rettighedshaver i den valgte organisation. Vælg en organisation med medlemsadgang for at åbne Mine værker og Mine kontrakter.",
    en: "You are not a rights holder in the selected organisation. Select an organisation with member access to open My works and My contracts.",
  },
  "admin-org-required": {
    da: "Du har ikke administratoradgang i den valgte organisation. Vælg en organisation med administratoradgang for at åbne administrationen.",
    en: "You do not have administrator access in the selected organisation. Select an organisation with administrator access to open the admin area.",
  },
} as const;

export function OrgContextNotice({ notice }: { notice?: string | null }) {
  const { locale } = useI18n();
  const copy = notice && notice in COPY ? COPY[notice as keyof typeof COPY][locale] : null;
  if (!copy) return null;
  return <div role="status" className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/25 dark:text-amber-100">
    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
    <p>{copy}</p>
  </div>;
}
