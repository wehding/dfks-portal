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

export function normalizeCompanyBaseName(value: string) {
  return normalizeCompanyName(value)
    .replace(/(?:\s+(?:aps|a s|as|ivs|amba|s mba|ltd|limited|inc|llc|ab|oy|gmbh))+$/g, "")
    .trim();
}

function diceCoefficient(left: string, right: string) {
  const a = left.replace(/\s+/g, "");
  const b = right.replace(/\s+/g, "");
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let index = 0; index < a.length - 1; index += 1) {
    const pair = a.slice(index, index + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  let overlap = 0;
  for (let index = 0; index < b.length - 1; index += 1) {
    const pair = b.slice(index, index + 2);
    const count = pairs.get(pair) ?? 0;
    if (count > 0) {
      overlap += 1;
      pairs.set(pair, count - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length - 2);
}

function nameMatchScore(candidate: string, query: string) {
  const normalizedCandidate = normalizeCompanyName(candidate);
  const normalizedQuery = normalizeCompanyName(query);
  if (!normalizedCandidate || !normalizedQuery) return 0;
  if (normalizedCandidate === normalizedQuery) return 110;

  const baseCandidate = normalizeCompanyBaseName(candidate);
  const baseQuery = normalizeCompanyBaseName(query);
  if (baseCandidate && baseCandidate === baseQuery) return 100;
  if (baseCandidate.replace(/\s+/g, "") === baseQuery.replace(/\s+/g, "")) return 96;

  const shorter = Math.min(baseCandidate.length, baseQuery.length);
  const longer = Math.max(baseCandidate.length, baseQuery.length);
  if (shorter >= 4 && (baseCandidate.includes(baseQuery) || baseQuery.includes(baseCandidate))) {
    return 82 + Math.round((shorter / longer) * 10);
  }

  const candidateTokens = new Set(baseCandidate.split(" ").filter(Boolean));
  const queryTokens = new Set(baseQuery.split(" ").filter(Boolean));
  const commonTokens = [...queryTokens].filter(token => candidateTokens.has(token)).length;
  const tokenCoverage = commonTokens / Math.max(candidateTokens.size, queryTokens.size, 1);
  if (commonTokens >= 2 && tokenCoverage >= 0.6) return 68 + Math.round(tokenCoverage * 12);

  const similarity = diceCoefficient(baseCandidate, baseQuery);
  return shorter >= 5 && similarity >= 0.68 ? 55 + Math.round(similarity * 15) : 0;
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
  return companyMatchScore(option, query) > 0;
}

export function companyMatchScore(option: ProductionCompanyOption, query: string) {
  const normalizedQuery = normalizeCompanyName(query);
  const registrationQuery = query.replace(/\D/g, "");
  if (!normalizedQuery && !registrationQuery) return 1;
  const names = [
    option.canonicalName,
    ...option.aliases,
    ...option.legalEntities.map(entity => entity.legalName),
  ];
  const registrationScore = registrationQuery.length >= 3 && option.legalEntities.some(entity => entity.registrationNumber?.includes(registrationQuery))
    ? (option.legalEntities.some(entity => entity.registrationNumber === registrationQuery) ? 120 : 90)
    : 0;
  return Math.max(registrationScore, ...names.map(name => nameMatchScore(name, query)));
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
