export type ContractDocumentReviewAction = "retry" | "request_rescan";
export type ContractDocumentRecommendedAction = "retry" | "rescan" | "technical";

export type ContractDocumentReviewDescriptor = {
  title: string;
  reason: string;
  recommendedAction: ContractDocumentRecommendedAction;
};

export type ContractDocumentReviewData = {
  status: string;
  errorCode: string | null;
  title: string;
  reason: string;
  pageCount: number | null;
  affectedPages: number[];
  affectedPagesText: string;
  attempts: number;
  reviewDisposition: string | null;
  recommendedAction: ContractDocumentRecommendedAction;
  canRetry: boolean;
  canRequestRescan: boolean;
};

type ReviewContext = {
  status: string | null | undefined;
  errorCode: string | null | undefined;
  reviewDisposition?: string | null;
  contractStatus?: string | null;
  hasRightsHolder?: boolean;
  hasJob?: boolean;
};

const RETRY = "retry" satisfies ContractDocumentRecommendedAction;
const RESCAN = "rescan" satisfies ContractDocumentRecommendedAction;
const TECHNICAL = "technical" satisfies ContractDocumentRecommendedAction;
const ADMIN_RETRYABLE_ERROR_CODES = new Set([
  "ocr_spatial_quality",
  "dlp_location_invalid",
  "processed_file_too_large",
  "vision_page_too_large",
  "vision_response_too_large",
]);

/**
 * Safe, user-facing descriptions only. Never display the worker's raw error,
 * storage paths, filenames, hashes, OCR text or provider response in the UI.
 */
