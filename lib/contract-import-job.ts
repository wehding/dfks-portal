export const CONTRACT_IMPORT_PROMPT_VERSION = "2026-08-robust-v1";
export const CONTRACT_IMPORT_SCHEMA_VERSION = "2026-08-v1";
export const CONTRACT_IMPORT_MAX_ATTEMPTS = 5;
export const CONTRACT_IMPORT_LEASE_MINUTES = 15;
export const CONTRACT_IMPORT_MAX_CONCURRENCY = 2;

export type ContractImportJobStage = "extraction" | "matching" | "finalizing" | "complete";
export type ContractImportJobStatus = "queued" | "processing" | "retry_wait" | "blocked" | "done" | "dead" | "error";
export type ContractImportFailureClass =
  | "configuration"
  | "billing"
  | "rate_limit"
  | "transient"
  | "input"
  | "invalid_output"
  | "internal";

export class ContractImportPipelineError extends Error {
  readonly code: string;
  readonly failureClass: ContractImportFailureClass;
  readonly httpStatus: number | null;
  readonly retryAfterMs: number | null;

  constructor(input: {
    message: string;
    code: string;
    failureClass: ContractImportFailureClass;
    httpStatus?: number | null;
    retryAfterMs?: number | null;
  }) {
    super(input.message);
    this.name = "ContractImportPipelineError";
    this.code = input.code;
    this.failureClass = input.failureClass;
    this.httpStatus = input.httpStatus ?? null;
    this.retryAfterMs = input.retryAfterMs ?? null;
  }
}

const RETRY_MINUTES = [1, 5, 15, 60, 360] as const;

export function contractImportRetryDelayMs(attempt: number, random = Math.random) {
  const baseMinutes = RETRY_MINUTES[Math.min(RETRY_MINUTES.length - 1, Math.max(0, attempt - 1))];
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;
  return Math.round(baseMinutes * 60_000 * jitter);
}

type ErrorLike = Error & {
  code?: string;
  status?: number;
  httpStatus?: number;
  retryAfterMs?: number | null;
  failureClass?: ContractImportFailureClass;
};

export type ContractImportFailureDecision = {
  status: "retry_wait" | "blocked" | "dead";
  itemStatus: "retryable_error" | "blocked" | "needs_ocr" | "dead";
  failureClass: ContractImportFailureClass;
  errorCode: string;
  safeMessage: string;
  nextAttemptAt: string | null;
  refundAttempt: boolean;
};

function errorDetails(error: unknown) {
  const value = error instanceof Error ? error as ErrorLike : new Error("Ukendt fejl") as ErrorLike;
  const message = value.message || "Ukendt fejl";
  const lower = message.toLocaleLowerCase("da-DK");
  return {
    value,
    message,
    lower,
    code: value.code ?? (error instanceof ContractImportPipelineError ? error.code : "pipeline_error"),
    status: value.httpStatus ?? value.status ?? null,
    retryAfterMs: value.retryAfterMs ?? null,
    failureClass: value.failureClass ?? (error instanceof ContractImportPipelineError ? error.failureClass : null),
  };
}

