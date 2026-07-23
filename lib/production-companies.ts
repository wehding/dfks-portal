export type LegalEntityKind = "company" | "subsidiary" | "spv";

export type ProductionCompanyLegalEntity = {
  id: string;
  legalName: string;
  registrationCountry: string;
  registrationType: string;
  registrationNumber: string | null;
  entityKind: LegalEntityKind;
  isPrimary: boolean;
  registrationStatus: string | null;
};

export type ProductionCompanyOption = {
  employerId: string;
  canonicalName: string;
  aliases: string[];
  legalEntities: ProductionCompanyLegalEntity[];
  isVerified: boolean;
};

export type ProductionCompanySelection = {
  employerId: string;
  legalEntityId?: string;
  canonicalName: string;
  legalName?: string;
  registrationNumber?: string;
};

export function normalizeCompanyName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("da")
    .replace(/[’'`´]/g, "")
    .replace(/[^a-z0-9æøå]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeRegistrationNumber(value: string, country = "DK", type = "CVR") {
  const trimmed = value.trim();
  return country === "DK" && type.toUpperCase() === "CVR"
    ? trimmed.replace(/\D/g, "")
    : trimmed.replace(/\s+/g, "");
}

export function validateRegistrationNumber(value: string, country = "DK", type = "CVR") {
  const normalized = normalizeRegistrationNumber(value, country, type);
  if (!normalized) return { valid: true as const, normalized: null };
  if (country === "DK" && type.toUpperCase() === "CVR" && !/^\d{8}$/.test(normalized)) {
    return { valid: false as const, normalized, error: "Et dansk CVR-nummer skal bestå af 8 cifre." };
  }
  return { valid: true as const, normalized };
}

export function companyMatches(option: ProductionCompanyOption, query: string) {
  const normalizedQuery = normalizeCompanyName(query);
  const registrationQuery = query.replace(/\D/g, "");
  if (!normalizedQuery && !registrationQuery) return true;
  const names = [
    option.canonicalName,
    ...option.aliases,
    ...option.legalEntities.map(entity => entity.legalName),
  ];
  return names.some(name => normalizeCompanyName(name).includes(normalizedQuery))
    || Boolean(registrationQuery && option.legalEntities.some(entity => entity.registrationNumber?.includes(registrationQuery)));
}

export function selectionKey(selection: ProductionCompanySelection) {
  return `${selection.employerId}:${selection.legalEntityId ?? "canonical"}`;
}

export function uniqueCompanySelections(selections: ProductionCompanySelection[]) {
  const seen = new Set<string>();
  return selections.filter(selection => {
    const key = selectionKey(selection);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