export const CONTRACT_DOCUMENT_REVIEW_DESCRIPTORS: Readonly<Record<string, ContractDocumentReviewDescriptor>> = Object.freeze({
  ocr_no_readable_text: {
    title: "Teksten kunne ikke aflæses",
    reason: "OCR fandt ikke nok læsbar kontrakttekst. Der skal bruges en tydeligere scanning.",
    recommendedAction: RESCAN,
  },
  ocr_unreadable_page: {
    title: "En eller flere sider kan ikke aflæses",
    reason: "Mindst én side gav ikke læsbar tekst. Der skal bruges en ny og tydelig scanning.",
    recommendedAction: RESCAN,
  },
  orientation_uncertain: {
    title: "Sidens retning skal kontrolleres",
    reason: "Systemet kunne ikke sikkert afgøre retningen. Der skal bruges en ny scanning med alle sider vendt korrekt.",
    recommendedAction: RESCAN,
  },
  ocr_spatial_quality: {
    title: "Tekstlagets placering skal kontrolleres",
    reason: "Det søgbare tekstlag ligger ikke sikkert nok oven på ordene i dokumentet.",
    recommendedAction: RETRY,
  },
  page_geometry_unavailable: {
    title: "Sidens placering kunne ikke måles",
    reason: "Systemet kunne ikke beregne sidens størrelse og tekstplacering sikkert.",
    recommendedAction: TECHNICAL,
  },
  ocr_rescan_required: {
    title: "Der skal bruges en ny scanning",
    reason: "Dokumentets kvalitet er for lav til automatisk behandling. Upload en lige og tydelig scanning uden skygger eller baggrund.",
    recommendedAction: RESCAN,
  },
  invalid_pdf: {
    title: "Filen er ikke en gyldig PDF",
    reason: "PDF-filen kan ikke åbnes sikkert. Upload dokumentet igen som en gyldig PDF.",
    recommendedAction: RESCAN,
  },
  file_too_large: {
    title: "PDF-filen er for stor",
    reason: "Filen er større end den tilladte grænse på 25 MB. Upload en mindre PDF uden at gøre teksten utydelig.",
    recommendedAction: RESCAN,
  },
  processed_file_too_large: {
    title: "Den behandlede PDF blev for stor",
    reason: "PDF'en overskred den sikre størrelsesgrænse efter OCR-behandlingen.",
    recommendedAction: RETRY,
  },
  document_page_limit_exceeded: {
    title: "Dokumentet har for mange sider",
    reason: "Dokumentet overskrider den sikre sidegrænse. Upload kontrakten uden uvedkommende bilag, eller del den op.",
    recommendedAction: RESCAN,
  },
  document_raster_budget_exceeded: {
    title: "Scanningen er for stor at behandle",
    reason: "Sidernes samlede opløsning overskrider den sikre behandlingsgrænse. Upload en mindre, tydelig scanning.",
    recommendedAction: RESCAN,
  },
  document_text_limit_exceeded: {
    title: "Dokumentets tekstmængde er for stor",
    reason: "Den aflæste tekst overskred den sikre behandlingsgrænse.",
    recommendedAction: TECHNICAL,
  },
  dlp_request_too_large: {
    title: "Siden er for stor til persondatakontrollen",
    reason: "Siden overskred grænsen for den automatiske persondatakontrol.",
    recommendedAction: TECHNICAL,
  },
  dlp_response_too_large: {
    title: "Persondatakontrollen gav for mange data",
    reason: "Resultatet fra persondatakontrollen overskred den sikre behandlingsgrænse.",
    recommendedAction: TECHNICAL,
  },
  dlp_too_many_locations: {
    title: "Der blev fundet for mange områder til maskering",
    reason: "Dokumentet indeholder flere registrerede områder, end systemet kan behandle sikkert i én kørsel.",
    recommendedAction: TECHNICAL,
  },
  dlp_location_invalid: {
    title: "Et maskeringsområde kunne ikke kontrolleres",
    reason: "Placeringen af et følsomt område var ugyldig og blev derfor afvist.",
    recommendedAction: RETRY,
  },
  dlp_location_out_of_bounds: {
    title: "Et maskeringsområde lå uden for siden",
    reason: "Placeringen af et følsomt område kunne ikke anvendes sikkert på siden.",
    recommendedAction: TECHNICAL,
  },
  dlp_location_missing: {
    title: "Et maskeringsområde manglede",
    reason: "Persondatakontrollen fandt følsomme oplysninger uden en sikker placering på siden.",
    recommendedAction: TECHNICAL,
  },
  dlp_redacted_image_missing: {
    title: "Den maskerede side mangler",
    reason: "Persondatakontrollen returnerede ikke den forventede maskerede side.",
    recommendedAction: TECHNICAL,
  },
  dlp_redacted_image_invalid: {
    title: "Den maskerede side er ugyldig",
    reason: "Den maskerede side kunne ikke godkendes som et sikkert billede.",
    recommendedAction: TECHNICAL,
  },
  dlp_redaction_not_applied: {
    title: "Maskeringen kunne ikke bekræftes",
    reason: "Systemet kunne ikke bekræfte, at alle følsomme områder var blevet maskeret.",
    recommendedAction: TECHNICAL,
  },
  dlp_image_dimensions_changed: {
    title: "Den maskerede side ændrede størrelse",
    reason: "Sidens mål ændrede sig under persondatakontrollen, og resultatet blev derfor afvist.",
    recommendedAction: TECHNICAL,
  },
  dlp_canonical_image_invalid: {
    title: "Den kontrollerede side er ugyldig",
    reason: "Den endelige maskerede side kunne ikke sikkerhedsgodkendes.",
    recommendedAction: TECHNICAL,
  },
  vision_page_too_large: {
    title: "Siden er for stor til OCR",
    reason: "En side overskred den sikre grænse for OCR-behandling.",
    recommendedAction: RETRY,
  },
  vision_page_invalid: {
    title: "OCR-siden kunne ikke valideres",
    reason: "Google Vision returnerede ikke en sidegeometri, som kunne sikkerhedsverificeres.",
    recommendedAction: TECHNICAL,
  },
  vision_request_too_large: {
    title: "OCR-anmodningen er for stor",
    reason: "Dokumentet overskred den sikre grænse for én OCR-anmodning.",
    recommendedAction: TECHNICAL,
  },
  vision_response_too_large: {
    title: "OCR-resultatet er for stort",
    reason: "OCR-resultatet overskred den sikre behandlingsgrænse.",
    recommendedAction: RETRY,
  },
  vision_word_limit_exceeded: {
    title: "OCR fandt for mange ord",
    reason: "Antallet af aflæste ord overskred den sikre behandlingsgrænse.",
    recommendedAction: TECHNICAL,
  },
  vision_page_dimension_mismatch: {
    title: "OCR-siden har forkerte mål",
    reason: "Sidens mål stemte ikke overens før og efter OCR-behandlingen.",
    recommendedAction: TECHNICAL,
  },
  vision_response_invalid: {
    title: "OCR-resultatet kunne ikke læses",
    reason: "OCR-tjenesten returnerede ikke et gyldigt resultat.",
    recommendedAction: TECHNICAL,
  },
  vision_document_failed: {
    title: "OCR kunne ikke behandle dokumentet",
    reason: "OCR-tjenesten kunne ikke færdigbehandle dokumentet.",
    recommendedAction: TECHNICAL,
  },
  spatial_artifact_too_large: {
    title: "Dokumentets kildemarkeringer er for store",
    reason: "Geometridata til præcise kildehenvisninger overskred den sikre grænse.",
    recommendedAction: TECHNICAL,
  },
  original_sha256_mismatch: {
    title: "Originalfilens integritet kunne ikke bekræftes",
    reason: "Den gemte originalfil stemte ikke overens med dokumentets tidligere kontrol. Filen blev ikke sendt til OCR.",
    recommendedAction: TECHNICAL,
  },
  invalid_download_origin: {
    title: "Den sikre filadresse blev afvist",
    reason: "Den midlertidige filadresse kom ikke fra den forventede lagerkonto.",
    recommendedAction: TECHNICAL,
  },
  signed_url_failed: {
    title: "Sikker adgang til PDF'en fejlede",
    reason: "Systemet kunne ikke oprette midlertidig adgang til den private PDF-fil.",
    recommendedAction: TECHNICAL,
  },
  download_failed: {
    title: "PDF'en kunne ikke hentes",
    reason: "Systemet kunne ikke hente den private PDF-fil til behandling.",
    recommendedAction: TECHNICAL,
  },
  upload_failed: {
    title: "Den behandlede PDF kunne ikke gemmes",
    reason: "OCR-resultatet kunne ikke gemmes sikkert.",
    recommendedAction: TECHNICAL,
  },
  spatial_upload_failed: {
    title: "Kildemarkeringerne kunne ikke gemmes",
    reason: "Geometridata til præcise kildehenvisninger kunne ikke gemmes sikkert.",
    recommendedAction: TECHNICAL,
  },
  upload_authorisation_failed: {
    title: "Uploadtilladelsen kunne ikke oprettes",
    reason: "Systemet kunne ikke oprette kortvarig tilladelse til at gemme OCR-resultatet.",
    recommendedAction: TECHNICAL,
  },
  invalid_upload_authorisation_response: {
    title: "Uploadtilladelsen var ugyldig",
    reason: "Systemet modtog ikke en gyldig tilladelse til at gemme OCR-resultatet.",
    recommendedAction: TECHNICAL,
  },
  google_access_token_failed: {
    title: "OCR-tjenesten kunne ikke godkendes",
    reason: "Systemet kunne ikke oprette kortvarig, sikker adgang til OCR-tjenesten.",
    recommendedAction: TECHNICAL,
  },
  google_endpoint_rejected: {
    title: "OCR-tjenestens EU-endpoint blev afvist",
    reason: "Sikkerhedskontrollen kunne ikke bekræfte det tilladte europæiske endpoint.",
    recommendedAction: TECHNICAL,
  },
  google_request_failed: {
    title: "Forbindelsen til OCR-tjenesten fejlede",
    reason: "OCR-tjenesten kunne ikke nås sikkert.",
    recommendedAction: TECHNICAL,
  },
  google_request_timeout: {
    title: "OCR-tjenesten svarede ikke i tide",
    reason: "Den sikre forbindelse til OCR-tjenesten fik timeout.",
    recommendedAction: TECHNICAL,
  },
  google_response_invalid: {
    title: "OCR-tjenestens svar var ugyldigt",
    reason: "Systemet kunne ikke validere svaret fra OCR-tjenesten.",
    recommendedAction: TECHNICAL,
  },
  google_tls_version_rejected: {
    title: "Den sikre forbindelse blev afvist",
    reason: "Forbindelsen til OCR-tjenesten opfyldte ikke kravet til kryptering.",
    recommendedAction: TECHNICAL,
  },
  google_ocr_service_failed: {
    title: "OCR-tjenesten fejlede",
    reason: "Den eksterne OCR-tjeneste kunne ikke behandle dokumentet.",
    recommendedAction: TECHNICAL,
  },
  invalid_google_ocr_configuration: {
    title: "OCR-tjenesten er ikke konfigureret korrekt",
    reason: "Den sikre Google OCR-konfiguration kunne ikke valideres.",
    recommendedAction: TECHNICAL,
  },
  identity_token_failed: {
    title: "Dokumentworkerens adgang fejlede",
    reason: "Dokumentworkeren kunne ikke godkende sig sikkert over for portalen.",
    recommendedAction: TECHNICAL,
  },
  portal_request_failed: {
    title: "Dokumentworkeren kunne ikke kontakte portalen",
    reason: "Den sikre forbindelse mellem dokumentworkeren og portalen fejlede.",
    recommendedAction: TECHNICAL,
  },
  claim_failed: {
    title: "Dokumentjobbet kunne ikke startes",
    reason: "Systemet kunne ikke reservere dokumentjobbet sikkert.",
    recommendedAction: TECHNICAL,
  },
  document_lease_renewal_failed: {
    title: "Dokumentjobbets reservation udløb",
    reason: "Dokumentworkeren kunne ikke forny sin sikre reservation af jobbet.",
    recommendedAction: TECHNICAL,
  },
  completion_callback_failed: {
    title: "Resultatet kunne ikke registreres",
    reason: "Dokumentworkeren kunne ikke registrere det afsluttede resultat i portalen.",
    recommendedAction: TECHNICAL,
  },
  completion_generation_conflict: {
    title: "En nyere behandling findes allerede",
    reason: "Resultatet tilhørte en ældre jobgeneration og blev derfor afvist.",
    recommendedAction: TECHNICAL,
  },
  completion_integrity_rejected: {
    title: "Resultatets integritet blev afvist",
    reason: "Kontrolværdierne for det behandlede dokument stemte ikke.",
    recommendedAction: TECHNICAL,
  },
  completion_lease_inactive: {
    title: "Dokumentjobbet er ikke længere aktivt",
    reason: "Resultatet kom fra en udløbet eller erstattet jobreservation.",
    recommendedAction: TECHNICAL,
  },
  completion_persistence_failed: {
    title: "Resultatet kunne ikke gemmes",
    reason: "Portalen kunne ikke gemme dokumentbehandlingens status sikkert.",
    recommendedAction: TECHNICAL,
  },
  processing_deadline_exceeded: {
    title: "Dokumentbehandlingen tog for lang tid",
    reason: "Behandlingen overskred den sikre tidsgrænse.",
    recommendedAction: TECHNICAL,
  },
  processing_aborted: {
    title: "Dokumentbehandlingen blev afbrudt",
    reason: "Behandlingen blev stoppet, før resultatet var færdigt.",
    recommendedAction: TECHNICAL,
  },
  document_processing_failed: {
    title: "PDF-behandlingen fejlede",
    reason: "PDF'en kunne ikke behandles efter de automatiske forsøg.",
    recommendedAction: TECHNICAL,
  },
  max_attempts_exceeded: {
    title: "De automatiske forsøg er opbrugt",
    reason: "PDF'en kunne ikke behandles efter det maksimale antal automatiske forsøg.",
    recommendedAction: TECHNICAL,
  },
  low_text_quality: {
    title: "Tekstkvaliteten er for lav",
    reason: "Den aflæste tekst var ikke tydelig nok til sikker automatisk behandling.",
    recommendedAction: RESCAN,
  },
});

