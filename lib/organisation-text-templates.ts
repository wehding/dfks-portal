export const BASIC_TEXT_PLACEHOLDERS = ["navn", "organisation", "værk", "værker"] as const;

export type BasicTextPlaceholder = (typeof BASIC_TEXT_PLACEHOLDERS)[number];

export type OrganisationTextTemplateId =
  | "invite"
  | "reminder"
  | "beta_invite"
  | "member_work_invite"
  | "non_member_work_invite"
  | "welcome";

export type OrganisationTextTemplate = {
  id: OrganisationTextTemplateId;
  label: string;
  description: string;
  subject: string | null;
  body: string;
  durationDays: number | null;
};

export type OrganisationTemplateValues = {
  name: string;
  organisation: string;
  primaryWork: string;
  worksText: string;
  invitationLink?: string;
  startDate?: string;
  endDate?: string;
};

const OPTIONAL_PLACEHOLDERS: Partial<Record<OrganisationTextTemplateId, readonly string[]>> = {
  invite: ["invitationslink"],
  reminder: ["invitationslink"],
  beta_invite: ["startdato", "slutdato", "invitationslink"],
  member_work_invite: ["invitationslink"],
  non_member_work_invite: ["invitationslink"],
};

export function placeholdersForTemplate(id: OrganisationTextTemplateId): string[] {
  return [...BASIC_TEXT_PLACEHOLDERS, ...(OPTIONAL_PLACEHOLDERS[id] ?? [])];
}

export function unknownOrganisationPlaceholders(id: OrganisationTextTemplateId, ...values: string[]): string[] {
  const allowed = new Set(placeholdersForTemplate(id));
  return [...new Set(values.flatMap(value => [...value.matchAll(/\{([^{}]+)\}/g)].map(match => match[1])))]
    .filter(value => !allowed.has(value));
}

export function unknownBasicPlaceholders(...values: string[]): string[] {
  const allowed = new Set<string>(BASIC_TEXT_PLACEHOLDERS);
  return [...new Set(values.flatMap(value => [...value.matchAll(/\{([^{}]+)\}/g)].map(match => match[1])))]
    .filter(value => !allowed.has(value));
}

export function renderOrganisationTemplate(template: string, values: OrganisationTemplateValues): string {
  const replacements: Record<string, string> = {
    navn: values.name,
    organisation: values.organisation,
    værk: values.primaryWork,
    værker: values.worksText,
    invitationslink: values.invitationLink ?? "",
    startdato: values.startDate ?? "",
    slutdato: values.endDate ?? "",
  };
  return template.replace(/\{([^{}]+)\}/g, (placeholder, key: string) => replacements[key] ?? placeholder);
}

export function insertTextAtSelection(value: string, insertion: string, start: number, end: number) {
  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));
  const nextValue = `${value.slice(0, safeStart)}${insertion}${value.slice(safeEnd)}`;
  return { value: nextValue, cursor: safeStart + insertion.length };
}
