import { CONTRACT_IMPORT_SCHEMA_VERSION } from "@/lib/contract-import-job";

type JsonSchema = Record<string, unknown>;

const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: "null" }] });
const text = nullable({ type: "string" });
const number = nullable({ type: "number" });
const boolean = { type: "boolean" };
const enumText = (values: string[]) => nullable({ type: "string", enum: values });

const sourceKeys = [
  "workTitle", "salary", "pension", "supplements", "otherSupplements", "dates",
  "workingWeeks", "collectiveAgreement", "copydan", "svod", "royalty",
] as const;

const properties: Record<string, JsonSchema> = {
  employerName: text,
  parentCompanyName: text,
  rightsHolderName: text,
  workTitle: text,
  director: text,
  duration: number,
  premiereYear: number,
  creditedFunction: text,
  contractType: enumText(["a-løn", "leverandør", "b2b", "unknown"]),
  overenskomst: enumText(["de4-fiktion", "faf", "faf-dokumentar", "faf-tv-ansat", "faf-tv-freelance", "dj", "metal", "ingen"]),
  agreementEmploymentForm: enumText(["a-løn", "lønmodtager-freelance", "leverandør", "unknown"]),
  contractDate: text,
  signatureStatus: enumText(["yes", "no", "unknown"]),
  signatureMethod: enumText(["handwritten", "digital", "none", "unknown"]),
  signatureDate: text,
  signatureEvidence: text,
  signaturePage: number,
  startDate: text,
  endDate: text,
  productionType: enumText(["feature", "tvSeries", "documentary", "docSeries", "short", "tvEntertainment", "reality", "other"]),
  seasonNumber: nullable({ type: "integer", minimum: 1 }),
  episodeNumbers: nullable({ type: "array", items: { type: "integer", minimum: 1 }, uniqueItems: true }),
  workingDays: number,
  workingWeeks: number,
  salary: number,
  salaryUnit: enumText(["weekly", "monthly", "daily", "total"]),
  salarySourceType: enumText(["weekly", "daily_converted", "hourly_converted", "lump_calculated", "invoice_line", "unknown"]),
  salaryConfidence: enumText(["high", "medium", "low"]),
  salaryNote: text,
  needsManualSalaryReview: boolean,
  pensionPercent: number,
  pensionEmployeePercent: number,
  pensionBasisAmount: number,
  pensionSupplement: number,
  personalSupplement: number,
  postProductionSupplement: number,
  loentillaeg: number,
  otherSupplements: text,
  holidayPayRate: number,
  betaRate: number,
  svod: boolean,
  copydan: boolean,
  royalty: boolean,
  royaltyPercent: number,
  aiDataMiningClause: boolean,
  futureRightsReservation: boolean,
  rightsOverview: {
    type: "object",
    properties: {
      overenskomst: text,
      kreditering: text,
      copydanforbehold: text,
      streamingforbehold: text,
    },
    additionalProperties: false,
  },
  distribution: text,
  collectiveAgreement: boolean,
  collectiveAgreementName: text,
  collectiveAgreementByReference: boolean,
  agreementReferenceStatus: enumText(["yes", "no", "unknown"]),
  isFreelanceContract: boolean,
  hasCreditClause: boolean,
  hasTerminationClause: boolean,
  terminationDaysEditor: number,
  terminationDaysProducer: number,
  hasIndemnification: boolean,
  hasOverenskomstIncorporation: boolean,
  specialNotes: text,
  _sources: {
    type: "object",
    properties: Object.fromEntries(sourceKeys.map(key => [key, text])),
    additionalProperties: false,
  },
};

export const CONTRACT_EXTRACTION_JSON_SCHEMA: JsonSchema = {
  type: "object",
  properties,
  additionalProperties: false,
};

/** Claude Structured Outputs currently rejects this extraction schema because
 * it exceeds the provider's limits for optional/union fields. The system prompt
 * already contains the complete schema and requires JSON-only output, so Claude
 * uses that prompt path while compatible providers retain constrained output. */
export function contractExtractionResponseSchema(provider: string) {
  return provider === "anthropic" ? undefined : CONTRACT_EXTRACTION_JSON_SCHEMA;
}

export const CONTRACT_EXTRACTION_SCHEMA_VERSION = CONTRACT_IMPORT_SCHEMA_VERSION;
export const CONTRACT_EXTRACTION_CHUNK_CHARS = 90_000;
export const CONTRACT_EXTRACTION_MIN_TEXT_CHARS = 120;

const USABLE_CONTRACT_FIELDS = [
  "employerName", "parentCompanyName", "rightsHolderName", "workTitle", "director",
  "creditedFunction", "contractDate", "startDate", "endDate", "salary", "workingDays",
  "workingWeeks", "pensionPercent", "collectiveAgreementName", "distribution", "specialNotes",
] as const;

/** Prevents a syntactically valid, but effectively empty, AI response from
 * being presented as a successful contract extraction. Boolean defaults and
 * signature metadata are deliberately insufficient on their own. */
export function hasUsableContractExtraction(data: Record<string, unknown>) {
  return USABLE_CONTRACT_FIELDS.some(field => {
    const value = data[field];
    if (typeof value === "string") return value.trim().length > 0;
    return typeof value === "number" && Number.isFinite(value);
  });
}

function splitOversizedPage(page: string, maxChars: number) {
  const parts: string[] = [];
  let remainder = page.trim();
  while (remainder.length > maxChars) {
    const preferred = Math.max(
      remainder.lastIndexOf("\n\n", maxChars),
      remainder.lastIndexOf("\n", maxChars),
      remainder.lastIndexOf(" ", maxChars),
    );
    const cut = preferred > maxChars * 0.6 ? preferred : maxChars;
    parts.push(remainder.slice(0, cut).trim());
    remainder = remainder.slice(cut).trim();
  }
  if (remainder) parts.push(remainder);
  return parts;
}