const UNKNOWN_DESCRIPTOR: ContractDocumentReviewDescriptor = Object.freeze({
  title: "PDF'en kræver kontrol",
  reason: "PDF'en kunne ikke sikkerhedsbehandles automatisk og kræver manuel kontrol.",
  recommendedAction: TECHNICAL,
});

export function sanitizeContractDocumentReviewErrorCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (Object.prototype.hasOwnProperty.call(CONTRACT_DOCUMENT_REVIEW_DESCRIPTORS, value)) return value;
  return /^(?:google|dlp|vision)_api_[1-5][0-9]{2}$/.test(value) ? value : null;
}

export function contractDocumentReviewDescriptor(
  errorCode: string | null | undefined,
): ContractDocumentReviewDescriptor {
  if (!errorCode) return UNKNOWN_DESCRIPTOR;
  if (/^(?:google|dlp|vision)_api_[1-5][0-9]{2}$/.test(errorCode)) {
    return {
      title: "OCR-tjenesten returnerede en teknisk fejl",
      reason: "Den eksterne OCR- eller persondatatjeneste kunne ikke gennemføre behandlingen.",
      recommendedAction: TECHNICAL,
    };
  }
  return CONTRACT_DOCUMENT_REVIEW_DESCRIPTORS[errorCode] ?? UNKNOWN_DESCRIPTOR;
}

