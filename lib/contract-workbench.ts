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
  | "stored"
  | "unknown";

export type ContractFieldEvidence = {
  fieldKey: string;
  quote: string | null;
  clauseId: string | null;
  clause: LayoutClause | null;
  page: number | null;
  focusText?: string | null;
  bbox?: ContractEvidenceBbox | null;
  /** Flere præcise linjebokse for en sammenhængende klausul. `bbox` er deres samlede fokusområde. */
  bboxes?: ContractEvidenceBbox[] | null;
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
  /** Server-authoriseret. Må aldrig udledes alene af, hvad klienten viser. */
  canManageOwnership?: boolean;
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
    ? { processingLabel: "Konverteret PDF klar", processingTone: "success" as const }
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
  stored: "Registreret",
  unknown: "Ukendt kilde",
};

const CLAUSE_LEVEL_EVIDENCE_SOURCES = new Set([
  "collectiveAgreement", "copydan", "svod", "royalty", "prolongation",
  "creditedRoles", "hasCreditClause", "aiDataMiningClause", "futureRightsReservation",
]);

function expandedClauseBboxes(layout: ContractLayout, clause: LayoutClause) {
  if (!clause.pdfBbox) return [];
  const startIndex = layout.clauses.findIndex(item => item.id === clause.id);
  if (startIndex < 0) return [clause.pdfBbox];

  const boxes = [clause.pdfBbox];
  let previous = clause;
  for (const next of layout.clauses.slice(startIndex + 1, startIndex + 8)) {
    if (next.page !== clause.page || !next.pdfBbox || next.numbered || next.bold) break;
    const previousBox = previous.pdfBbox;
    if (!previousBox) break;

    // Ældre PDF-layouts kan have gemt hver linje som en selvstændig klausul.
    // Kun en enkeltlinjet startboks må derfor udvides, og kun over linjer med
    // samme venstrekant og almindelig linjeafstand. Et større afsnitsmellemrum
    // afslutter markeringen, så næste juridiske bestemmelse ikke tages med.
    const lineHeight = Math.max(previousBox.height, next.pdfBbox.height);
    const verticalGap = previousBox.y - (next.pdfBbox.y + next.pdfBbox.height);
    const leftAligned = Math.abs(next.pdfBbox.x - clause.pdfBbox.x) <= Math.max(24, clause.pdfBbox.width * 0.08);
    const startsAsSingleLine = clause.pdfBbox.height <= Math.max(18, next.pdfBbox.height * 1.75);
    if (!startsAsSingleLine || !leftAligned || verticalGap < -lineHeight || verticalGap > lineHeight * 2.1) break;
    boxes.push(next.pdfBbox);
    previous = next;
  }

  return boxes;
}

