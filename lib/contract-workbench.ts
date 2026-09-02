import type { ContractLayout, LayoutClause } from "@/lib/contract-layout";
import type { ProductionCompanySelection } from "@/lib/production-companies";

export type ContractDocumentVariant = "original" | "commented";

export type ContractSourceDocumentFormat = "pdf" | "doc" | "docx" | "unknown";

export type ContractWorkbenchDocument = {
  path: string;
  url: string | null;
  /** Den uforanderlige upload, som altid bruges ved download. */
  sourcePath: string;
  sourceUrl: string | null;
  sourceFormat: ContractSourceDocumentFormat;
  convertedForViewing: boolean;
};

export type ContractDocumentPresentation = {
  sourceFormat: ContractSourceDocumentFormat;
  hasOriginal: boolean;
  hasOriginalView: boolean;
  hasCommentedPdf: boolean;
  processingLabel: string;
  processingTone: "neutral" | "warning" | "danger" | "success";
};

export type ContractFieldSource =
  | "contract"
  | "agreement"
  | "member"
  | "work_archive"
  | "dfi"
  | "tmdb"
  | "wikidata"
  | "manual"
  | "unknown";

export type ContractFieldEvidence = {
  fieldKey: string;
  quote: string | null;
  clauseId: string | null;
  clause: LayoutClause | null;
  page: number | null;
  focusText?: string | null;
  bbox?: ContractEvidenceBbox | null;
  coordinateSource?: ContractEvidenceCoordinateSource | null;
  confidence?: number | null;
};

export type ContractEvidenceCoordinateSource = "spatial_v3" | "native_pdf" | "legacy_layout";

export type ContractEvidenceBbox = {
  x: number;
  y: number;
  width: number;
  height: number;
  space: "pdf_bottom_left" | "normalized_top_left";
};

export type StoredContractFieldEvidence = {
  quote: string;
  page: number;
  bbox: ContractEvidenceBbox;
  coordinateSource: ContractEvidenceCoordinateSource;
  confidence: number;
  spatialSchemaVersion?: string;
};

export type PdfViewportDimensions = {
  pdfWidth: number;
  pdfHeight: number;
  renderedWidth: number;
  renderedHeight: number;
};

export type PdfViewportRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ContractValidationMissingField = {
  key: string;
  label: string;
  tab: string;
};

export type ContractWorkbenchData<TContract = Record<string, unknown>> = {
  contract: TContract;
  rightsHolders: Array<{ id: string; full_name: string }>;
  works: Array<{
    id: string;
    title: string;
    year: number | null;
    type: string;
    dfi_id?: number | null;
    tmdb_id?: number | null;
    imdb_id?: string | null;
  }>;
  producerSelections: ProductionCompanySelection[];
  documents: Record<ContractDocumentVariant, ContractWorkbenchDocument | null>;
  layout: ContractLayout | null;
  sources: Record<string, string | null>;
  evidence: Record<string, StoredContractFieldEvidence>;
};

