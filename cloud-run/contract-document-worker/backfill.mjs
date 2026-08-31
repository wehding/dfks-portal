import { pathToFileURL } from "node:url";

import {
  FatalProcessingError,
  OCR_QUALITY_DIAGNOSTIC_CODES,
  processOne,
} from "./processor.mjs";

const MAX_REASONABLE_DOCUMENTS = 100_000;
const MAX_REASONABLE_FAILURE_THRESHOLD = 100;
const MAX_QUALITY_CONSECUTIVE_THRESHOLD = 5;
const MIN_QUALITY_RATE_WINDOW = 10;
const MAX_QUALITY_RATE_WINDOW = 100;
const MAX_QUALITY_FAILURE_RATE_PERCENT = 50;
const OCR_QUALITY_DIAGNOSTIC_CODE_SET = new Set(Object.values(OCR_QUALITY_DIAGNOSTIC_CODES));

export function parseDocumentLimit(value) {
  if (value == null || value === "" || value === "0") return 0;
  if (!/^\d+$/.test(value)) throw new FatalProcessingError("invalid_document_limit");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_REASONABLE_DOCUMENTS) {
    throw new FatalProcessingError("invalid_document_limit");
  }
  return parsed;
}

export function parseFailureThreshold(value) {
  if (value == null || value === "") return 5;
  if (!/^\d+$/.test(value)) throw new FatalProcessingError("invalid_failure_threshold");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_REASONABLE_FAILURE_THRESHOLD) {
    throw new FatalProcessingError("invalid_failure_threshold");
  }
  return parsed;
}

export function parseQualityConsecutiveThreshold(value) {
  if (value == null || value === "") return MAX_QUALITY_CONSECUTIVE_THRESHOLD;
  if (!/^\d+$/.test(value)) throw new FatalProcessingError("invalid_quality_consecutive_threshold");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_QUALITY_CONSECUTIVE_THRESHOLD) {
    throw new FatalProcessingError("invalid_quality_consecutive_threshold");
  }
  return parsed;
}

export function parseQualityRateWindow(value) {
  if (value == null || value === "") return MIN_QUALITY_RATE_WINDOW;
  if (!/^\d+$/.test(value)) throw new FatalProcessingError("invalid_quality_rate_window");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)
    || parsed < MIN_QUALITY_RATE_WINDOW || parsed > MAX_QUALITY_RATE_WINDOW) {
    throw new FatalProcessingError("invalid_quality_rate_window");
  }
  return parsed;
}

export function parseQualityFailureRatePercent(value) {
  if (value == null || value === "") return MAX_QUALITY_FAILURE_RATE_PERCENT;
  if (!/^\d+$/.test(value)) throw new FatalProcessingError("invalid_quality_failure_rate");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_QUALITY_FAILURE_RATE_PERCENT) {
    throw new FatalProcessingError("invalid_quality_failure_rate");
  }
  return parsed;
}

function isOcrQualityFailure(result) {
  return result.outcome === "needs_review"
    && typeof result.diagnosticCode === "string"
    && OCR_QUALITY_DIAGNOSTIC_CODE_SET.has(result.diagnosticCode);
}

export async function runBackfill(options = {}) {
  const processOneFn = options.processOneFn ?? processOne;
  const maxDocuments = options.maxDocuments
    ?? parseDocumentLimit(process.env.OCR_MAX_DOCUMENTS_PER_TASK);
  const failureThreshold = options.failureThreshold
    ?? parseFailureThreshold(process.env.OCR_MAX_CONSECUTIVE_FAILURES);
  const configuredQualityConsecutiveThreshold = options.qualityConsecutiveThreshold
    ?? parseQualityConsecutiveThreshold(process.env.OCR_MAX_CONSECUTIVE_QUALITY_FAILURES);
  // A pilot task claims at most four documents and must fail closed on its
  // first OCR-quality regression, regardless of a weaker environment value.
  const qualityConsecutiveThreshold = maxDocuments > 0 && maxDocuments <= 4
    ? 1
    : configuredQualityConsecutiveThreshold;
  const qualityRateWindow = options.qualityRateWindow
    ?? parseQualityRateWindow(process.env.OCR_QUALITY_FAILURE_WINDOW);
  const qualityFailureRatePercent = options.qualityFailureRatePercent
    ?? parseQualityFailureRatePercent(process.env.OCR_MAX_QUALITY_FAILURE_RATE_PERCENT);
  const log = options.log ?? console.log;
  const totals = { processed: 0, completed: 0, needsReview: 0, failed: 0 };
  let consecutiveOperationalFailures = 0;
  let consecutiveQualityFailures = 0;
  const qualityWindow = [];
  while (maxDocuments === 0 || totals.processed < maxDocuments) {
    const result = await processOneFn();
    if (result.outcome === "empty") break;
    totals.processed += 1;
    const qualityFailure = isOcrQualityFailure(result);
    if (result.outcome === "completed") {
      totals.completed += 1;
      consecutiveOperationalFailures = 0;
    } else if (result.outcome === "needs_review") {
      totals.needsReview += 1;
      consecutiveOperationalFailures = 0;
    } else if (result.outcome === "handled_failure") {
      totals.failed += 1;
      consecutiveOperationalFailures += 1;
      if (consecutiveOperationalFailures >= failureThreshold) {
        throw new FatalProcessingError("backfill_failure_threshold");
      }
    }
    else throw new FatalProcessingError("invalid_processor_outcome");

    consecutiveQualityFailures = qualityFailure ? consecutiveQualityFailures + 1 : 0;
    qualityWindow.push(qualityFailure);
    if (qualityWindow.length > qualityRateWindow) qualityWindow.shift();
    if (consecutiveQualityFailures >= qualityConsecutiveThreshold) {
      throw new FatalProcessingError("backfill_quality_consecutive_threshold");
    }
    if (qualityWindow.length >= MIN_QUALITY_RATE_WINDOW) {
      const qualityFailures = qualityWindow.filter(Boolean).length;
      if ((qualityFailures * 100) > (qualityFailureRatePercent * qualityWindow.length)) {
        throw new FatalProcessingError("backfill_quality_rate_threshold");
      }
    }
  }
  log(JSON.stringify({ event: "backfill_finished", ...totals }));
  return totals;
}

export async function main(options = {}) {
  const errorLog = options.errorLog ?? console.error;
  try {
    await runBackfill(options);
    return 0;
  } catch (error) {
    errorLog(JSON.stringify({
      event: "backfill_fatal",
      code: error instanceof FatalProcessingError ? error.code : "unexpected_failure",
    }));
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