export function sanitizeAffectedPageNumbers(value: unknown, pageCount?: number | null): number[] {
  if (!Array.isArray(value)) return [];
  const maximum = Number.isInteger(pageCount) && Number(pageCount) > 0
    ? Math.min(Number(pageCount), 200)
    : 200;
  return [...new Set(value.filter((page): page is number => (
    Number.isInteger(page) && page >= 1 && page <= maximum
  )))].sort((a, b) => a - b).slice(0, 200);
}

export function sanitizeContractDocumentReviewDetails(value: unknown, pageCount?: number | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { schemaVersion: 1 as const, reasons: [] as Array<{ code: string; pageNumbers: number[] }> };
  }
  const details = value as Record<string, unknown>;
  if (details.schemaVersion !== 1 || !Array.isArray(details.reasons)) {
    return { schemaVersion: 1 as const, reasons: [] as Array<{ code: string; pageNumbers: number[] }> };
  }
  const pagesByCode = new Map<string, number[]>();
  for (const rawReason of details.reasons.slice(0, 20)) {
    if (!rawReason || typeof rawReason !== "object" || Array.isArray(rawReason)) continue;
    const reason = rawReason as Record<string, unknown>;
    const code = sanitizeContractDocumentReviewErrorCode(reason.code);
    if (!code) continue;
    const pages = sanitizeAffectedPageNumbers(reason.pageNumbers, pageCount);
    pagesByCode.set(code, sanitizeAffectedPageNumbers([
      ...(pagesByCode.get(code) ?? []),
      ...pages,
    ], pageCount));
  }
  return {
    schemaVersion: 1 as const,
    reasons: [...pagesByCode].map(([code, pageNumbers]) => ({ code, pageNumbers })),
  };
}

