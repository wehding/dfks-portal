import type { ContractLayout } from "@/lib/contract-layout";
import { matchCitationToClause } from "@/lib/contract-layout-store";
import type { StoredContractFieldEvidence } from "@/lib/contract-workbench";

type SpatialVertex = { x?: number; y?: number };
type SpatialWord = { text?: string; confidence?: number; vertices?: SpatialVertex[] };
type SpatialPage = {
  pageNumber?: number;
  imageWidth?: number;
  imageHeight?: number;
  words?: SpatialWord[];
};

export type SpatialV3Artifact = {
  schemaVersion: "google-vision-spatial-v3";
  pages: SpatialPage[];
  spatialVerification?: { passed?: boolean; score?: number; matchCoverage?: number };
};

function normalizedToken(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("da").replace(/[^a-z0-9]+/g, "");
}

function sourceEntries(sources: Record<string, string | null>) {
  return Object.entries(sources).filter(([key, value]) =>
    Boolean(value?.trim()) && !/(?:_clause_id|_page|_focus)$/.test(key),
  ) as Array<[string, string]>;
}

function quoteTokens(quote: string) {
  return quote.split(/\s+/).map(normalizedToken).filter(token => token.length > 0);
}

function findWordRange(words: SpatialWord[], quote: string) {
  const expected = quoteTokens(quote);
  if (expected.length === 0) return null;
  const actual = words.map(word => normalizedToken(word.text ?? ""));
  const candidates: Array<{ start: number; end: number; coverage: number }> = [];
  const minimumMatched = Math.min(expected.length, Math.max(1, expected.length <= 3 ? expected.length : Math.ceil(expected.length * 0.7)));

  for (let start = 0; start < actual.length; start += 1) {
    if (actual[start] !== expected[0]) continue;
    let actualIndex = start;
    let expectedIndex = 0;
    while (actualIndex < actual.length && expectedIndex < expected.length && actualIndex - start <= expected.length + 5) {
      if (actual[actualIndex] === expected[expectedIndex]) expectedIndex += 1;
      actualIndex += 1;
    }
    if (expectedIndex >= minimumMatched) {
      candidates.push({ start, end: actualIndex - 1, coverage: expectedIndex / expected.length });
    }
  }

  candidates.sort((left, right) => right.coverage - left.coverage || (left.end - left.start) - (right.end - right.start));
  if (!candidates[0] || candidates[0].coverage < 0.7) return null;
  if (candidates[1] && Math.abs(candidates[0].coverage - candidates[1].coverage) < 0.01) return null;
  return candidates[0];
}

function spatialEvidenceForQuote(artifact: SpatialV3Artifact, quote: string): StoredContractFieldEvidence | null {
  const matches = artifact.pages.flatMap(page => {
    const words = page.words ?? [];
    const range = findWordRange(words, quote);
    if (!range) return [];
    const matchedWords = words.slice(range.start, range.end + 1);
    const vertices = matchedWords.flatMap(word => word.vertices ?? []).filter(vertex => Number.isFinite(vertex.x) && Number.isFinite(vertex.y));
    const width = Number(page.imageWidth ?? 0);
    const height = Number(page.imageHeight ?? 0);
    if (!vertices.length || width <= 0 || height <= 0) return [];
    const xs = vertices.map(vertex => Number(vertex.x));
    const ys = vertices.map(vertex => Number(vertex.y));
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const right = Math.max(...xs);
    const bottom = Math.max(...ys);
    const wordConfidence = matchedWords.reduce((sum, word) => sum + Number(word.confidence ?? 1), 0) / matchedWords.length;
    return [{
      quote,
      page: Math.max(1, Number(page.pageNumber ?? 1)),
      bbox: { x: left / width, y: top / height, width: Math.max(1, right - left) / width, height: Math.max(1, bottom - top) / height, space: "normalized_top_left" as const },
      coordinateSource: "spatial_v3" as const,
      confidence: Math.min(1, range.coverage * wordConfidence),
      spatialSchemaVersion: artifact.schemaVersion,
    }];
  });
  if (matches.length !== 1 || matches[0].confidence < 0.5) return null;
  return matches[0];
}

export function isSpatialV3Artifact(value: unknown): value is SpatialV3Artifact {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SpatialV3Artifact>;
  return candidate.schemaVersion === "google-vision-spatial-v3"
    && Array.isArray(candidate.pages)
    && candidate.spatialVerification?.passed !== false;
}

export function resolveSpatialV3Evidence(
  sources: Record<string, string | null>,
  artifact: SpatialV3Artifact,
) {
  const result: Record<string, StoredContractFieldEvidence> = {};
  for (const [key, quote] of sourceEntries(sources)) {
    const evidence = spatialEvidenceForQuote(artifact, quote);
    if (evidence) result[key] = evidence;
  }
  return result;
}

export function resolveNativeLayoutEvidence(
  sources: Record<string, string | null>,
  layout: ContractLayout | null | undefined,
) {
  const result: Record<string, StoredContractFieldEvidence> = {};
  if (!layout) return result;
  for (const [key, quote] of sourceEntries(sources)) {
    const clauseId = sources[`${key}_clause_id`] ?? matchCitationToClause(quote, layout);
    const clause = clauseId ? layout.clauses.find(item => item.id === clauseId) : null;
    if (!clause?.pdfBbox) continue;
    result[key] = {
      quote,
      page: clause.page,
      bbox: { ...clause.pdfBbox, space: "pdf_bottom_left" },
      coordinateSource: "native_pdf",
      confidence: 0.9,
    };
  }
  return result;
}

export function mergeContractEvidence(
  existing: Record<string, StoredContractFieldEvidence> | null | undefined,
  nativeEvidence: Record<string, StoredContractFieldEvidence>,
  spatialEvidence: Record<string, StoredContractFieldEvidence>,
) {
  return { ...(existing ?? {}), ...nativeEvidence, ...spatialEvidence };
}

export function sanitizeStoredContractEvidence(value: unknown) {
  const result: Record<string, StoredContractFieldEvidence> = {};
  if (!value || typeof value !== "object") return result;
  for (const [key, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Partial<StoredContractFieldEvidence>;
    const bbox = candidate.bbox;
    if (
      typeof candidate.quote !== "string"
      || !Number.isInteger(candidate.page) || Number(candidate.page) < 1
      || !bbox || ![bbox.x, bbox.y, bbox.width, bbox.height].every(Number.isFinite)
      || bbox.width <= 0 || bbox.height <= 0
      || !["pdf_bottom_left", "normalized_top_left"].includes(bbox.space)
      || !["spatial_v3", "native_pdf", "legacy_layout"].includes(String(candidate.coordinateSource))
      || !Number.isFinite(candidate.confidence)
    ) continue;
    if (bbox.space === "normalized_top_left" && (bbox.x < 0 || bbox.y < 0 || bbox.x + bbox.width > 1.01 || bbox.y + bbox.height > 1.01)) continue;
    result[key] = candidate as StoredContractFieldEvidence;
  }
  return result;
}
