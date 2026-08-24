export const MAX_REVIEW_MAIL_RECIPIENTS = 25;
export const MAX_REVIEW_MAIL_BODY_CHARS = 50_000;

const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

function rejectHeaderInjection(value: string) {
  if (/[\r\n\0]/.test(value)) throw new Error("Mailfeltet indeholder ugyldige tegn.");
}

export function normalizeReviewEmailAddress(value: string): string {
  const candidate = value.trim();
  rejectHeaderInjection(candidate);
  const angleAddress = candidate.match(/<([^<>]+)>$/)?.[1]?.trim();
  const email = angleAddress ?? candidate;
  if (!EMAIL_PATTERN.test(email)) throw new Error(`Ugyldig e-mailadresse: ${candidate}`);
  return email.toLowerCase();
}

export function normalizeReviewEmailAddresses(values: unknown): string[] {
  const input = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? values.split(/[;,]/)
      : [];
  const addresses = [...new Set(input.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map(normalizeReviewEmailAddress))];
  if (addresses.length > MAX_REVIEW_MAIL_RECIPIENTS) throw new Error("Der er valgt for mange modtagere.");
  return addresses;
}

export function normalizeReviewMailHeader(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} er ugyldigt.`);
  const normalized = value.trim();
  rejectHeaderInjection(normalized);
  if (normalized.length > maximum) throw new Error(`${label} er for langt.`);
  return normalized;
}

export function parseSenderAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return normalizeReviewEmailAddress(value);
  } catch {
    return null;
  }
}
