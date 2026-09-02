export const DEFAULT_BETA_INVITE_SUBJECT = "Invitation til betatest af {organisation}";
export const DEFAULT_BETA_INVITE_TEXT = `Hej {navn}

Du er inviteret til at betateste {organisation}s portal fra {startdato} til {slutdato}.

Brug invitationslinket nedenfor for at oprette eller åbne din adgang.`;

export const BETA_INVITE_PLACEHOLDERS = ["navn", "organisation", "værk", "værker", "startdato", "slutdato", "invitationslink"] as const;

export function todayInCopenhagen(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addCalendarDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime())) throw new Error("Startdatoen er ugyldig.");
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function formatBetaDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime())) throw new Error("Datoen er ugyldig.");
  return new Intl.DateTimeFormat("da-DK", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(parsed);
}

export function validateBetaPeriod(startDate: string, endDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error("Betaperiodens datoer er ugyldige.");
  if (endDate <= startDate) throw new Error("Slutdatoen skal ligge efter startdatoen.");
  const days = Math.round((Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86_400_000);
  if (days > 365) throw new Error("Betaperioden må højst være 365 dage.");
}

export function unknownBetaPlaceholders(...templates: string[]): string[] {
  const allowed = new Set<string>(BETA_INVITE_PLACEHOLDERS);
  return [...new Set(templates.flatMap(template => [...template.matchAll(/\{([^{}]+)\}/g)].map(match => match[1])))].filter(key => !allowed.has(key));
}

export function renderBetaInviteTemplate(template: string, values: {
  name: string;
  organisation: string;
  startDate: string;
  endDate: string;
  invitationLink?: string;
  primaryWork?: string;
  worksText?: string;
}): string {
  const replacements: Record<string, string> = {
    navn: values.name,
    organisation: values.organisation,
    startdato: formatBetaDate(values.startDate),
    slutdato: formatBetaDate(values.endDate),
    invitationslink: values.invitationLink ?? "",
    værk: values.primaryWork ?? "dit værk",
    værker: values.worksText ?? "dine værker",
  };
  return template.replace(/\{([^{}]+)\}/g, (placeholder, key: string) => replacements[key] ?? placeholder);
}