function boundingUnion(boxes: Array<{ x: number; y: number; width: number; height: number }>) {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map(box => box.x));
  const bottom = Math.min(...boxes.map(box => box.y));
  const right = Math.max(...boxes.map(box => box.x + box.width));
  const top = Math.max(...boxes.map(box => box.y + box.height));
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}

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
  const clause = clauseId && layout ? layout.clauses.find(item => item.id === clauseId) ?? null : null;
  // Juridiske kildehenvisninger skal vise hele den identificerede klausul og
  // ikke kun den første OCR-linje. Korte identitetsfelter beholder den mere
  // præcise ord-boks fra spatial OCR.
  const legalClauseBbox = clause && layout && CLAUSE_LEVEL_EVIDENCE_SOURCES.has(sourceKey)
    ? expandedClauseBboxes(layout, clause)
    : [];
  const legalClauseUnion = boundingUnion(legalClauseBbox);
  const clauseBbox = legalClauseBbox
    ? legalClauseUnion && { ...legalClauseUnion, space: "pdf_bottom_left" as const }
    : null;
  return {
    fieldKey,
    quote: stored?.quote ?? quote,
    clauseId,
    clause,
    page: stored?.page ?? parsedPage,
    bbox: clauseBbox ?? stored?.bbox ?? null,
    bboxes: legalClauseBbox.length ? legalClauseBbox.map(box => ({ ...box, space: "pdf_bottom_left" as const })) : null,
    coordinateSource: clauseBbox ? "legacy_layout" : stored?.coordinateSource ?? null,
    confidence: clauseBbox ? 0.9 : stored?.confidence ?? null,
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
        { pattern: /\b(?:under)?leverandør[a-zæøå]*\b/iu, score: 8 },
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

export function findCopydanEvidence(layout: ContractLayout | null | undefined) {
  if (!layout?.clauses.length) return null;
  const patterns = [
    { pattern: /\b(?:copy-?dan|aftalelicens)\b/iu, score: 10 },
    { pattern: /\bophavsretsloven\s*§\s*50\b/iu, score: 9 },
    { pattern: /\bvederlag,\s*forvaltet\s*af\s*copy-?dan\b/iu, score: 10 },
    { pattern: /\bkopiering\s+til\s+privat\s+brug\b/iu, score: 7 },
  ];
  const candidates = layout.clauses.map(clause => {
    const matches = patterns.filter(item => item.pattern.test(clause.text));
    return {
      clause,
      score: matches.reduce((sum, item) => sum + item.score, 0),
      focusText: matches[0]?.pattern.exec(clause.text)?.[0] ?? null,
    };
  }).filter(candidate => candidate.score >= 7);

  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  if (!best) return null;
  return {
    quote: best.clause.text.slice(0, 320).trim(),
    focusText: best.focusText,
    clauseId: best.clause.id,
    page: best.clause.page,
  };
}

export function findSvodEvidence(layout: ContractLayout | null | undefined) {
  if (!layout?.clauses.length) return null;
  const patterns = [
    { pattern: /\b(?:svod|create\s+denmark)\b/iu, score: 10 },
    { pattern: /\b(?:kompensation\s+for\s+netflix|netflixs?\s+manglende\s+anerkendelse)\b/iu, score: 10 },
    { pattern: /\b(?:streaming|on-demand)\s*(?:forbehold|aftale|kompensation|vederlag)\b/iu, score: 9 },
    { pattern: /\bvendedistribution\s+af\s+netflix\b/iu, score: 8 },
    { pattern: /\bnetflix\b/iu, score: 5 },
  ];
  const candidates = layout.clauses.map(clause => {
    const matches = patterns.filter(item => item.pattern.test(clause.text));
    return {
      clause,
      score: matches.reduce((sum, item) => sum + item.score, 0),
      focusText: matches[0]?.pattern.exec(clause.text)?.[0] ?? null,
    };
  }).filter(candidate => candidate.score >= 7);

  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  if (!best) return null;
  return {
    quote: best.clause.text.slice(0, 320).trim(),
    focusText: best.focusText,
    clauseId: best.clause.id,
    page: best.clause.page,
  };
}

export function findSignatureEvidence(layout: ContractLayout | null | undefined) {
  if (!layout?.clauses.length) return null;
  const lastPage = Math.max(1, ...(layout.clauses.map(c => Number(c.page) || 1)));
  // Underskrifter og datoangivelser findes altid på sidste eller næstsidste side
  const candidates = layout.clauses.filter(clause => (clause.page ?? 1) >= Math.max(1, lastPage - 1));
  const patterns = [
    { pattern: /\bfor\s+(?:producenten|arbejdsgiveren)\b/iu, score: 10 },
    { pattern: /\bfor\s+(?:lønmodtageren|medarbejderen|klipperen|leverandøren)\b/iu, score: 10 },
    { pattern: /\b(?:penneo|docusign|adobe\s*sign|digitalt\s+signeret|mitid)\b/iu, score: 10 },
    { pattern: /\b(?:dato\s*[,:]\s*sted|sted\s*[,:]\s*dato|dato\s+og\s+underskrift)\b/iu, score: 9 },
    { pattern: /_{3,}/, score: 6 },
    { pattern: /\bunderskrift\b/iu, score: 4 },
  ];
  const scored = candidates.map(clause => {
    const matches = patterns.filter(item => item.pattern.test(clause.text));
    return {
      clause,
      score: matches.reduce((sum, item) => sum + item.score, 0),
    };
  }).filter(c => c.score >= 5);

  scored.sort((a, b) => b.score - a.score || b.clause.page - a.clause.page);
  const best = scored[0];
  if (!best) {
    return {
      quote: "",
      clauseId: null,
      page: lastPage,
    };
  }
  return {
    quote: best.clause.text.slice(0, 320).trim(),
    clauseId: best.clause.id,
    page: best.clause.page,
  };
}

export function findProducerEvidence(layout: ContractLayout | null | undefined, workingTitle?: string | null) {
  if (!layout?.clauses?.length && !workingTitle) return null;

  // 1. Prøv fra workingTitle, hvis titlen følger formatet: "Værktitel, Producent, Funktion, Medlem..."
  const titleParts = workingTitle ? workingTitle.split(",").map(part => part.trim()).filter(Boolean) : [];
  const candidateFromTitle = titleParts.length >= 2 ? titleParts[1] : null;

  // 2. Søg i layout klausuler på side 1 og 2
  const p1Clauses = layout?.clauses?.filter(c => (c.page ?? 1) <= 2) ?? [];
  const prodIndex = p1Clauses.findIndex(c => /herefter\s*kaldet\s*(?:producenten|arbejdsgiveren|selskabet)/i.test(c.text));

  if (prodIndex > 0) {
    // Klausulerne foran "herefter kaldet Producenten" indeholder firmanavn og evt. CVR
    const preceding = p1Clauses.slice(0, prodIndex);
    // Find klausul med ApS / A/S / Productions / Film / Entertainment eller som matcher title-kandidat
    const nameClause = preceding.find(c => {
      const t = c.text.toLocaleLowerCase("da");
      if (candidateFromTitle && (t.includes(candidateFromTitle.replace(/\s+/g, "").toLocaleLowerCase("da")) || t.includes(candidateFromTitle.toLocaleLowerCase("da")))) {
        return true;
      }
      return /(?:aps|a\/s|productions?|film|entertainment|media|pictures)\b/i.test(c.text);
    }) ?? preceding[1] ?? preceding[0];

    if (nameClause) {
      const cleanName = candidateFromTitle && nameClause.text.toLocaleLowerCase("da").includes(candidateFromTitle.replace(/\s+/g, "").toLocaleLowerCase("da"))
        ? candidateFromTitle
        : nameClause.text.replace(/^[–—\s*•-]+/, "").trim();

      return {
        quote: nameClause.text.slice(0, 320).trim(),
        clauseId: nameClause.id,
        page: nameClause.page,
        producerName: cleanName,
      };
    }
  }

  // 3. Fallback til kandidat fra titlen
  if (candidateFromTitle && candidateFromTitle.length > 2) {
    const matchingClause = p1Clauses.find(c => c.text.toLocaleLowerCase("da").includes(candidateFromTitle.replace(/\s+/g, "").toLocaleLowerCase("da")));
    return {
      quote: matchingClause ? matchingClause.text.slice(0, 320).trim() : candidateFromTitle,
      clauseId: matchingClause?.id ?? null,
      page: matchingClause?.page ?? 1,
      producerName: candidateFromTitle,
    };
  }

  return null;
}