export function contractSourceDocumentFormat(path: string | null | undefined): ContractSourceDocumentFormat {
  const extension = String(path ?? "").split(/[?#]/, 1)[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return extension === "pdf" || extension === "doc" || extension === "docx" ? extension : "unknown";
}

export function contractDocumentPresentation(input: {
  originalPath?: string | null;
  originalViewPath?: string | null;
  commentedPath?: string | null;
  processingStatus?: string | null;
}): ContractDocumentPresentation {
  const sourceFormat = contractSourceDocumentFormat(input.originalPath);
  const status = input.processingStatus ?? "pending";
  const state = status === "ready" && !input.commentedPath
    ? { processingLabel: "Behandlet PDF mangler", processingTone: "danger" as const }
    : status === "ready"
    ? { processingLabel: "Kommenteret PDF klar", processingTone: "success" as const }
    : status === "not_required"
      ? { processingLabel: "Original PDF klar", processingTone: "success" as const }
      : status === "processing"
        ? { processingLabel: "Dokument behandles", processingTone: "neutral" as const }
        : status === "needs_review"
          ? { processingLabel: "Kræver manuel kontrol", processingTone: "warning" as const }
          : status === "failed"
            ? { processingLabel: "Dokumentbehandling fejlede", processingTone: "danger" as const }
            : { processingLabel: "Afventer dokumentbehandling", processingTone: "neutral" as const };
  return {
    sourceFormat,
    hasOriginal: Boolean(input.originalPath),
    hasOriginalView: Boolean(input.originalViewPath) || sourceFormat === "pdf",
    hasCommentedPdf: Boolean(input.commentedPath),
    ...state,
  };
}

export const CONTRACT_SOURCE_LABELS: Record<ContractFieldSource, string> = {
  contract: "Kontrakt",
  agreement: "Overenskomst",
  member: "Rettighedshaver",
  work_archive: "Værksarkiv",
  dfi: "DFI",
  tmdb: "TMDB",
  wikidata: "Wikidata",
  manual: "Admin",
  unknown: "Ukendt kilde",
};

export function fieldEvidence(
  fieldKey: string,
  sourceKey: string,
  sources: Record<string, string | null> | null | undefined,
  layout: ContractLayout | null | undefined,
  storedEvidence?: Record<string, StoredContractFieldEvidence> | null,
): ContractFieldEvidence {
  const stored = storedEvidence?.[sourceKey] ?? storedEvidence?.[fieldKey];
  const quote = sources?.[sourceKey] ?? null;
  const clauseId = sources?.[`${sourceKey}_clause_id`] ?? null;
  const rawPage = sources?.[`${sourceKey}_page`] ?? null;
  const parsedPage = rawPage && Number.isFinite(Number(rawPage)) ? Number(rawPage) : null;
  return {
    fieldKey,
    quote: stored?.quote ?? quote,
    clauseId,
    clause: clauseId && layout ? layout.clauses.find(item => item.id === clauseId) ?? null : null,
    page: stored?.page ?? parsedPage,
    bbox: stored?.bbox ?? null,
    coordinateSource: stored?.coordinateSource ?? null,
    confidence: stored?.confidence ?? null,
  };
}

export function evidenceBboxToViewportRect(
  bbox: ContractEvidenceBbox,
  viewport: PdfViewportDimensions,
): PdfViewportRect {
  if (bbox.space === "normalized_top_left") {
    return {
      left: bbox.x * viewport.renderedWidth,
      top: bbox.y * viewport.renderedHeight,
      width: bbox.width * viewport.renderedWidth,
      height: bbox.height * viewport.renderedHeight,
    };
  }
  return pdfBboxToViewportRect(bbox, viewport);
}

export function contractEvidencePage(evidence: ContractFieldEvidence | null | undefined) {
  return evidence?.clause?.page ?? evidence?.page ?? null;
}

export function contractEpisodeNumbersFromLayout(layout: ContractLayout | null | undefined) {
  for (const clause of layout?.clauses ?? []) {
    const match = clause.text.match(/(?:episoder?|afsnit)[^\d]{0,12}\(?\s*(\d{1,3}(?:\s*(?:\+|,|&|\/|og)\s*\d{1,3})+)/iu);
    if (!match?.[1]) continue;
    const numbers = [...match[1].matchAll(/\d{1,3}/g)]
      .map(item => Number(item[0]))
      .filter(number => Number.isInteger(number) && number > 0 && number <= 999);
    if (numbers.length > 0) return [...new Set(numbers)].sort((left, right) => left - right);
  }
  return [];
}

/** Konverterer PDF-koordinater (y=0 ved bunden) til CSS-koordinater. */
export function pdfBboxToViewportRect(
  bbox: { x: number; y: number; width: number; height: number },
  viewport: PdfViewportDimensions,
): PdfViewportRect {
  const scaleX = viewport.renderedWidth / viewport.pdfWidth;
  const scaleY = viewport.renderedHeight / viewport.pdfHeight;
  return {
    left: bbox.x * scaleX,
    top: viewport.renderedHeight - (bbox.y + bbox.height) * scaleY,
    width: bbox.width * scaleX,
    height: bbox.height * scaleY,
  };
}

export function safeContractReturnTo(value: string | null | undefined) {
  if (!value) return "/admin/kontrakter?tab=arkiv";
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.startsWith("/admin/kontrakter") || decoded.startsWith("//")) {
      return "/admin/kontrakter?tab=arkiv";
    }
    return decoded;
  } catch {
    return "/admin/kontrakter?tab=arkiv";
  }
}

function normalizedWorkTitle(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("da")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function contractSeriesBaseTitle(title: string) {
  return title
    .replace(/\s*[-–—,:]?\s*(?:sæson|season)\s*(?:\d{1,2}|[ivxlcdm]+)\s*$/iu, "")
    .replace(/\s+(?:\d{1,2}|[ivxlcdm]+)\s*$/iu, "")
    .trim();
}

export function suggestLocalContractWork<T extends { id: string; title: string; type: string }>(workingTitle: string, works: T[]) {
  const baseTitle = contractSeriesBaseTitle(workingTitle);
  const normalizedBase = normalizedWorkTitle(baseTitle);
  if (!normalizedBase) return null;
  const exactMatches = works.filter(work => normalizedWorkTitle(work.title) === normalizedBase);
  if (exactMatches.length !== 1) return null;
  return exactMatches[0];
}

export function findContractTypeEvidence(contractType: string | null | undefined, layout: ContractLayout | null | undefined) {
  if (!layout?.clauses.length) return null;
  const isSalaryContract = String(contractType ?? "").toLocaleLowerCase("da") === "a-løn";
  const patterns = isSalaryContract
    ? [
        { pattern: /\b(?:a\.?\s*)?ugeløn\b/iu, score: 8 },
        { pattern: /\baftalt\s+løn\b/iu, score: 8 },
        { pattern: /\bgrundløn\b/iu, score: 7 },
        { pattern: /\blønmodtager\b/iu, score: 7 },
        { pattern: /\bmedarbejderen\b/iu, score: 3 },
        { pattern: /\bpensionsbidrag\b/iu, score: 3 },
      ]
    : [
        { pattern: /\bleverandør(?:en)?\b/iu, score: 8 },
        { pattern: /\bfaktura(?:beløb|ering)?\b/iu, score: 6 },
        { pattern: /\bhonorar\b/iu, score: 5 },
        { pattern: /\bmoms\b/iu, score: 3 },
      ];

  const candidates = layout.clauses.map(clause => {
    const matches = patterns.filter(item => item.pattern.test(clause.text));
    return {
      clause,
      score: matches.reduce((sum, item) => sum + item.score, 0),
      focusText: matches[0]?.pattern.exec(clause.text)?.[0] ?? null,
    };
  }).filter(candidate => candidate.score >= 6 && candidate.focusText);

  candidates.sort((left, right) => right.score - left.score || left.clause.text.length - right.clause.text.length);
  const best = candidates[0];
  if (!best) return null;
  const lines = best.clause.text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const quote = lines.find(line => best.focusText && line.toLocaleLowerCase("da").includes(best.focusText.toLocaleLowerCase("da")))
    ?? best.clause.text.trim();
  return {
    quote: quote.slice(0, 320),
    focusText: best.focusText,
    clauseId: best.clause.id,
    page: best.clause.page,
  };
}