/**
 * Keeps every page/character. Small documents use one call; larger documents
 * are split at page boundaries (or paragraph boundaries for a single huge
 * page), so clauses and signature pages at the end are never silently dropped.
 */
export function splitContractTextForExtraction(value: string, maxChars = CONTRACT_EXTRACTION_CHUNK_CHARS) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const pages = normalized.includes("\f")
    ? normalized.split(/\s*\f\s*/).map(page => page.trim()).filter(Boolean)
    : splitOversizedPage(normalized, maxChars);
  const labelled = pages.flatMap((page, index) => splitOversizedPage(page, maxChars - 40).map((part, partIndex) => (
    `--- SIDE ${index + 1}${partIndex ? `, DEL ${partIndex + 1}` : ""} ---\n${part}`
  )));

  const chunks: string[] = [];
  let current = "";
  for (const page of labelled) {
    const candidate = current ? `${current}\n\n${page}` : page;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = page;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(true|ja|yes)$/i.test(value.trim())) return true;
    if (/^(false|nej|no)$/i.test(value.trim())) return false;
  }
  return false;
}

function normalizeValue(key: string, value: unknown) {
  if (value == null || value === "") return null;
  const schema = properties[key];
  if (schema === boolean) return normalizedBoolean(value);
  const variants = Array.isArray(schema?.anyOf) ? schema.anyOf as JsonSchema[] : [];
  const primary = variants[0] ?? schema;
  if (primary?.type === "number") return finiteNumber(value);
  if (primary?.type === "integer") {
    const parsed = finiteNumber(value);
    return parsed == null ? null : Math.max(1, Math.round(parsed));
  }
  if (primary?.type === "array") {
    if (!Array.isArray(value)) return null;
    return Array.from(new Set(value.map(finiteNumber)
      .filter((item): item is number => item != null && item >= 1)
      .map(item => Math.round(item)))).sort((left, right) => left - right);
  }
  if (primary?.type === "string") {
    const normalized = String(value).trim();
    const allowed = Array.isArray(primary.enum) ? primary.enum as string[] : null;
    return allowed && !allowed.includes(normalized) ? null : normalized;
  }
  return value;
}

export function normalizeContractExtraction(value: unknown) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(properties)) {
    if (!(key in raw)) continue;
    if (key === "_sources") {
      const sources = raw._sources && typeof raw._sources === "object" ? raw._sources as Record<string, unknown> : {};
      result._sources = Object.fromEntries(sourceKeys.map(sourceKey => {
        const source = sources[sourceKey];
        return [sourceKey, typeof source === "string" && source.trim() ? source.trim().slice(0, 400) : null];
      }));
      continue;
    }
    if (key === "rightsOverview") {
      const overview = raw.rightsOverview && typeof raw.rightsOverview === "object" ? raw.rightsOverview as Record<string, unknown> : {};
      result.rightsOverview = Object.fromEntries(["overenskomst", "kreditering", "copydanforbehold", "streamingforbehold"]
        .map(item => [item, typeof overview[item] === "string" ? overview[item].trim() : null]));
      continue;
    }
    result[key] = normalizeValue(key, raw[key]);
  }
  return result;
}

const POSITIVE_BOOLEAN_KEYS = new Set([
  "svod", "copydan", "royalty", "aiDataMiningClause", "futureRightsReservation", "collectiveAgreement",
  "collectiveAgreementByReference", "hasCreditClause", "hasTerminationClause", "hasIndemnification",
  "hasOverenskomstIncorporation",
]);

/** Deterministic merge for multi-chunk extraction. Later chunks can add data,
 * and an explicit positive rights/signature finding wins over an earlier no. */
export function mergeContractExtractionChunks(chunks: Record<string, unknown>[]) {
  const merged: Record<string, unknown> = {};
  for (const chunk of chunks) {
    const hasPositiveSignature = chunk.signatureStatus === "yes";
    if (hasPositiveSignature) {
      merged.signatureStatus = "yes";
      for (const key of ["signatureMethod", "signatureDate", "signatureEvidence", "signaturePage"] as const) {
        if (chunk[key] != null && chunk[key] !== "") merged[key] = chunk[key];
      }
    }
    for (const [key, value] of Object.entries(chunk)) {
      if (key === "episodeNumbers" && Array.isArray(value)) {
        const previous = Array.isArray(merged.episodeNumbers) ? merged.episodeNumbers as number[] : [];
        merged.episodeNumbers = Array.from(new Set([...previous, ...value]
          .filter(item => typeof item === "number" && Number.isFinite(item) && item >= 1)
          .map(item => Math.round(item)))).sort((left, right) => left - right);
        continue;
      }
      if (key === "_sources" || key === "rightsOverview") {
        const previous = merged[key] && typeof merged[key] === "object" ? merged[key] as Record<string, unknown> : {};
        const next = value && typeof value === "object" ? value as Record<string, unknown> : {};
        merged[key] = Object.fromEntries(Array.from(new Set([...Object.keys(previous), ...Object.keys(next)]))
          .map(item => [item, previous[item] ?? next[item] ?? null]));
        continue;
      }
      if (POSITIVE_BOOLEAN_KEYS.has(key) && value === true) {
        merged[key] = true;
        continue;
      }
      if (key === "signatureStatus" && value === "yes") {
        merged[key] = value;
        continue;
      }
      if (hasPositiveSignature && ["signatureMethod", "signatureDate", "signatureEvidence", "signaturePage"].includes(key)) continue;
      if (merged[key] == null && value != null && value !== "") merged[key] = value;
    }
  }
  return merged;
}