export function classifyContractImportFailure(
  error: unknown,
  attempt: number,
  now = new Date(),
  random = Math.random,
): ContractImportFailureDecision {
  const details = errorDetails(error);
  const atMaxAttempts = attempt >= CONTRACT_IMPORT_MAX_ATTEMPTS;
  const retryAt = (delay?: number | null) => new Date(now.getTime() + Math.max(delay ?? contractImportRetryDelayMs(attempt, random), 1_000)).toISOString();

  if (
    details.failureClass === "configuration"
    || details.status === 401
    || details.status === 403
    || /api[- ]?nøgle mangler|api key.*missing|ikke konfigureret|invalid.*key|unauthori[sz]ed/.test(details.lower)
  ) {
    return {
      status: "blocked", itemStatus: "blocked", failureClass: "configuration",
      errorCode: details.code === "pipeline_error" ? "provider_configuration" : details.code,
      safeMessage: "AI-udbyderen er ikke konfigureret korrekt. Kontrollér nøgle, modeladgang og projektindstillinger.",
      nextAttemptAt: null, refundAttempt: true,
    };
  }

  if (
    details.failureClass === "billing"
    || details.status === 402
    || /credit balance|billing|quota.*payment|betaling|kredit/.test(details.lower)
  ) {
    return {
      status: "blocked", itemStatus: "blocked", failureClass: "billing",
      errorCode: details.code === "pipeline_error" ? "provider_billing" : details.code,
      safeMessage: "AI-behandlingen er sat på pause, fordi udbyderens betaling eller kredit skal kontrolleres.",
      nextAttemptAt: null, refundAttempt: true,
    };
  }

  if (details.code === "insufficient_text" || details.code === "ocr_required") {
    return {
      status: "dead", itemStatus: "needs_ocr", failureClass: "input", errorCode: "ocr_required",
      safeMessage: "Scannet PDF uden tilstrækkeligt tekstlag. Dokumentet skal OCR-behandles, før AI kan aflæse det.",
      nextAttemptAt: null, refundAttempt: false,
    };
  }

  if (details.failureClass === "invalid_output" || details.code === "invalid_json") {
    if (attempt < 2) {
      return {
        status: "retry_wait", itemStatus: "retryable_error", failureClass: "invalid_output", errorCode: "invalid_json",
        safeMessage: "AI-svaret havde et ugyldigt format og prøves én gang til.",
        nextAttemptAt: retryAt(), refundAttempt: false,
      };
    }
    return {
      status: "dead", itemStatus: "dead", failureClass: "invalid_output", errorCode: "invalid_json",
      safeMessage: "AI-svaret kunne ikke læses efter et nyt forsøg.", nextAttemptAt: null, refundAttempt: false,
    };
  }

  if (details.status === 400 || details.status === 413 || details.status === 422 || details.failureClass === "input") {
    return {
      status: "dead", itemStatus: "dead", failureClass: "input",
      errorCode: details.code === "pipeline_error" ? `provider_${details.status ?? "input"}` : details.code,
      safeMessage: "Filen kunne ikke behandles af AI-udbyderen og kræver manuel kontrol.",
      nextAttemptAt: null, refundAttempt: false,
    };
  }

  const isRateLimit = details.status === 429 || details.failureClass === "rate_limit";
  const isTransient = isRateLimit
    || details.failureClass === "transient"
    || (details.status != null && details.status >= 500)
    || /failed to fetch|fetch failed|timeout|timed out|econnreset|network|socket/.test(details.lower);

  if (isTransient && !atMaxAttempts) {
    return {
      status: "retry_wait", itemStatus: "retryable_error",
      failureClass: isRateLimit ? "rate_limit" : "transient",
      errorCode: details.code === "pipeline_error" ? (isRateLimit ? "provider_rate_limit" : "provider_transient") : details.code,
      safeMessage: isRateLimit
        ? "AI-udbyderen har midlertidigt begrænset antallet af kald. Jobbet prøves automatisk igen."
        : "En midlertidig fejl afbrød behandlingen. Jobbet prøves automatisk igen.",
      nextAttemptAt: retryAt(details.retryAfterMs), refundAttempt: false,
    };
  }

  if (!atMaxAttempts && details.failureClass !== "internal") {
    return {
      status: "retry_wait", itemStatus: "retryable_error", failureClass: "internal",
      errorCode: details.code,
      safeMessage: "Behandlingen blev afbrudt og prøves automatisk igen.",
      nextAttemptAt: retryAt(), refundAttempt: false,
    };
  }

  return {
    status: "dead", itemStatus: "dead", failureClass: details.failureClass ?? "internal",
    errorCode: details.code,
    safeMessage: "Kontrakten kunne ikke færdigbehandles efter flere forsøg og kræver manuel kontrol.",
    nextAttemptAt: null, refundAttempt: false,
  };
}