export function affectedPagesText(pages: readonly number[]): string {
  const safePages = sanitizeAffectedPageNumbers([...pages]);
  if (safePages.length === 0) return "Kontrollen gælder hele dokumentet.";
  if (safePages.length === 1) return `Side ${safePages[0]}`;
  if (safePages.length === 2) return `Side ${safePages[0]} og ${safePages[1]}`;
  return `Sider ${safePages.slice(0, -1).join(", ")} og ${safePages.at(-1)}`;
}

export function contractDocumentReviewActions(context: ReviewContext) {
  const descriptor = contractDocumentReviewDescriptor(context.errorCode);
  const terminalReview = context.status === "needs_review" && context.hasJob !== false;
  const retryAlreadyHandled = Boolean(context.reviewDisposition);
  const rescanAlreadyRequested = context.reviewDisposition === "rescan_requested"
    || context.errorCode === "ocr_rescan_required";
  return {
    recommendedAction: descriptor.recommendedAction,
    canRetry: terminalReview
      && !retryAlreadyHandled
      && Boolean(context.errorCode && ADMIN_RETRYABLE_ERROR_CODES.has(context.errorCode)),
    canRequestRescan: terminalReview
      && !rescanAlreadyRequested
      && context.reviewDisposition !== "manual_overlay"
      && descriptor.recommendedAction === RESCAN
      && context.contractStatus === "kladde"
      && context.hasRightsHolder === true,
  };
}
