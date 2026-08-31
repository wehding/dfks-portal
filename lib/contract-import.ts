export const MAX_CONTRACT_IMPORT_BYTES = 25 * 1024 * 1024;
export const CONTRACT_IMPORT_CHUNK_SIZE = 20;
export const CONTRACT_IMPORT_CONCURRENCY = 3;
export const CONTRACT_MATCH_VERSION = "2026-08-v1";

const SUPPORTED_EXTENSIONS = new Set(["pdf", "doc", "docx", "txt"]);

export type SafeMatchEvidence = {
  signal: string;
  points: number;
};

export type ScoredCandidate<T> = {
  value: T;
  score: number;
  evidence: SafeMatchEvidence[];
};

export function safeContractFileName(value: string) {
  const normalized = value.normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180);
  return normalized || "contract.pdf";
}

export function validateContractImportFile(file: { name: string; size: number }) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!SUPPORTED_EXTENSIONS.has(extension)) return "Filformat ikke understøttet — brug PDF, DOC, DOCX eller TXT.";
  if (!Number.isFinite(file.size) || file.size < 1) return "Filen er tom.";
  if (file.size > MAX_CONTRACT_IMPORT_BYTES) return "Filen er for stor. Maksimum er 25 MB.";
  return null;
}

export function normalizeMatchText(value: unknown) {
  return String(value ?? "")
    .toLocaleLowerCase("da-DK")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9æøå]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contractProductionTypeToWorkType(value: unknown) {
  const normalized = normalizeMatchText(value).replaceAll(" ", "");
  if (!normalized) return null;
  if (["docseries", "documentaryseries", "dokumentarserie"].includes(normalized)) return "dokumentar-serie";
  if (normalized.includes("dokumentar") && normalized.includes("serie")) return "dokumentar-serie";
  if (["documentary", "documentaryfilm", "dokumentar", "dokumentarfilm", "dokudrama"].includes(normalized)) return "dokumentarfilm";
  if (["tvseries", "series", "serie", "tvserie", "tventertainment", "reality", "sport"].includes(normalized)) return "tv-serie";
  if (["short", "shortfilm", "kort", "kortfilm"].includes(normalized)) return "kortfilm";
  if (["feature", "featurefilm", "movie", "film", "spillefilm"].includes(normalized)) return "spillefilm";
  return null;
}

export function levenshteinSimilarity(leftValue: unknown, rightValue: unknown) {
  const left = normalizeMatchText(leftValue);
  const right = normalizeMatchText(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = left[i - 1] === right[j - 1]
        ? diagonal
        : Math.min(previous[j - 1], above, diagonal) + 1;
      diagonal = above;
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

export function titleSimilarity(leftValue: unknown, rightValue: unknown) {
  const left = normalizeMatchText(leftValue);
  const right = normalizeMatchText(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  const overlap = [...leftTokens].filter(token => rightTokens.has(token)).length
    / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
  return Math.max(levenshteinSimilarity(left, right), overlap);
}

export function premiereWindowScore(contractYear: number | null, premiereYear: number | null) {
  if (!contractYear || !premiereYear) return 0;
  const lead = premiereYear - contractYear;
  if (lead >= 1 && lead <= 3) return 10;
  if (lead === 0 || lead === 4) return 5;
  return 0;
}

export function hasImplausibleFilmTiming(
  contractDate: string | null | undefined,
  workYear: number | null | undefined,
  workType: string | null | undefined,
) {
  if (!contractDate || !workYear) return false;
  const normalizedType = normalizeMatchText(workType);
  if (normalizedType.includes("serie")) return false;
  const match = contractDate.match(/\b(19|20)\d{2}\b/);
  if (!match) return false;
  const contractYear = Number(match[0]);
  return workYear < contractYear || workYear > contractYear + 4;
}

export function selectAutomaticMatch<T>(
  candidates: ScoredCandidate<T>[],
  minimumScore: number,
  minimumMargin: number,
) {
  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const first = ranked[0];
  if (!first || first.score < minimumScore) return null;
  if (ranked[1] && first.score - ranked[1].score < minimumMargin) return null;
  return first;
}
