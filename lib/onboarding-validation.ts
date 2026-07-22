export type OnboardingField = "name" | "email" | "phone" | "cpr" | "bank_account";

export function isValidEmail(value: string) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim());
}

export function normalizeCpr(value: string) {
  return value.replace(/\D/g, "");
}

export function isValidCpr(value: string) {
  const digits = normalizeCpr(value);
  if (digits.length !== 10) return false;
  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4, 6));
  return [1900 + year, 2000 + year].some(fullYear => {
    const date = new Date(Date.UTC(fullYear, month - 1, day));
    return date.getUTCFullYear() === fullYear && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  });
}

export function normalizeDanishPhone(value: string) {
  const compact = value.replace(/[\s().-]/g, "");
  return compact.startsWith("0045") ? `+45${compact.slice(4)}` : compact;
}

export function isValidDanishPhone(value: string) {
  const normalized = normalizeDanishPhone(value);
  return /^(?:\+45)?\d{8}$/.test(normalized);
}

export function normalizeBankAccount(value: string) {
  return value.replace(/\D/g, "");
}

export function isPlausibleBankAccount(value: string) {
  const digits = normalizeBankAccount(value);
  return digits.length >= 10 && digits.length <= 14;
}

export function validateOnboardingField(field: OnboardingField, value: string): string | null {
  const trimmed = value.trim();
  if (field === "name") return trimmed ? null : "Skriv dit fulde navn.";
  if (field === "email") return isValidEmail(trimmed) ? null : "E-mailadressen er ikke gyldig.";
  if (!trimmed) return null;
  if (field === "phone") return isValidDanishPhone(trimmed) ? null : "Skriv et dansk telefonnummer med 8 cifre.";
  if (field === "cpr") return isValidCpr(trimmed) ? null : "CPR skal have formatet DDMMÅÅ-XXXX.";
  return isPlausibleBankAccount(trimmed) ? null : "Skriv registrerings- og kontonummer med 10–14 cifre.";
}
