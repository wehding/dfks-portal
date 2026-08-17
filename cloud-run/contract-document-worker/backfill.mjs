import { pathToFileURL } from "node:url";

import { FatalProcessingError, processOne } from "./processor.mjs";

const MAX_REASONABLE_DOCUMENTS = 100_000;

export function parseDocumentLimit(value) {
  if (value == null || value === "" || value === "0") return 0;
  if (!/^\d+$/.test(value)) throw new FatalProcessingError("invalid_document_limit");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_REASONABLE_DOCUMENTS) {
    throw new FatalProcessingError("invalid_document_limit");
  }
  return parsed;
}

export async function runBackfill({
  processOneFn = processOne,
  maxDocuments = parseDocumentLimit(process.env.OCR_MAX_DOCUMENTS_PER_TASK),
  log = console.log,
} = {}) {
  const totals = { processed: 0, completed: 0, needsReview: 0, failed: 0 };
  while (maxDocuments === 0 || totals.processed < maxDocuments) {
    const result = await processOneFn();
    if (result.outcome === "empty") break;
    totals.processed += 1;
    if (result.outcome === "completed") totals.completed += 1;
    else if (result.outcome === "needs_review") totals.needsReview += 1;
    else if (result.outcome === "handled_failure") totals.failed += 1;
    else throw new FatalProcessingError("invalid_processor_outcome");
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
