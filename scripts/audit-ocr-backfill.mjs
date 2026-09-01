#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { PDFDocument } from "pdf-lib";

import {
  computeSpatialAccuracy,
  parsePdftotextBbox,
} from "../cloud-run/contract-document-worker/spatial-ocr.mjs";

const CONTRACT_BUCKET = "kontrakter";
const PAGE_SIZE = 500;
const QUERY_CHUNK_SIZE = 100;
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 2;
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_SPATIAL_COMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_SPATIAL_JSON_BYTES = 32 * 1024 * 1024;
const MAX_BBOX_BYTES = 64 * 1024 * 1024;
const MAX_PAGE_COUNT_OUTPUT_BYTES = 64;
const DOWNLOAD_TIMEOUT_MS = 90_000;
const PDFTOTEXT_TIMEOUT_MS = 120_000;
const PDF_PAGE_COUNT_TIMEOUT_MS = 60_000;
const BASELINE_SCHEMA_VERSION = "dfks-ocr-backfill-baseline-v4";
const LEGACY_BASELINE_SCHEMA_VERSION = "dfks-ocr-backfill-baseline-v3";
const GEOMETRY_BACKFILL_QUALITY_SCHEMA_VERSION = "dfks-vision-v3-geometry-quality-v2";
const MAX_BASELINE_BYTES = 64 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GEOMETRY_BACKFILL_TERMINAL_STATUSES = Object.freeze([
  "not_required",
  "needs_review",
  "failed",
]);
const GEOMETRY_BACKFILL_BUSINESS_STATUSES = Object.freeze([
  "kladde",
  "afventer",
  "valideret",
]);
const DIRECT_VISION_OVERLAY_PROFILES = new Set([
  "primary-v1",
  "font-metrics-v1",
  "axis-aligned-font-metrics-v1",
]);

// The OCR callback atomically creates one replacement AI job. It may already
// be `done` by the time the audit runs, so both active states and `done` count
// when the row was created at or after the OCR completion transaction.
export const ACTIVE_AI_JOB_STATUSES = Object.freeze([
  "queued",
  "processing",
  "retry_wait",
  "blocked",
  "error",
  "done",
]);
const DOCUMENT_JOB_STATUSES = Object.freeze([
  "queued",
  "processing",
  "completed",
  "needs_review",
  "failed",
  "not_required",
]);
const AI_JOB_STATUSES = Object.freeze([
  "queued",
  "processing",
  "retry_wait",
  "blocked",
  "error",
  "done",
  "dead",
]);

export class AuditOperationalError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "AuditOperationalError";
    this.code = code;
  }
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

let pdfPageCountQueue = Promise.resolve();

export async function pdfPageCount(bytes) {
  const parse = async () => {
    const warn = console.warn;
    console.warn = (message, ...args) => {
      if (typeof message === "string"
        && message.startsWith("Parsed number that is too large for some PDF readers:")) return;
      warn(message, ...args);
    };
    try {
      const document = await PDFDocument.load(bytes, {
        capNumbers: true,
        ignoreEncryption: false,
        updateMetadata: false,
        throwOnInvalidObject: true,
      });
      return document.getPageCount();
    } catch (error) {
      throw new AuditOperationalError("invalid_pdf", { cause: error });
    } finally {
      console.warn = warn;
    }
  };
  const result = pdfPageCountQueue.then(parse, parse);
  pdfPageCountQueue = result.then(() => undefined, () => undefined);
  return result;
}

function emptyViolations() {
  return {
    missingJobMetadata: 0,
    duplicateCompletedContract: 0,
    contractRecordMissing: 0,
    contractPathMismatch: 0,
    originalReadFailure: 0,
    outputReadFailure: 0,
    spatialReadFailure: 0,
    originalHashMismatch: 0,
    processedHashMismatch: 0,
    spatialHashMismatch: 0,
    invalidOriginalPdf: 0,
    invalidOutputPdf: 0,
    invalidSpatialArtifact: 0,
    outputPageCountMismatch: 0,
    originalOutputPageCountMismatch: 0,
    spatialPageCountMismatch: 0,
    derivativePathInvalid: 0,
    spatialBboxReadFailure: 0,
    spatialIndependentVerificationFailure: 0,
    spatialMetricMismatch: 0,
    activeAiJobCountMismatch: 0,
    automaticallyValidatedContract: 0,
    baselineJobMissing: 0,
    baselineJobContractMismatch: 0,
    baselineContractMissing: 0,
    baselineOriginalReadFailure: 0,
    baselineOriginalHashMismatch: 0,
    baselineOriginalPathMismatch: 0,
    baselineOriginalPageCountMismatch: 0,
    baselineOriginalPdfReadabilityMismatch: 0,
    baselineContractStatusMismatch: 0,
    replacementLineageMismatch: 0,
    supersededArtifactDeletionMismatch: 0,
    originalDeletionCandidate: 0,
    geometryRunMetadataMismatch: 0,
    geometryTargetCountMismatch: 0,
    geometryTargetBaselineMismatch: 0,
    geometryJobMissingOrMismatch: 0,
    geometryOutcomeStatusMismatch: 0,
    geometryPriorStateMismatch: 0,
    geometrySourceLineageMismatch: 0,
    geometryUnexpectedArtifactDeletion: 0,
    geometryNonTerminalJob: 0,
    geometryUnresolvedOutcome: 0,
    geometryUnexpectedAiGeneration: 0,
    geometryRecoveryChainMismatch: 0,
    geometryRecoveryAuditMismatch: 0,
  };
}

export function createAuditSummary(jobCount) {
  return {
    completedJobsExamined: jobCount,
    documentsPassingAllChecks: 0,
    baselineJobsExamined: 0,
    baselineDocumentsPassingAllChecks: 0,
    baselineSourceState: {
      readablePdf: 0,
      unparseablePdf: 0,
    },
    operational: summarizeOperationalState({ documentJobs: [], aiJobs: [] }),
    violations: emptyViolations(),
  };
}

export function summaryHasViolations(summary) {
  return Object.values(summary.violations).some((count) => count > 0);
}

export function geometryBackfillSummaryReadyForApproval(summary) {
  const expected = Number(summary?.expectedDocuments);
  const outcomes = summary?.outcomes ?? {};
  return Number.isInteger(expected)
    && expected > 0
    && summary?.targetsExamined === expected
    && outcomes.completed === expected
    && outcomes.needs_review === 0
    && outcomes.failed === 0
    && outcomes.queued === 0
    && outcomes.processing === 0
    && outcomes.unknown === 0
    && summary?.completedDocumentsPassingAllChecks === expected
    && !summaryHasViolations(summary);
}

function normalizeContract(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function statusDistribution(statuses) {
  return Object.fromEntries([...statuses.map((status) => [status, 0]), ["unknown", 0]]);
}

function safeAttempts(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function summarizeOperationalState({ documentJobs, aiJobs }) {
  const documentJobsByStatus = statusDistribution(DOCUMENT_JOB_STATUSES);
  const aiJobsByStatus = statusDistribution(AI_JOB_STATUSES);
  let ocrApplied = 0;
  let nativeTextNotRequired = 0;
  let pageCountTotal = 0;
  let pageCountMaximum = null;
  let documentsWithPageCount = 0;
  let documentAttempts = 0;
  let documentRetries = 0;
  let aiAttempts = 0;
  let aiRetries = 0;

  for (const job of documentJobs) {
    const status = DOCUMENT_JOB_STATUSES.includes(job?.status) ? job.status : "unknown";
    documentJobsByStatus[status] += 1;
    if (job?.ocr_applied === true) ocrApplied += 1;
    if (job?.status === "not_required" && job?.ocr_applied !== true) {
      nativeTextNotRequired += 1;
    }
    if (Number.isInteger(job?.page_count) && job.page_count > 0 && job.page_count <= 10_000) {
      documentsWithPageCount += 1;
      pageCountTotal += job.page_count;
      pageCountMaximum = Math.max(pageCountMaximum ?? 0, job.page_count);
    }
    const attempts = safeAttempts(job?.attempts);
    documentAttempts += attempts;
    documentRetries += Math.max(0, attempts - 1);
  }

  for (const job of aiJobs) {
    const status = AI_JOB_STATUSES.includes(job?.status) ? job.status : "unknown";
    aiJobsByStatus[status] += 1;
    const attempts = safeAttempts(job?.attempts);
    aiAttempts += attempts;
    aiRetries += Math.max(0, attempts - 1);
  }

  return {
    documentJobsTotal: documentJobs.length,
    documentJobsByStatus,
    ocrApplied,
    nativeTextNotRequired,
    pageCounts: {
      documentsWithPageCount,
      average: documentsWithPageCount
        ? Math.round((pageCountTotal / documentsWithPageCount) * 100) / 100
        : null,
      maximum: pageCountMaximum,
    },
    attempts: {
      documentAttempts,
      documentRetries,
      aiAttempts,
      aiRetries,
      totalAttempts: documentAttempts + aiAttempts,
      totalRetries: documentRetries + aiRetries,
    },
    relevantAiJobsTotal: aiJobs.length,
    relevantAiJobsByStatus: aiJobsByStatus,
  };
}

async function readPdfFingerprint(readStorage, storagePath) {
  let bytes;
  try {
    bytes = await readStorage(storagePath);
  } catch {
    return { readFailed: true };
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_PDF_BYTES) {
    return { readFailed: true };
  }

  const digest = sha256(bytes);
  try {
    const pageCount = await pdfPageCount(bytes);
    return {
      readFailed: false,
      sha256: digest,
      pageCount,
      bytes,
    };
  } catch {
    return { readFailed: false, invalidPdf: true, sha256: digest, bytes };
  }
}

async function inspectPdf(readStorage, storagePath, expectedHash, expectedPageCount) {
  const fingerprint = await readPdfFingerprint(readStorage, storagePath);
  if (fingerprint.readFailed) return fingerprint;
  return {
    ...fingerprint,
    hashMatches: fingerprint.sha256 === expectedHash,
    pageCountMatches: !fingerprint.invalidPdf && fingerprint.pageCount === expectedPageCount,
  };
}

function hasExactKeys(value, allowed, required = allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key))
    && required.every((key) => Object.hasOwn(value, key));
}

function validSpatialPage(page, pageCount) {
  if (!hasExactKeys(page, [
    "pageNumber", "sourceImageWidth", "sourceImageHeight",
    "imageWidth", "imageHeight", "orientationCorrection", "words",
  ])
    || !Number.isInteger(page.pageNumber) || page.pageNumber < 1 || page.pageNumber > pageCount
    || !Number.isFinite(page.sourceImageWidth)
    || page.sourceImageWidth <= 0 || page.sourceImageWidth > 100_000
    || !Number.isFinite(page.sourceImageHeight)
    || page.sourceImageHeight <= 0 || page.sourceImageHeight > 100_000
    || !Number.isFinite(page.imageWidth) || page.imageWidth <= 0 || page.imageWidth > 100_000
    || !Number.isFinite(page.imageHeight) || page.imageHeight <= 0 || page.imageHeight > 100_000
    || ![0, 90, 180, 270].includes(page.orientationCorrection)
    || !Array.isArray(page.words) || page.words.length > 1_000_000) return false;
  const dimensionsMatch = page.orientationCorrection % 180 === 0
    ? page.imageWidth === page.sourceImageWidth && page.imageHeight === page.sourceImageHeight
    : page.imageWidth === page.sourceImageHeight && page.imageHeight === page.sourceImageWidth;
  if (!dimensionsMatch) return false;
  return page.words.every((word) => hasExactKeys(word, ["text", "confidence", "vertices"])
    && typeof word.text === "string" && word.text.length > 0 && word.text.length <= 10_000
    && Number.isFinite(word.confidence) && word.confidence >= 0 && word.confidence <= 1
    && Array.isArray(word.vertices) && word.vertices.length === 4
    && word.vertices.every((vertex) => hasExactKeys(vertex, ["x", "y"])
      && Number.isFinite(vertex.x) && Number.isFinite(vertex.y)
      && vertex.x >= 0 && vertex.y >= 0
      && vertex.x <= page.imageWidth && vertex.y <= page.imageHeight)
    && Math.min(...word.vertices.map((vertex) => vertex.x))
      < Math.max(...word.vertices.map((vertex) => vertex.x))
    && Math.min(...word.vertices.map((vertex) => vertex.y))
      < Math.max(...word.vertices.map((vertex) => vertex.y)));
}

function validRedaction(redaction, pageCount) {
  return hasExactKeys(redaction, ["pageNumber", "top", "left", "width", "height", "infoType"])
    && Number.isInteger(redaction.pageNumber) && redaction.pageNumber >= 1 && redaction.pageNumber <= pageCount
    && [redaction.top, redaction.left].every((value) => Number.isFinite(value) && value >= 0)
    && [redaction.width, redaction.height].every((value) => Number.isFinite(value) && value > 0)
    && typeof redaction.infoType === "string" && /^[A-Z][A-Z0-9_]{1,79}$/.test(redaction.infoType);
}

function validSpatialVerification(value) {
  if (!hasExactKeys(value, [
    "expectedWords", "matchedWords", "measurableWords", "matchCoverage",
    "score", "medianIou", "centerInsideRatio", "passed",
  ])) return false;
  const ratios = [value.matchCoverage, value.score, value.medianIou, value.centerInsideRatio];
  return Number.isInteger(value.expectedWords) && value.expectedWords > 0
    && Number.isInteger(value.matchedWords) && value.matchedWords >= 0
    && value.matchedWords <= value.expectedWords
    && value.measurableWords === value.matchedWords
    && ratios.every((ratio) => Number.isFinite(ratio) && ratio >= 0 && ratio <= 1)
    && typeof value.passed === "boolean";
}

function parseDerivativePath(storagePath, expectedFilename) {
  if (typeof storagePath !== "string" || storagePath.length > 500) return null;
  const parts = storagePath.split("/");
  if (parts.length !== 6
    || !UUID_PATTERN.test(parts[0] ?? "")
    || parts[1] !== "processed"
    || !UUID_PATTERN.test(parts[2] ?? "")
    || parts[3] !== "leases"
    || !UUID_PATTERN.test(parts[4] ?? "")
    || parts[5] !== expectedFilename) return null;
  return { orgId: parts[0], contractId: parts[2], leaseToken: parts[4] };
}

function hasExpectedDerivativePaths(job) {
  const output = parseDerivativePath(job.output_storage_path, "normalised.pdf");
  const spatial = parseDerivativePath(job.spatial_data_path, "vision-layout.json.gz");
  return output && spatial
    && UUID_PATTERN.test(job.org_id ?? "")
    && output.orgId === job.org_id
    && output.contractId === job.contract_id
    && spatial.orgId === output.orgId
    && spatial.contractId === output.contractId
    && spatial.leaseToken === output.leaseToken;
}

export async function extractPdfBboxPages(pdfBytes) {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0
    || pdfBytes.byteLength > MAX_PDF_BYTES) {
    throw new AuditOperationalError("spatial_bbox_failed");
  }
  const directory = await mkdtemp(join(tmpdir(), "dfks-ocr-audit-"));
  const pdfPath = join(directory, "processed.pdf");
  try {
    await writeFile(pdfPath, pdfBytes, { mode: 0o600 });
    const bbox = await new Promise((resolve, reject) => {
      const child = spawn("pdftotext", ["-cropbox", "-bbox-layout", pdfPath, "-"], {
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          LANG: "C",
          LC_ALL: "C",
        },
      });
      const chunks = [];
      let length = 0;
      let terminalError = null;
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      const failAfterTermination = () => {
        if (settled) return;
        terminalError ??= new AuditOperationalError("spatial_bbox_failed");
        if (child.pid == null) {
          finish(terminalError);
          return;
        }
        child.kill("SIGKILL");
      };
      const timer = setTimeout(failAfterTermination, PDFTOTEXT_TIMEOUT_MS);
      child.stdout.on("data", (chunk) => {
        length += chunk.length;
        if (length > MAX_BBOX_BYTES) {
          failAfterTermination();
          return;
        }
        chunks.push(chunk);
      });
      child.stdout.once("error", failAfterTermination);
      child.once("error", failAfterTermination);
      child.once("close", (code) => {
        if (terminalError || code !== 0) {
          finish(terminalError ?? new AuditOperationalError("spatial_bbox_failed"));
        }
        else finish(null, Buffer.concat(chunks).toString("utf8"));
      });
    });
    const pages = parsePdftotextBbox(bbox);
    if (!pages.length || pages.length > 10_000) {
      throw new AuditOperationalError("spatial_bbox_failed");
    }
    return pages;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function extractPdfPageCount(pdfBytes) {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0
    || pdfBytes.byteLength > MAX_PDF_BYTES) {
    throw new AuditOperationalError("pdf_page_count_failed");
  }
  const script = [
    "import io, sys",
    "import pikepdf",
    "payload = sys.stdin.buffer.read()",
    "with pikepdf.open(io.BytesIO(payload)) as document:",
    "    print(len(document.pages))",
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", script], {
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
        PYTHONDONTWRITEBYTECODE: "1",
      },
    });
    const chunks = [];
    let length = 0;
    let terminalError = null;
    let settled = false;
    const failAfterTermination = () => {
      if (settled) return;
      terminalError ??= new AuditOperationalError("pdf_page_count_failed");
      if (child.pid == null) {
        finish(terminalError);
        return;
      }
      child.kill("SIGKILL");
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(failAfterTermination, PDF_PAGE_COUNT_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      length += chunk.length;
      if (length > MAX_PAGE_COUNT_OUTPUT_BYTES) {
        failAfterTermination();
        return;
      }
      chunks.push(chunk);
    });
    child.stdout.once("error", failAfterTermination);
    child.stdin.once("error", failAfterTermination);
    child.once("error", failAfterTermination);
    child.once("close", (code) => {
      if (terminalError || code !== 0) {
        finish(terminalError ?? new AuditOperationalError("pdf_page_count_failed"));
        return;
      }
      const pageCount = Number(Buffer.concat(chunks).toString("ascii").trim());
      if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 10_000) {
        finish(new AuditOperationalError("pdf_page_count_failed"));
        return;
      }
      finish(null, pageCount);
    });
    child.stdin.end(pdfBytes);
  });
}

async function runPdfPageCountCommand(command, args, parseOutput) {
  const output = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
      },
    });
    const chunks = [];
    let length = 0;
    let terminalError = null;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const failAfterTermination = () => {
      if (settled) return;
      terminalError ??= new AuditOperationalError("pdf_page_count_failed");
      if (child.pid == null) {
        finish(terminalError);
        return;
      }
      child.kill("SIGKILL");
    };
    const timer = setTimeout(failAfterTermination, PDF_PAGE_COUNT_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      length += chunk.length;
      if (length > 64 * 1024) {
        failAfterTermination();
        return;
      }
      chunks.push(chunk);
    });
    child.stdout.once("error", failAfterTermination);
    child.once("error", failAfterTermination);
    child.once("close", (code) => {
      if (terminalError || code !== 0) {
        finish(terminalError ?? new AuditOperationalError("pdf_page_count_failed"));
        return;
      }
      try {
        const pageCount = parseOutput(Buffer.concat(chunks).toString("utf8"));
        if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 10_000) {
          throw new AuditOperationalError("pdf_page_count_failed");
        }
        finish(null, pageCount);
      } catch {
        finish(new AuditOperationalError("pdf_page_count_failed"));
      }
    });
  });
  return output;
}

async function runPdfStructureCheck(pdfPath) {
  await new Promise((resolve, reject) => {
    const child = spawn("qpdf", ["--warning-exit-0", "--check", pdfPath], {
      shell: false,
      stdio: ["ignore", "ignore", "ignore"],
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
      },
    });
    let settled = false;
    let terminalError = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const failAfterTermination = () => {
      if (settled) return;
      terminalError ??= new AuditOperationalError("pdf_page_count_failed");
      if (child.pid == null) {
        finish(terminalError);
        return;
      }
      child.kill("SIGKILL");
    };
    const timer = setTimeout(failAfterTermination, PDF_PAGE_COUNT_TIMEOUT_MS);
    child.once("error", failAfterTermination);
    child.once("close", (code) => {
      if (terminalError || code !== 0) {
        finish(terminalError ?? new AuditOperationalError("pdf_page_count_failed"));
      } else finish(null);
    });
  });
}

export function requireMatchingPdfPageCounts(qpdfPageCount, popplerPageCount) {
  if (!Number.isInteger(qpdfPageCount) || qpdfPageCount < 1 || qpdfPageCount > 10_000
    || !Number.isInteger(popplerPageCount) || popplerPageCount < 1
    || popplerPageCount > 10_000 || qpdfPageCount !== popplerPageCount) {
    throw new AuditOperationalError("pdf_page_count_failed");
  }
  return qpdfPageCount;
}

/**
 * Recovers a page count for strict-parser-incompatible legacy PDFs using two
 * independent parsers from the same runtime family as the Cloud Run worker.
 * No command output, path or document content is ever returned or logged.
 */
export async function extractLegacyPdfPageCount(pdfBytes) {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0
    || pdfBytes.byteLength > MAX_PDF_BYTES
    || pdfBytes.byteLength < 5
    || Buffer.from(pdfBytes.subarray(0, 5)).toString("ascii") !== "%PDF-") {
    throw new AuditOperationalError("pdf_page_count_failed");
  }
  const directory = await mkdtemp(join(tmpdir(), "dfks-ocr-page-count-"));
  const pdfPath = join(directory, "source.pdf");
  try {
    await writeFile(pdfPath, pdfBytes, { mode: 0o600 });
    await runPdfStructureCheck(pdfPath);
    const [qpdfPageCount, popplerPageCount] = await Promise.all([
      runPdfPageCountCommand(
        "qpdf",
        ["--warning-exit-0", "--show-npages", pdfPath],
        (output) => Number(output.trim()),
      ),
      runPdfPageCountCommand(
        "pdfinfo",
        [pdfPath],
        (output) => Number(output.match(/Pages:\s+(\d+)/i)?.[1] ?? 0),
      ),
    ]);
    return requireMatchingPdfPageCounts(qpdfPageCount, popplerPageCount);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function spatialMetricsEqual(stored, recomputed) {
  if (!stored || !recomputed) return false;
  if (stored.expectedWords !== recomputed.expectedWords
    || stored.matchedWords !== recomputed.matchedWords
    || stored.measurableWords !== recomputed.measurableWords
    || stored.passed !== recomputed.passed) return false;
  return ["matchCoverage", "score", "medianIou", "centerInsideRatio"]
    .every((key) => Math.abs(stored[key] - recomputed[key]) <= 1e-9);
}

async function inspectSpatialArtifact(readStorage, job) {
  let compressed;
  try {
    compressed = await readStorage(job.spatial_data_path);
  } catch {
    return { readFailed: true };
  }
  if (!(compressed instanceof Uint8Array) || compressed.byteLength === 0
    || compressed.byteLength > MAX_SPATIAL_COMPRESSED_BYTES) {
    return { readFailed: true };
  }
  const hashMatches = sha256(compressed) === job.spatial_sha256;
  try {
    const jsonBytes = gunzipSync(compressed, { maxOutputLength: MAX_SPATIAL_JSON_BYTES });
    if (jsonBytes.byteLength === 0 || jsonBytes.byteLength > MAX_SPATIAL_JSON_BYTES) {
      return { hashMatches, invalid: true };
    }
    const geometry = JSON.parse(jsonBytes.toString("utf8"));
    const pages = geometry?.pages;
    const uniquePages = new Set(Array.isArray(pages) ? pages.map((page) => page?.pageNumber) : []);
    const legacyRedacted = hasExactKeys(geometry, [
      "schemaVersion", "engine", "redactionEngine", "redactionProfile", "redactions", "pages",
      "spatialVerification",
    ])
      && geometry.schemaVersion === "google-vision-spatial-v2"
      && geometry.redactionEngine === "google-sensitive-data-protection-image-redact"
      && geometry.redactionProfile === "dfks-contract-redaction-v1"
      && Array.isArray(geometry.redactions) && geometry.redactions.length <= 200_000
      && geometry.redactions.every((redaction) => validRedaction(redaction, job.page_count));
    const directVision = hasExactKeys(geometry, [
      "schemaVersion", "engine", "processingProfile", "overlayProfile", "pages",
      "spatialVerification",
    ], [
      "schemaVersion", "engine", "processingProfile", "pages", "spatialVerification",
    ])
      && geometry.schemaVersion === "google-vision-spatial-v3"
      && geometry.processingProfile === "google-vision-direct-v1"
      && (!Object.hasOwn(geometry, "overlayProfile")
        || DIRECT_VISION_OVERLAY_PROFILES.has(geometry.overlayProfile));
    const valid = (legacyRedacted || directVision)
      && geometry.engine === "google-vision-document-text-detection"
      && job.spatial_schema_version === geometry.schemaVersion
      && Array.isArray(pages)
      && pages.length === job.page_count
      && uniquePages.size === pages.length
      && pages.every((page) => validSpatialPage(page, job.page_count))
      && validSpatialVerification(geometry.spatialVerification)
      && geometry.spatialVerification.passed === true
      && geometry.spatialVerification.matchCoverage >= 0.95;
    return {
      hashMatches,
      invalid: !valid,
      pageCountMatches: Array.isArray(pages) && pages.length === job.page_count,
      geometry: valid ? geometry : null,
    };
  } catch {
    return { hashMatches, invalid: true };
  }
}

/**
 * Read-only integrity audit for completed OCR jobs.
 *
 * SECURITY INVARIANT: no document bytes, paths, hashes, identifiers, signed
 * URLs or database errors are returned or logged. The caller supplies a
 * private-storage reader; each document is held in memory only for its check.
 */
async function inspectCompletedJob({
  job,
  contract,
  completedContractCount,
  activeAiCount,
  baselineContractStatus,
  baselineOriginal,
  readStorage,
  extractBboxPages,
  extractOriginalPageCount,
}) {
  const violations = emptyViolations();

  if (completedContractCount !== 1) {
    violations.duplicateCompletedContract += 1;
  }
  if (!contract) {
    violations.contractRecordMissing += 1;
  } else {
    if (contract.pdf_url !== job.original_storage_path
      || contract.processed_pdf_url !== job.output_storage_path
      || contract.document_spatial_data_path !== job.spatial_data_path
      || contract.document_processing_status !== "ready") {
      violations.contractPathMismatch += 1;
    }
    const statusUnchangedFromBaseline = typeof baselineContractStatus === "string"
      && contract.status === baselineContractStatus;
    if (!statusUnchangedFromBaseline
      && (contract.status === "valideret" || contract.status === "validated")) {
      violations.automaticallyValidatedContract += 1;
    }
  }

  const validProcessingProfile = (
    job.spatial_schema_version === "google-vision-spatial-v2"
      && job.redaction_profile === "dfks-contract-redaction-v1"
      && job.processing_profile == null
  ) || (
    job.spatial_schema_version === "google-vision-spatial-v3"
      && job.redaction_profile == null
      && job.processing_profile === "google-vision-direct-v1"
  );
  const hasMetadata = job.ocr_applied === true
    && Number.isInteger(job.page_count) && job.page_count > 0
    && typeof job.original_sha256 === "string" && /^[0-9a-f]{64}$/.test(job.original_sha256)
    && typeof job.processed_sha256 === "string" && /^[0-9a-f]{64}$/.test(job.processed_sha256)
    && typeof job.spatial_sha256 === "string" && /^[0-9a-f]{64}$/.test(job.spatial_sha256)
    && validProcessingProfile
    && UUID_PATTERN.test(job.org_id ?? "")
    && typeof job.original_storage_path === "string" && job.original_storage_path.length > 0
    && typeof job.output_storage_path === "string" && job.output_storage_path.length > 0
    && typeof job.spatial_data_path === "string" && job.spatial_data_path.length > 0;

  if (!hasMetadata) {
    violations.missingJobMetadata += 1;
  } else {
    const derivativePathsValid = hasExpectedDerivativePaths(job);
    if (!derivativePathsValid) violations.derivativePathInvalid += 1;
    const original = await inspectPdf(
      readStorage,
      job.original_storage_path,
      job.original_sha256,
      job.page_count,
    );
    if (original.readFailed) violations.originalReadFailure += 1;
    else {
      if (!original.hashMatches) violations.originalHashMismatch += 1;
      if (original.invalidPdf) {
        let independentlyVerifiedPageCount = null;
        const originalStoragePathDigest = sha256(Buffer.from(job.original_storage_path, "utf8"));
        const matchesKnownUnparseableBaseline = original.hashMatches
          && baselineOriginal?.contractId === job.contract_id
          && (baselineOriginal.jobId === job.id
            || baselineOriginal.jobId === job.replacement_of_job_id
            || baselineOriginal.jobId === job.backfill_source_job_id)
          && baselineOriginal?.originalSha256 === original.sha256
          && baselineOriginal.originalSha256 === job.original_sha256
          && baselineOriginal?.originalStoragePathDigest === originalStoragePathDigest
          && baselineOriginal?.originalPdfReadable === false
          && (baselineOriginal?.originalPageCount === null
            || (baselineOriginal?.originalPageCountSource === "qpdf-poppler"
              && Number.isInteger(baselineOriginal.originalPageCount)));
        if (matchesKnownUnparseableBaseline) {
          try {
            independentlyVerifiedPageCount = await extractOriginalPageCount(original.bytes);
          } catch {
            // Known source parser failures still fail closed unless a second,
            // independent PDF tool verifies the exact expected page count.
          }
        }
        const baselinePageCountMatches = baselineOriginal?.originalPageCount == null
          || independentlyVerifiedPageCount === baselineOriginal.originalPageCount;
        if (!baselinePageCountMatches || independentlyVerifiedPageCount !== job.page_count) {
          violations.invalidOriginalPdf += 1;
        } else {
          original.pageCount = independentlyVerifiedPageCount;
          original.invalidPdf = false;
        }
      }
    }

    if (derivativePathsValid) {
      const output = await inspectPdf(
        readStorage,
        job.output_storage_path,
        job.processed_sha256,
        job.page_count,
      );
      if (output.readFailed) violations.outputReadFailure += 1;
      else {
        if (!output.hashMatches) violations.processedHashMismatch += 1;
        if (output.invalidPdf) violations.invalidOutputPdf += 1;
        else if (!output.pageCountMatches) violations.outputPageCountMismatch += 1;
      }

      if (!original.readFailed && !original.invalidPdf
        && !output.readFailed && !output.invalidPdf
        && original.pageCount !== output.pageCount) {
        violations.originalOutputPageCountMismatch += 1;
      }

      const spatial = await inspectSpatialArtifact(readStorage, job);
      if (spatial.readFailed) violations.spatialReadFailure += 1;
      else {
        if (!spatial.hashMatches) violations.spatialHashMismatch += 1;
        if (spatial.invalid) violations.invalidSpatialArtifact += 1;
        if (spatial.pageCountMatches === false) violations.spatialPageCountMismatch += 1;
      }

      if (!output.readFailed && !output.invalidPdf && spatial.geometry) {
        try {
          const extractedPages = await extractBboxPages(output.bytes);
          const recomputed = computeSpatialAccuracy(spatial.geometry.pages, extractedPages);
          if (!recomputed.passed || recomputed.matchCoverage < 0.95
            || recomputed.score < 0.95) {
            violations.spatialIndependentVerificationFailure += 1;
          }
          if (!spatialMetricsEqual(spatial.geometry.spatialVerification, recomputed)) {
            violations.spatialMetricMismatch += 1;
          }
        } catch {
          violations.spatialBboxReadFailure += 1;
        }
      }
    }
  }

  const expectedActiveAiCount = job.downstream_ai_policy === "preserve" ? 0 : 1;
  if (activeAiCount !== expectedActiveAiCount) {
    violations.activeAiJobCountMismatch += 1;
  }

  return violations;
}

export async function auditCompletedJobs({
  jobs,
  contractsById,
  activeAiCounts,
  baselineStatusByContract = new Map(),
  baselineOriginalByJob = new Map(),
  readStorage,
  concurrency = 1,
  extractBboxPages = extractPdfBboxPages,
  extractOriginalPageCount = extractLegacyPdfPageCount,
}) {
  const summary = createAuditSummary(jobs.length);
  const completedByContract = new Map();

  for (const job of jobs) {
    completedByContract.set(job.contract_id, (completedByContract.get(job.contract_id) ?? 0) + 1);
  }

  const results = await mapLimit(jobs, concurrency, async (job) => inspectCompletedJob({
    job,
    contract: normalizeContract(contractsById.get(job.contract_id)),
    completedContractCount: completedByContract.get(job.contract_id) ?? 0,
    activeAiCount: activeAiCounts.get(job.contract_id) ?? 0,
    baselineContractStatus: baselineStatusByContract.get(job.contract_id),
    baselineOriginal: baselineOriginalByJob.get(job.id)
      ?? baselineOriginalByJob.get(job.contract_id),
    readStorage,
    extractBboxPages,
    extractOriginalPageCount,
  }));

  for (const violations of results) {
    const count = Object.values(violations).reduce((total, value) => total + value, 0);
    if (count === 0) summary.documentsPassingAllChecks += 1;
    for (const [key, value] of Object.entries(violations)) {
      summary.violations[key] += value;
    }
  }

  return summary;
}

export function auditReplacementDeletionLifecycle({
  replacementJobs,
  sourceJobsById,
  deletionRows,
}) {
  const violations = emptyViolations();
  const deletionsByReplacement = new Map();
  for (const deletion of deletionRows) {
    const rows = deletionsByReplacement.get(deletion.replacement_job_id) ?? [];
    rows.push(deletion);
    deletionsByReplacement.set(deletion.replacement_job_id, rows);
  }
  for (const replacement of replacementJobs.filter((job) => job.status === "completed")) {
    const source = sourceJobsById.get(replacement.replacement_of_job_id);
    if (!source || source.superseded_by_job_id !== replacement.id) {
      violations.replacementLineageMismatch += 1;
      continue;
    }
    const deletions = deletionsByReplacement.get(replacement.id) ?? [];
    const expected = new Map([
      ["masked_pdf", source.output_storage_path],
      ["masked_spatial", source.spatial_data_path],
    ]);
    if (deletions.some((row) => row.storage_path === source.original_storage_path)) {
      violations.originalDeletionCandidate += 1;
    }
    const valid = deletions.length === 2
      && new Set(deletions.map((row) => row.artifact_kind)).size === 2
      && deletions.every((row) => row.source_job_id === source.id
        && row.status === "deleted"
        && expected.get(row.artifact_kind) === row.storage_path
        && row.storage_path !== source.original_storage_path);
    if (!valid) violations.supersededArtifactDeletionMismatch += 1;
  }
  return violations;
}

function baselineDigest({ schemaVersion, capturedAt, records }) {
  return sha256(Buffer.from(JSON.stringify({ schemaVersion, capturedAt, records }), "utf8"));
}

function assertValidBaseline(baseline) {
  if (!baseline || typeof baseline !== "object"
    || ![BASELINE_SCHEMA_VERSION, LEGACY_BASELINE_SCHEMA_VERSION]
      .includes(baseline.schemaVersion)
    || typeof baseline.capturedAt !== "string"
    || !Number.isFinite(Date.parse(baseline.capturedAt))
    || !Array.isArray(baseline.records)
    || baseline.records.length === 0
    || baseline.records.length > 100_000
    || typeof baseline.integritySha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(baseline.integritySha256)) {
    throw new AuditOperationalError("baseline_invalid");
  }

  const jobIds = new Set();
  for (const record of baseline.records) {
    const validLegacyPdfState = baseline.schemaVersion === LEGACY_BASELINE_SCHEMA_VERSION
      && ((record?.originalPdfReadable === true
        && Number.isInteger(record?.originalPageCount)
        && record.originalPageCount >= 1
        && record.originalPageCount <= 10_000)
        || (record?.originalPdfReadable === false && record.originalPageCount === null));
    const validCurrentPdfState = baseline.schemaVersion === BASELINE_SCHEMA_VERSION
      && ((record?.originalPdfReadable === true
        && record?.originalPageCountSource === "pdf-lib"
        && Number.isInteger(record?.originalPageCount)
        && record.originalPageCount >= 1
        && record.originalPageCount <= 10_000)
        || (record?.originalPdfReadable === false
          && record?.originalPageCountSource === "qpdf-poppler"
          && Number.isInteger(record?.originalPageCount)
          && record.originalPageCount >= 1
          && record.originalPageCount <= 10_000)
        || (record?.originalPdfReadable === false
          && record?.originalPageCountSource === "unavailable"
          && record.originalPageCount === null));
    if (!record || typeof record !== "object"
      || !UUID_PATTERN.test(record.jobId ?? "")
      || !UUID_PATTERN.test(record.contractId ?? "")
      || typeof record.originalSha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(record.originalSha256)
      || typeof record.originalStoragePathSha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(record.originalStoragePathSha256)
      || typeof record.originalPdfReadable !== "boolean"
      || (!validLegacyPdfState && !validCurrentPdfState)
      || typeof record.contractStatus !== "string"
      || record.contractStatus.length < 1
      || record.contractStatus.length > 80
      || (record.priorProcessingStatus !== undefined && (
        typeof record.priorProcessingStatus !== "string"
        || record.priorProcessingStatus.length < 1
        || record.priorProcessingStatus.length > 80
      ))
      || jobIds.has(record.jobId)) {
      throw new AuditOperationalError("baseline_invalid");
    }
    jobIds.add(record.jobId);
  }

  if (baselineDigest(baseline) !== baseline.integritySha256) {
    throw new AuditOperationalError("baseline_integrity_failed");
  }
  return baseline;
}

function createBaselineSummary(jobCount) {
  const summary = createAuditSummary(0);
  summary.baselineJobsExamined = jobCount;
  return summary;
}

/**
 * Captures immutable source facts before the pilot/backfill. No storage path,
 * document text or filename is persisted in the baseline. The returned object
 * must be written with writeBaselineFile(), which creates an owner-only file.
 */
export async function captureBaseline({
  jobs,
  contractsById,
  readStorage,
  concurrency = 1,
  capturedAt = new Date().toISOString(),
  extractLegacyPageCount = extractLegacyPdfPageCount,
}) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new AuditOperationalError("baseline_empty");
  }
  const summary = createBaselineSummary(jobs.length);
  const seenJobIds = new Set();
  const results = await mapLimit(jobs, concurrency, async (job) => {
    const violations = emptyViolations();
    const contract = normalizeContract(contractsById.get(job?.contract_id));
    if (!job || !UUID_PATTERN.test(job.id ?? "")
      || !UUID_PATTERN.test(job.contract_id ?? "")
      || typeof job.original_storage_path !== "string"
      || !job.original_storage_path
      || seenJobIds.has(job.id)) {
      violations.baselineJobContractMismatch += 1;
      return { violations, record: null };
    }
    seenJobIds.add(job.id);
    if (!contract || typeof contract.status !== "string" || !contract.status) {
      violations.baselineContractMissing += 1;
      return { violations, record: null };
    }

    const fingerprint = await readPdfFingerprint(readStorage, job.original_storage_path);
    if (fingerprint.readFailed) violations.baselineOriginalReadFailure += 1;
    if (Object.values(violations).some((count) => count > 0)) {
      return { violations, record: null };
    }
    const originalPdfReadable = !fingerprint.invalidPdf;
    let originalPageCount = originalPdfReadable ? fingerprint.pageCount : null;
    let originalPageCountSource = originalPdfReadable ? "pdf-lib" : "unavailable";
    if (!originalPdfReadable) {
      try {
        originalPageCount = await extractLegacyPageCount(fingerprint.bytes);
        originalPageCountSource = "qpdf-poppler";
      } catch {
        // A legacy parser failure is recorded explicitly. Geometry backfills
        // reject it, while general audits can still bind the exact source hash.
      }
    }
    return {
      violations,
      record: {
        jobId: job.id,
        contractId: job.contract_id,
        originalSha256: fingerprint.sha256,
        originalStoragePathSha256: sha256(Buffer.from(job.original_storage_path, "utf8")),
        originalPdfReadable,
        originalPageCount,
        originalPageCountSource,
        contractStatus: contract.status,
        priorProcessingStatus: typeof job.status === "string" ? job.status : "unknown",
      },
    };
  });

  const records = [];
  for (const result of results) {
    const count = Object.values(result.violations).reduce((total, value) => total + value, 0);
    if (count === 0 && result.record) {
      summary.baselineDocumentsPassingAllChecks += 1;
      if (result.record.originalPdfReadable) summary.baselineSourceState.readablePdf += 1;
      else summary.baselineSourceState.unparseablePdf += 1;
      records.push(result.record);
    }
    for (const [key, value] of Object.entries(result.violations)) {
      summary.violations[key] += value;
    }
  }
  if (summaryHasViolations(summary) || records.length !== jobs.length) {
    return { baseline: null, summary };
  }

  records.sort((left, right) => left.jobId.localeCompare(right.jobId));
  const payload = { schemaVersion: BASELINE_SCHEMA_VERSION, capturedAt, records };
  const baseline = { ...payload, integritySha256: baselineDigest(payload) };
  assertValidBaseline(baseline);
  return { baseline, summary };
}

export async function verifyBaseline({
  baseline,
  jobsById,
  contractsById,
  readStorage,
  concurrency = 1,
  extractLegacyPageCount = extractLegacyPdfPageCount,
}) {
  assertValidBaseline(baseline);
  const summary = createBaselineSummary(baseline.records.length);
  for (const record of baseline.records) {
    if (record.originalPdfReadable) summary.baselineSourceState.readablePdf += 1;
    else summary.baselineSourceState.unparseablePdf += 1;
  }
  const results = await mapLimit(baseline.records, concurrency, async (record) => {
    const violations = emptyViolations();
    const job = jobsById.get(record.jobId);
    if (!job) {
      violations.baselineJobMissing += 1;
      return violations;
    }
    if (job.contract_id !== record.contractId) {
      violations.baselineJobContractMismatch += 1;
      return violations;
    }
    if (typeof job.original_storage_path !== "string"
      || sha256(Buffer.from(job.original_storage_path, "utf8")) !== record.originalStoragePathSha256) {
      violations.baselineOriginalPathMismatch += 1;
    }
    const contract = normalizeContract(contractsById.get(record.contractId));
    if (!contract) violations.baselineContractMissing += 1;
    else if (contract.status !== record.contractStatus) {
      violations.baselineContractStatusMismatch += 1;
    }

    const fingerprint = await readPdfFingerprint(readStorage, job.original_storage_path);
    if (fingerprint.readFailed) violations.baselineOriginalReadFailure += 1;
    else {
      if (fingerprint.sha256 !== record.originalSha256) {
        violations.baselineOriginalHashMismatch += 1;
      }
      const originalPdfReadable = !fingerprint.invalidPdf;
      if (originalPdfReadable !== record.originalPdfReadable) {
        violations.baselineOriginalPdfReadabilityMismatch += 1;
      }
      if (originalPdfReadable && record.originalPdfReadable
        && fingerprint.pageCount !== record.originalPageCount) {
        violations.baselineOriginalPageCountMismatch += 1;
      }
      if (!originalPdfReadable && !record.originalPdfReadable
        && record.originalPageCountSource === "qpdf-poppler") {
        try {
          const recoveredPageCount = await extractLegacyPageCount(fingerprint.bytes);
          if (recoveredPageCount !== record.originalPageCount) {
            violations.baselineOriginalPageCountMismatch += 1;
          }
        } catch {
          violations.baselineOriginalPageCountMismatch += 1;
        }
      }
    }
    return violations;
  });

  for (const violations of results) {
    const count = Object.values(violations).reduce((total, value) => total + value, 0);
    if (count === 0) summary.baselineDocumentsPassingAllChecks += 1;
    for (const [key, value] of Object.entries(violations)) {
      summary.violations[key] += value;
    }
  }
  return summary;
}

/**
 * Turns one secure baseline file into the exact immutable target payload used
 * by the preparation RPC. The digest intentionally binds source generation,
 * bytes, path and both business/document state.
 *
 * @param {unknown} baseline
 * @param {{ expectedCount?: number | null }} options
 */
export function geometryBackfillBaselineCohort(baseline, { expectedCount = null } = {}) {
  assertValidBaseline(baseline);
  if (expectedCount !== null && (
    !Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 1000
  )) {
    throw new AuditOperationalError("geometry_backfill_expected_count_invalid");
  }
  const targets = baseline.records.map((record) => {
    const pageCountWasVerified = (
      record.originalPdfReadable === true
      && (baseline.schemaVersion === LEGACY_BASELINE_SCHEMA_VERSION
        || record.originalPageCountSource === "pdf-lib")
    ) || (
      baseline.schemaVersion === BASELINE_SCHEMA_VERSION
      && record.originalPdfReadable === false
      && record.originalPageCountSource === "qpdf-poppler"
    );
    if (!pageCountWasVerified
      || !Number.isInteger(record.originalPageCount)
      || record.originalPageCount < 1
      || record.originalPageCount > 200
      || !GEOMETRY_BACKFILL_BUSINESS_STATUSES.includes(record.contractStatus)
      || !GEOMETRY_BACKFILL_TERMINAL_STATUSES.includes(record.priorProcessingStatus)) {
      throw new AuditOperationalError("geometry_backfill_baseline_ineligible");
    }
    return {
      contractId: record.contractId.toLowerCase(),
      sourceJobId: record.jobId.toLowerCase(),
      originalSha256: record.originalSha256.toLowerCase(),
      originalPageCount: record.originalPageCount,
      originalPathDigest: record.originalStoragePathSha256.toLowerCase(),
      contractStatus: record.contractStatus,
      priorProcessingStatus: record.priorProcessingStatus,
    };
  }).sort((left, right) => left.contractId.localeCompare(right.contractId));
  if (new Set(targets.map((target) => target.contractId)).size !== targets.length
    || new Set(targets.map((target) => target.sourceJobId)).size !== targets.length) {
    throw new AuditOperationalError("geometry_backfill_baseline_duplicate");
  }
  if (expectedCount !== null && targets.length !== expectedCount) {
    throw new AuditOperationalError("geometry_backfill_cohort_count_drift");
  }
  const canonical = targets.map((target) => [
    target.contractId,
    target.sourceJobId,
    target.originalSha256,
    target.originalPageCount,
    target.originalPathDigest,
    target.contractStatus,
    target.priorProcessingStatus,
  ].join("|")).join("\n");
  const countBy = (key) => targets.reduce((counts, target) => {
    const value = target[key];
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
  return {
    targets,
    digest: sha256(Buffer.from(canonical, "utf8")),
    contractStatuses: countBy("contractStatus"),
    processingStatuses: countBy("priorProcessingStatus"),
  };
}

function assertSecureBaselinePath(filePath) {
  if (typeof filePath !== "string" || !isAbsolute(filePath)) {
    throw new AuditOperationalError("baseline_path_invalid");
  }
}

function assertSecureBaselineStat(stat) {
  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_BASELINE_BYTES
    || (stat.mode & 0o077) !== 0
    || (currentUid !== null && stat.uid !== currentUid)) {
    throw new AuditOperationalError("baseline_permissions_invalid");
  }
}

export async function writeBaselineFile(filePath, baseline) {
  assertSecureBaselinePath(filePath);
  assertValidBaseline(baseline);
  let handle;
  try {
    handle = await open(
      filePath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(baseline)}\n`, "utf8");
    await handle.sync();
    assertSecureBaselineStat(await handle.stat());
  } catch (error) {
    if (error instanceof AuditOperationalError) throw error;
    throw new AuditOperationalError("baseline_write_failed", { cause: error });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function readBaselineFile(filePath) {
  assertSecureBaselinePath(filePath);
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    assertSecureBaselineStat(stat);
    const raw = await handle.readFile("utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_BASELINE_BYTES) {
      throw new AuditOperationalError("baseline_invalid");
    }
    return assertValidBaseline(JSON.parse(raw));
  } catch (error) {
    if (error instanceof AuditOperationalError) throw error;
    throw new AuditOperationalError("baseline_read_failed", { cause: error });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function readPositiveInteger(value, fallback, maximum) {
  if (value == null || value === "") return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) throw new AuditOperationalError("invalid_configuration");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new AuditOperationalError("invalid_configuration");
  }
  return parsed;
}

export function createReadOnlyFetch(fetchImpl = fetch) {
  return async (input, init = {}) => {
    const requestMethod = input instanceof Request ? input.method : "GET";
    const method = String(init.method ?? requestMethod).toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      throw new AuditOperationalError("read_only_transport_violation");
    }
    return fetchImpl(input, { ...init, cache: "no-store" });
  };
}

export function createReadOnlySupabaseClient(url, serviceRoleKey, fetchImpl = fetch) {
  if (!url || !serviceRoleKey) throw new AuditOperationalError("missing_configuration");
  let origin;
  try {
    origin = new URL(url).origin;
  } catch (error) {
    throw new AuditOperationalError("invalid_configuration", { cause: error });
  }
  if (!origin.startsWith("https://") && !origin.startsWith("http://127.0.0.1:")) {
    throw new AuditOperationalError("invalid_configuration");
  }
  return createClient(origin, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { fetch: createReadOnlyFetch(fetchImpl) },
  });
}

async function selectAllCompletedJobs(db) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("contract_document_jobs")
      .select("id,org_id,contract_id,original_storage_path,output_storage_path,spatial_data_path,ocr_applied,page_count,original_sha256,processed_sha256,spatial_sha256,spatial_schema_version,redaction_profile,processing_profile,downstream_ai_policy,replacement_of_job_id,backfill_source_job_id,completed_at")
      .eq("status", "completed")
      // Superseded DLP generations retain immutable hashes and lineage in the
      // database, but their masked Storage artifacts are intentionally deleted.
      // Only the promoted generation is therefore subject to byte verification.
      .is("superseded_by_job_id", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new AuditOperationalError("database_query_failed");
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function selectAllDocumentJobs(db) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("contract_document_jobs")
      .select("id,contract_id,original_storage_path,status,ocr_applied,page_count,attempts")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new AuditOperationalError("database_query_failed");
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadReplacementDeletionState(db) {
  const replacementJobs = [];
  const deletionRows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db.from("contract_document_jobs")
      .select("id,status,replacement_of_job_id")
      .not("replacement_of_job_id", "is", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new AuditOperationalError("database_query_failed");
    const page = data ?? [];
    replacementJobs.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  const sourceJobsById = new Map();
  for (const ids of chunks(
    [...new Set(replacementJobs.map((job) => job.replacement_of_job_id))],
    QUERY_CHUNK_SIZE,
  )) {
    if (!ids.length) continue;
    const { data, error } = await db.from("contract_document_jobs")
      .select("id,original_storage_path,output_storage_path,spatial_data_path,superseded_by_job_id")
      .in("id", ids);
    if (error) throw new AuditOperationalError("database_query_failed");
    for (const job of data ?? []) sourceJobsById.set(job.id, job);
  }
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db.from("contract_document_artifact_deletions")
      .select("source_job_id,replacement_job_id,artifact_kind,storage_path,status")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new AuditOperationalError("database_query_failed");
    const page = data ?? [];
    deletionRows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return { replacementJobs, sourceJobsById, deletionRows };
}

export function isActiveDlpReplacementCandidate(job, contract) {
  return Boolean(job && contract
    && job.status === "completed"
    && job.ocr_applied === true
    && job.redaction_profile === "dfks-contract-redaction-v1"
    && job.spatial_schema_version === "google-vision-spatial-v2"
    && job.superseded_by_job_id == null
    && typeof job.original_storage_path === "string"
    && job.original_storage_path.length > 0
    && job.original_storage_path === contract.pdf_url
    && job.output_storage_path === contract.processed_pdf_url
    && job.spatial_data_path === contract.document_spatial_data_path
    && ["kladde", "afventer", "valideret"].includes(contract.status));
}

async function selectActiveDlpReplacementJobs(db) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("contract_document_jobs")
      .select("id,contract_id,original_storage_path,output_storage_path,spatial_data_path,status,ocr_applied,redaction_profile,spatial_schema_version,superseded_by_job_id")
      .eq("status", "completed")
      .eq("ocr_applied", true)
      .eq("redaction_profile", "dfks-contract-redaction-v1")
      .eq("spatial_schema_version", "google-vision-spatial-v2")
      .is("superseded_by_job_id", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new AuditOperationalError("database_query_failed");
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  const contractsById = await loadContracts(
    db,
    [...new Set(rows.map((job) => job.contract_id))],
  );
  return {
    contractsById,
    jobs: rows.filter((job) => isActiveDlpReplacementCandidate(
      job,
      contractsById.get(job.contract_id),
    )),
  };
}

function isPdfStoragePath(value) {
  return typeof value === "string" && /[.]pdf$/i.test(value);
}

function compareJobGeneration(left, right) {
  const leftCreatedAt = typeof left?.created_at === "string"
    ? Date.parse(left.created_at) : Number.NaN;
  const rightCreatedAt = typeof right?.created_at === "string"
    ? Date.parse(right.created_at) : Number.NaN;
  if (!Number.isFinite(leftCreatedAt) || !Number.isFinite(rightCreatedAt)) return 0;
  if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
  return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
}

/**
 * Selects the exact source generation for the one-off geometry backfill.
 *
 * The selector deliberately operates on a complete snapshot supplied by the
 * caller. It never guesses a missing source job and never falls back to an
 * older generation. The database preparation RPC repeats these fences under
 * row locks before it creates any job.
 */
export function selectGeometryBackfillSources({ contracts, jobs, expectedCount = null }) {
  if (!Array.isArray(contracts) || !Array.isArray(jobs)
    || (expectedCount !== null && (
      !Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 1000
    ))) {
    throw new AuditOperationalError("geometry_backfill_selection_invalid");
  }
  const jobsByContract = new Map();
  for (const job of jobs) {
    if (!UUID_PATTERN.test(job?.id ?? "") || !UUID_PATTERN.test(job?.contract_id ?? "")) {
      throw new AuditOperationalError("geometry_backfill_selection_invalid");
    }
    const rows = jobsByContract.get(job.contract_id) ?? [];
    rows.push(job);
    jobsByContract.set(job.contract_id, rows);
  }

  const selectedJobs = [];
  const selectedContractsById = new Map();
  const rejectedByReason = {
    contract_invalid: 0,
    source_missing: 0,
    source_not_latest_terminal: 0,
    source_state_drift: 0,
    source_lineage_conflict: 0,
    already_qualified: 0,
  };
  const seenContracts = new Set();

  for (const contract of contracts) {
    if (!UUID_PATTERN.test(contract?.id ?? "") || seenContracts.has(contract.id)
      || !UUID_PATTERN.test(contract?.org_id ?? "")
      || !isPdfStoragePath(contract?.pdf_url)
      || !GEOMETRY_BACKFILL_BUSINESS_STATUSES.includes(contract?.status)
      || !GEOMETRY_BACKFILL_TERMINAL_STATUSES.includes(
        contract?.document_processing_status,
      )) {
      rejectedByReason.contract_invalid += 1;
      continue;
    }
    seenContracts.add(contract.id);
    const generations = [...(jobsByContract.get(contract.id) ?? [])]
      .sort(compareJobGeneration);
    if (!generations.length || generations.some((job) => (
      !Number.isFinite(Date.parse(job.created_at ?? ""))
      || job.org_id !== contract.org_id
    ))) {
      rejectedByReason.source_missing += 1;
      continue;
    }
    const qualified = generations.some((job) => (
      job.status === "completed"
      && job.ocr_applied === true
      && job.ocr_engine === "google-vision-eu-v1"
      && job.processing_profile === "google-vision-direct-v1"
      && job.spatial_schema_version === "google-vision-spatial-v3"
      && Number(job.spatial_accuracy_score) >= 0.95
      && Number(job.spatial_median_iou) >= 0.85
      && Number(job.spatial_center_inside_ratio) >= 0.98
      && job.output_storage_path === contract.processed_pdf_url
      && job.spatial_data_path === contract.document_spatial_data_path
    ));
    if (qualified) {
      rejectedByReason.already_qualified += 1;
      continue;
    }
    const latest = generations.at(-1);
    if (!GEOMETRY_BACKFILL_TERMINAL_STATUSES.includes(latest.status)) {
      rejectedByReason.source_not_latest_terminal += 1;
      continue;
    }
    if (latest.status !== contract.document_processing_status
      || latest.original_storage_path !== contract.pdf_url
      || latest.processing_profile === "google-vision-direct-v1"
      || latest.spatial_schema_version === "google-vision-spatial-v3") {
      rejectedByReason.source_state_drift += 1;
      continue;
    }
    if (latest.superseded_by_job_id != null
      || latest.replacement_of_job_id != null
      || latest.backfill_run_id != null
      || latest.backfill_source_job_id != null
      || generations.some((job) => job.id !== latest.id && (
        job.status === "queued"
        || job.status === "processing"
        || (job.status === "failed" && Number(job.attempts) < 5
          && compareJobGeneration(job, latest) > 0)
      ))) {
      rejectedByReason.source_lineage_conflict += 1;
      continue;
    }
    selectedJobs.push(latest);
    selectedContractsById.set(contract.id, contract);
  }

  selectedJobs.sort((left, right) => left.contract_id.localeCompare(right.contract_id));
  if (expectedCount !== null && selectedJobs.length !== expectedCount) {
    throw new AuditOperationalError("geometry_backfill_cohort_count_drift");
  }
  return {
    jobs: selectedJobs,
    contractsById: selectedContractsById,
    rejectedByReason,
  };
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function loadContracts(db, contractIds) {
  const result = new Map();
  for (const ids of chunks(contractIds, QUERY_CHUNK_SIZE)) {
    if (!ids.length) continue;
    const { data, error } = await db
      .from("contracts")
      .select("id,status,pdf_url,processed_pdf_url,document_spatial_data_path,document_processing_status")
      .in("id", ids);
    if (error) throw new AuditOperationalError("database_query_failed");
    for (const contract of data ?? []) result.set(contract.id, contract);
  }
  return result;
}

async function selectGeometryBackfillCandidateContracts(db) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("contracts")
      .select("id,org_id,status,pdf_url,processed_pdf_url,document_spatial_data_path,document_processing_status,document_processing_error_code,document_processing_profile,document_spatial_schema_version,document_spatial_accuracy")
      .in("document_processing_status", GEOMETRY_BACKFILL_TERMINAL_STATUSES)
      .not("pdf_url", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new AuditOperationalError("database_query_failed");
    const page = data ?? [];
    rows.push(...page.filter((contract) => isPdfStoragePath(contract.pdf_url)));
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadGeometryBackfillGenerations(db, contractIds) {
  const rows = [];
  for (const ids of chunks(contractIds, QUERY_CHUNK_SIZE)) {
    if (!ids.length) continue;
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await db
        .from("contract_document_jobs")
        .select("id,org_id,contract_id,original_storage_path,output_storage_path,spatial_data_path,status,ocr_applied,ocr_engine,page_count,attempts,original_sha256,processing_profile,spatial_schema_version,spatial_accuracy_score,spatial_median_iou,spatial_center_inside_ratio,superseded_by_job_id,replacement_of_job_id,backfill_run_id,backfill_source_job_id,created_at")
        .in("contract_id", ids)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new AuditOperationalError("database_query_failed");
      const page = data ?? [];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

async function loadDocumentJobsById(db, jobIds) {
  const result = new Map();
  for (const ids of chunks(jobIds, QUERY_CHUNK_SIZE)) {
    if (!ids.length) continue;
    const { data, error } = await db
      .from("contract_document_jobs")
      .select("id,contract_id,original_storage_path,status")
      .in("id", ids);
    if (error) throw new AuditOperationalError("database_query_failed");
    for (const job of data ?? []) result.set(job.id, job);
  }
  return result;
}

async function loadActiveAiCounts(db, jobs) {
  const contractIds = [...new Set(jobs.map((job) => job.contract_id))];
  const completedAtByContract = new Map(jobs.map((job) => [
    job.contract_id,
    typeof job.completed_at === "string" ? Date.parse(job.completed_at) : Number.NaN,
  ]));
  const result = new Map(contractIds.map((id) => [id, 0]));
  for (const ids of chunks(contractIds, QUERY_CHUNK_SIZE)) {
    if (!ids.length) continue;
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await db
        .from("contract_ai_jobs")
        .select("id,contract_id,status,created_at")
        .in("contract_id", ids)
        .is("attachment_id", null)
        .in("status", ACTIVE_AI_JOB_STATUSES)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new AuditOperationalError("database_query_failed");
      const page = data ?? [];
      for (const row of page) {
        const completedAt = completedAtByContract.get(row.contract_id);
        const createdAt = typeof row.created_at === "string" ? Date.parse(row.created_at) : Number.NaN;
        if (!Number.isFinite(completedAt) || !Number.isFinite(createdAt) || createdAt < completedAt) continue;
        result.set(row.contract_id, (result.get(row.contract_id) ?? 0) + 1);
      }
      if (page.length < PAGE_SIZE) break;
    }
  }
  return result;
}

export async function loadPostBaselineAiCounts(db, contractIds, capturedAt) {
  const uniqueContractIds = [...new Set(contractIds)];
  const capturedAtTimestamp = Date.parse(capturedAt);
  if (!Number.isFinite(capturedAtTimestamp)) {
    throw new AuditOperationalError("baseline_invalid");
  }
  const cutoff = new Date(capturedAtTimestamp).toISOString();
  const result = new Map(uniqueContractIds.map((id) => [id, 0]));
  for (const ids of chunks(uniqueContractIds, QUERY_CHUNK_SIZE)) {
    if (!ids.length) continue;
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await db
        .from("contract_ai_jobs")
        .select("id,contract_id,created_at")
        .in("contract_id", ids)
        .gte("created_at", cutoff)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new AuditOperationalError("database_query_failed");
      const page = data ?? [];
      for (const row of page) {
        result.set(row.contract_id, (result.get(row.contract_id) ?? 0) + 1);
      }
      if (page.length < PAGE_SIZE) break;
    }
  }
  return result;
}

async function loadRelevantAiJobs(db, contractIds, createdAtOrAfter = null) {
  const rows = [];
  for (const ids of chunks(contractIds, QUERY_CHUNK_SIZE)) {
    if (!ids.length) continue;
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = db
        .from("contract_ai_jobs")
        .select("id,status,attempts")
        .in("contract_id", ids)
        .is("attachment_id", null)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (createdAtOrAfter) query = query.gte("created_at", createdAtOrAfter);
      const { data, error } = await query;
      if (error) throw new AuditOperationalError("database_query_failed");
      const page = data ?? [];
      rows.push(...page.map(({ status, attempts }) => ({ status, attempts })));
      if (page.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

async function mapLimit(items, concurrency, callback) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await callback(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function createStorageReader(db) {
  return async (storagePath) => {
    if (typeof storagePath !== "string" || !storagePath) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const { data, error } = await db.storage.from(CONTRACT_BUCKET)
        .download(storagePath, {}, { cache: "no-store", signal: controller.signal });
      if (error || !data || data.size > MAX_PDF_BYTES) {
        throw new AuditOperationalError("storage_read_failed");
      }
      return new Uint8Array(await data.arrayBuffer());
    } catch {
      // The aggregate audit reports a read failure without exposing object data.
      throw new AuditOperationalError("storage_read_failed");
    } finally {
      clearTimeout(timer);
    }
  };
}

export async function captureDatabaseBaseline({ db, concurrency = DEFAULT_CONCURRENCY }) {
  const jobs = await selectAllDocumentJobs(db);
  const contractsById = await loadContracts(db, [...new Set(jobs.map((job) => job.contract_id))]);
  return captureBaseline({
    jobs,
    contractsById,
    readStorage: createStorageReader(db),
    concurrency,
  });
}

export async function captureDatabaseDirectVisionBaseline({
  db,
  concurrency = DEFAULT_CONCURRENCY,
}) {
  const { jobs, contractsById } = await selectActiveDlpReplacementJobs(db);
  return captureBaseline({
    jobs,
    contractsById,
    readStorage: createStorageReader(db),
    concurrency,
  });
}

export async function captureDatabaseGeometryBackfillBaseline({
  db,
  expectedCount,
  concurrency = DEFAULT_CONCURRENCY,
}) {
  const contracts = await selectGeometryBackfillCandidateContracts(db);
  const generations = await loadGeometryBackfillGenerations(
    db,
    contracts.map((contract) => contract.id),
  );
  const selected = selectGeometryBackfillSources({
    contracts,
    jobs: generations,
    expectedCount,
  });
  const result = await captureBaseline({
    jobs: selected.jobs,
    contractsById: selected.contractsById,
    readStorage: createStorageReader(db),
    concurrency,
  });
  if (result.baseline && !summaryHasViolations(result.summary)) {
    const cohort = geometryBackfillBaselineCohort(result.baseline, { expectedCount });
    result.summary.geometryCohort = {
      selected: cohort.targets.length,
      expected: expectedCount,
      cohortDigest: cohort.digest,
      contractStatuses: cohort.contractStatuses,
      processingStatuses: cohort.processingStatuses,
      rejectedByReason: selected.rejectedByReason,
    };
  }
  return result;
}

export async function verifyDatabaseGeometryBackfillBaseline({
  db,
  baseline,
  expectedCount,
  concurrency = DEFAULT_CONCURRENCY,
}) {
  const cohort = geometryBackfillBaselineCohort(baseline, { expectedCount });
  const contracts = await selectGeometryBackfillCandidateContracts(db);
  const generations = await loadGeometryBackfillGenerations(
    db,
    contracts.map((contract) => contract.id),
  );
  const current = selectGeometryBackfillSources({
    contracts,
    jobs: generations,
    expectedCount,
  });
  const currentJobIds = new Set(current.jobs.map((job) => job.id));
  const currentById = new Map(current.jobs.map((job) => [job.id, job]));
  if (cohort.targets.some((target) => {
    const job = currentById.get(target.sourceJobId);
    return !currentJobIds.has(target.sourceJobId)
      || (job.original_sha256 != null && job.original_sha256 !== target.originalSha256)
      || (job.page_count != null && job.page_count !== target.originalPageCount);
  })) {
    throw new AuditOperationalError("geometry_backfill_cohort_changed");
  }
  const currentBaseline = {
    ...baseline,
    records: baseline.records.map((record) => ({
      ...record,
      priorProcessingStatus: currentById.get(record.jobId)?.status,
    })),
  };
  const currentCohort = geometryBackfillBaselineCohort({
    ...currentBaseline,
    integritySha256: baselineDigest(currentBaseline),
  }, { expectedCount });
  if (currentCohort.digest !== cohort.digest) {
    throw new AuditOperationalError("geometry_backfill_cohort_changed");
  }
  const summary = await verifyBaseline({
    baseline,
    jobsById: currentById,
    contractsById: current.contractsById,
    readStorage: createStorageReader(db),
    concurrency,
  });
  summary.geometryCohort = {
    selected: cohort.targets.length,
    expected: expectedCount,
    cohortDigest: cohort.digest,
    contractStatuses: cohort.contractStatuses,
    processingStatuses: cohort.processingStatuses,
  };
  return summary;
}

export async function verifyDatabaseDirectVisionBaseline({
  db,
  baseline,
  concurrency = DEFAULT_CONCURRENCY,
}) {
  assertValidBaseline(baseline);
  const { jobs, contractsById } = await selectActiveDlpReplacementJobs(db);
  const activeJobIds = new Set(jobs.map((job) => job.id));
  if (jobs.length !== baseline.records.length
    || baseline.records.some((record) => !activeJobIds.has(record.jobId))) {
    throw new AuditOperationalError("direct_vision_cohort_changed");
  }
  return verifyBaseline({
    baseline,
    jobsById: new Map(jobs.map((job) => [job.id, job])),
    contractsById,
    readStorage: createStorageReader(db),
    concurrency,
  });
}

function sameNullable(left, right) {
  return (left ?? null) === (right ?? null);
}

function nullablePathDigest(value) {
  return value == null ? null : sha256(Buffer.from(value, "utf8"));
}

function addViolations(target, source) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

/**
 * Checks the relational/state portion of one exact geometry run without
 * reading document bytes. The separate byte audit below verifies original,
 * derived PDF and spatial data.
 */
export function auditGeometryBackfillRunRecords({
  run,
  targets,
  jobsById,
  sourceJobsById,
  contractsById,
  artifactDeletionRows,
  auditEventsById = new Map(),
  auditSubjectsByEventId = new Map(),
  baseline,
}) {
  const cohort = geometryBackfillBaselineCohort(baseline, {
    expectedCount: run?.expected_count,
  });
  const violations = emptyViolations();
  const outcomes = statusDistribution([
    "queued", "processing", "completed", "needs_review", "failed",
  ]);
  const jobsByStatus = statusDistribution(DOCUMENT_JOB_STATUSES);
  const baselineByContract = new Map(
    cohort.targets.map((target) => [target.contractId, target]),
  );
  const runJobsByContract = new Map();
  for (const candidate of jobsById?.values?.() ?? []) {
    if (candidate?.backfill_run_id !== run?.id) continue;
    const rows = runJobsByContract.get(candidate.contract_id) ?? [];
    rows.push(candidate);
    runJobsByContract.set(candidate.contract_id, rows);
  }

  if (!run || !UUID_PATTERN.test(run.id ?? "")
    || run.kind !== "direct_vision_geometry_v3"
    || run.processing_profile !== "google-vision-direct-v1"
    || run.spatial_schema_version !== "google-vision-spatial-v3"
    || !["quality_pending", "completed"].includes(run.state)
    || run.expected_count !== cohort.targets.length
    || run.cohort_digest !== cohort.digest) {
    violations.geometryRunMetadataMismatch += 1;
  }
  if (!Array.isArray(targets) || targets.length !== cohort.targets.length
    || new Set(targets?.map((target) => target.contract_id)).size !== targets?.length) {
    violations.geometryTargetCountMismatch += 1;
  }

  for (const target of targets ?? []) {
    const baselineTarget = baselineByContract.get(target.contract_id);
    const outcome = ["queued", "processing", "completed", "needs_review", "failed"]
      .includes(target.outcome) ? target.outcome : "unknown";
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    if (!baselineTarget
      || target.run_id !== run?.id
      || target.source_job_id !== baselineTarget.sourceJobId
      || target.original_sha256 !== baselineTarget.originalSha256
      || target.original_page_count !== baselineTarget.originalPageCount
      || target.original_path_digest !== baselineTarget.originalPathDigest
      || target.contract_status !== baselineTarget.contractStatus
      || target.prior_processing_status !== baselineTarget.priorProcessingStatus
      || !Number.isInteger(target.recovery_generation)
      || target.recovery_generation < 0
      || target.recovery_generation > 20
      || !UUID_PATTERN.test(target.queued_job_id ?? "")) {
      violations.geometryTargetBaselineMismatch += 1;
      continue;
    }

    const job = jobsById.get(target.queued_job_id);
    const source = sourceJobsById.get(target.source_job_id);
    const contract = normalizeContract(contractsById.get(target.contract_id));
    const contractRunJobs = runJobsByContract.get(target.contract_id) ?? [];
    const jobStatus = DOCUMENT_JOB_STATUSES.includes(job?.status) ? job.status : "unknown";
    jobsByStatus[jobStatus] = (jobsByStatus[jobStatus] ?? 0) + 1;
    if (!job || job.contract_id !== target.contract_id || job.org_id !== target.org_id
      || job.backfill_run_id !== run?.id
      || job.backfill_source_job_id !== target.source_job_id
      || job.processing_intent !== "direct_vision_geometry_backfill_v1"
      || job.replacement_of_job_id != null
      || job.downstream_ai_policy !== "preserve"
      || job.processing_profile !== "google-vision-direct-v1"
      || job.original_storage_path !== source?.original_storage_path
      || job.original_sha256 !== target.original_sha256) {
      violations.geometryJobMissingOrMismatch += 1;
    }
    const expectedOutcome = job?.status === "completed" ? "completed"
      : job?.status === "needs_review" ? "needs_review"
        : job?.status === "failed" ? "failed"
          : job?.status === "processing" ? "processing"
            : job?.status === "queued" ? "queued" : null;
    if (expectedOutcome !== target.outcome) {
      violations.geometryOutcomeStatusMismatch += 1;
    }
    if (["queued", "processing"].includes(job?.status)
      || (job?.status === "failed" && Number(job.attempts) < 5)) {
      violations.geometryNonTerminalJob += 1;
    }
    if (!source || source.contract_id !== target.contract_id
      || source.org_id !== target.org_id
      || source.status !== target.prior_processing_status
      || source.original_storage_path !== job?.original_storage_path
      || nullablePathDigest(source.original_storage_path) !== target.original_path_digest
      || (source.original_sha256 != null
        && source.original_sha256 !== target.original_sha256)
      || (source.page_count != null
        && source.page_count !== target.original_page_count)) {
      violations.geometrySourceLineageMismatch += 1;
    }
    if (!contract || contract.status !== target.contract_status
      || nullablePathDigest(contract.pdf_url) !== target.original_path_digest) {
      violations.geometryPriorStateMismatch += 1;
      continue;
    }

    const chain = [];
    const seen = new Set();
    let cursor = job;
    while (cursor && !seen.has(cursor.id) && chain.length <= 21) {
      seen.add(cursor.id);
      chain.push(cursor);
      cursor = cursor.recovery_of_job_id == null
        ? null : jobsById.get(cursor.recovery_of_job_id);
    }
    const ascendingChain = [...chain].reverse();
    let chainMismatch = cursor != null
      || chain.length !== target.recovery_generation + 1
      || contractRunJobs.length !== chain.length
      || ascendingChain[0]?.recovery_of_job_id != null
      || ascendingChain.at(-1)?.id !== target.queued_job_id;
    for (let generation = 0; generation < ascendingChain.length; generation += 1) {
      const generationJob = ascendingChain[generation];
      const parent = generation === 0 ? null : ascendingChain[generation - 1];
      if (generationJob.backfill_run_id !== run?.id
        || generationJob.contract_id !== target.contract_id
        || generationJob.org_id !== target.org_id
        || generationJob.backfill_source_job_id !== target.source_job_id
        || generationJob.original_sha256 !== target.original_sha256
        || generationJob.original_storage_path !== job?.original_storage_path
        || generationJob.processing_intent !== "direct_vision_geometry_backfill_v1"
        || generationJob.downstream_ai_policy !== "preserve"
        || generationJob.processing_profile !== "google-vision-direct-v1"
        || generationJob.replacement_of_job_id != null
        || (generationJob.recovery_of_job_id ?? null) !== (parent?.id ?? null)
        || (generationJob.id !== target.queued_job_id && (
          !["needs_review", "failed"].includes(generationJob.status)
          || (generationJob.status === "failed" && Number(generationJob.attempts) < 5)
        ))) {
        chainMismatch = true;
      }
      if (generation === 0) {
        if (generationJob.backfill_recovery_audit_event_id != null) {
          violations.geometryRecoveryAuditMismatch += 1;
        }
        continue;
      }
      const event = auditEventsById.get(generationJob.backfill_recovery_audit_event_id);
      const subjectIds = auditSubjectsByEventId.get(
        generationJob.backfill_recovery_audit_event_id,
      ) ?? new Set();
      const sortedSubjectIds = [...subjectIds].sort();
      const expectedSubjectHash = sortedSubjectIds.length
        ? sha256(Buffer.from(sortedSubjectIds.join(","), "utf8")) : null;
      if (!UUID_PATTERN.test(generationJob.backfill_recovery_audit_event_id ?? "")
        || generationJob.recovery_reason_code !== "geometry_quality_recovery_v1"
        || !event
        || event.entity_type !== "contract_document_backfill_recovery"
        || event.entity_id !== run?.id
        || event.correlation_id !== run?.id
        || event.metadata?.event_code !== "vision_v3_geometry_backfill_recovery_queued"
        || Number(event.metadata?.audit_subject_count) !== sortedSubjectIds.length
        || (event.metadata?.audit_subject_set_hash ?? null) !== expectedSubjectHash
        || (contract.rights_holder_id != null && !subjectIds.has(contract.rights_holder_id))) {
        violations.geometryRecoveryAuditMismatch += 1;
      }
    }
    if (chainMismatch) violations.geometryRecoveryChainMismatch += 1;

    if (job?.status === "completed") {
      if (source?.superseded_by_job_id !== job.id
        || contract.document_processing_status !== "ready"
        || contract.processed_pdf_url !== job.output_storage_path
        || contract.document_spatial_data_path !== job.spatial_data_path
        || contract.document_processing_profile !== "google-vision-direct-v1"
        || contract.document_spatial_schema_version !== "google-vision-spatial-v3") {
        violations.geometrySourceLineageMismatch += 1;
      }
    } else if (source?.superseded_by_job_id != null
      || contract.document_processing_status !== target.prior_processing_status
      || !sameNullable(
        contract.document_processing_error_code,
        target.prior_processing_error_code,
      )
      || !sameNullable(
        contract.document_processing_profile,
        target.prior_processing_profile,
      )
      || !sameNullable(
        contract.document_spatial_schema_version,
        target.prior_spatial_schema_version,
      )
      || !sameNullable(
        contract.document_spatial_accuracy,
        target.prior_spatial_accuracy,
      )
      || nullablePathDigest(contract.processed_pdf_url)
        !== (target.prior_processed_path_digest ?? null)
      || nullablePathDigest(contract.document_spatial_data_path)
        !== (target.prior_spatial_path_digest ?? null)) {
      violations.geometryPriorStateMismatch += 1;
    }
  }
  const unresolvedOutcomes = (outcomes.queued ?? 0)
    + (outcomes.processing ?? 0)
    + (outcomes.needs_review ?? 0)
    + (outcomes.failed ?? 0)
    + (outcomes.unknown ?? 0);
  if ((outcomes.completed ?? 0) !== cohort.targets.length || unresolvedOutcomes > 0) {
    violations.geometryUnresolvedOutcome += Math.max(
      1,
      unresolvedOutcomes,
      cohort.targets.length - (outcomes.completed ?? 0),
    );
  }
  if ((artifactDeletionRows ?? []).length > 0) {
    violations.geometryUnexpectedArtifactDeletion += artifactDeletionRows.length;
  }
  return {
    expectedDocuments: cohort.targets.length,
    targetsExamined: targets?.length ?? 0,
    cohortDigest: cohort.digest,
    runState: run?.state ?? "missing",
    outcomes,
    jobsByStatus,
    violations,
  };
}

async function loadGeometryBackfillRunSnapshot(db, runId) {
  const { data: run, error: runError } = await db
    .from("contract_document_backfill_runs")
    .select("id,kind,processing_profile,spatial_schema_version,state,expected_count,cohort_digest,quality_report_digest,created_at,completed_at")
    .eq("id", runId)
    .maybeSingle();
  if (runError || !run) throw new AuditOperationalError("geometry_backfill_run_not_found");
  const targets = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("contract_document_backfill_targets")
      .select("run_id,contract_id,org_id,source_job_id,queued_job_id,original_sha256,original_page_count,original_path_digest,contract_status,prior_processing_status,prior_processing_error_code,prior_processing_profile,prior_spatial_schema_version,prior_spatial_accuracy,prior_processed_path_digest,prior_spatial_path_digest,outcome,recovery_generation")
      .eq("run_id", runId)
      .order("contract_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new AuditOperationalError("database_query_failed");
    const page = data ?? [];
    targets.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  const jobsById = new Map();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("contract_document_jobs")
      .select("id,org_id,contract_id,original_storage_path,output_storage_path,spatial_data_path,status,ocr_applied,ocr_engine,page_count,text_char_count,native_page_count,ocr_page_count,unreadable_page_count,attempts,original_sha256,processed_sha256,spatial_sha256,redaction_profile,processing_profile,spatial_schema_version,spatial_accuracy_score,spatial_median_iou,spatial_center_inside_ratio,downstream_ai_policy,replacement_of_job_id,recovery_of_job_id,recovery_reason_code,backfill_recovery_audit_event_id,superseded_by_job_id,backfill_run_id,backfill_source_job_id,processing_intent,completed_at,created_at")
      .eq("backfill_run_id", runId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new AuditOperationalError("database_query_failed");
    const page = data ?? [];
    for (const job of page) jobsById.set(job.id, job);
    if (page.length < PAGE_SIZE) break;
  }
  const sourceJobIds = [...new Set(targets.map((target) => target.source_job_id))];
  for (const ids of chunks(sourceJobIds, QUERY_CHUNK_SIZE)) {
    if (!ids.length) continue;
    const { data, error } = await db
      .from("contract_document_jobs")
      .select("id,org_id,contract_id,original_storage_path,output_storage_path,spatial_data_path,status,ocr_applied,ocr_engine,page_count,text_char_count,native_page_count,ocr_page_count,unreadable_page_count,attempts,original_sha256,processed_sha256,spatial_sha256,redaction_profile,processing_profile,spatial_schema_version,spatial_accuracy_score,spatial_median_iou,spatial_center_inside_ratio,downstream_ai_policy,replacement_of_job_id,recovery_of_job_id,recovery_reason_code,backfill_recovery_audit_event_id,superseded_by_job_id,backfill_run_id,backfill_source_job_id,processing_intent,completed_at,created_at")
      .in("id", ids);
    if (error) throw new AuditOperationalError("database_query_failed");
    for (const job of data ?? []) jobsById.set(job.id, job);
  }
  const contractsById = new Map();
  for (const ids of chunks(targets.map((target) => target.contract_id), QUERY_CHUNK_SIZE)) {
    if (!ids.length) continue;
    const { data, error } = await db
      .from("contracts")
      .select("id,org_id,rights_holder_id,status,pdf_url,processed_pdf_url,document_spatial_data_path,document_processing_status,document_processing_error_code,document_processing_profile,document_spatial_schema_version,document_spatial_accuracy")
      .in("id", ids);
    if (error) throw new AuditOperationalError("database_query_failed");
    for (const contract of data ?? []) contractsById.set(contract.id, contract);
  }
  const recoveryAuditIds = [...new Set([...jobsById.values()]
    .map((job) => job.backfill_recovery_audit_event_id)
    .filter(Boolean))];
  const auditEventsById = new Map();
  const auditSubjectsByEventId = new Map();
  for (const ids of chunks(recoveryAuditIds, QUERY_CHUNK_SIZE)) {
    if (!ids.length) continue;
    const [{ data: eventData, error: eventError }, { data: subjectData, error: subjectError }] =
      await Promise.all([
        db.from("audit_events")
          .select("id,entity_type,entity_id,correlation_id,metadata")
          .in("id", ids),
        db.from("audit_event_subjects")
          .select("event_id,target_member_uuid")
          .in("event_id", ids),
      ]);
    if (eventError || subjectError) throw new AuditOperationalError("database_query_failed");
    for (const event of eventData ?? []) auditEventsById.set(event.id, event);
    for (const subject of subjectData ?? []) {
      const subjects = auditSubjectsByEventId.get(subject.event_id) ?? new Set();
      subjects.add(subject.target_member_uuid);
      auditSubjectsByEventId.set(subject.event_id, subjects);
    }
  }
  const artifactDeletionRows = [];
  const runJobIds = [...jobsById.values()]
    .filter((job) => job.backfill_run_id === runId)
    .map((job) => job.id);
  for (const ids of chunks(runJobIds, QUERY_CHUNK_SIZE)) {
    if (!ids.length) continue;
    const { data, error } = await db
      .from("contract_document_artifact_deletions")
      .select("replacement_job_id")
      .in("replacement_job_id", ids);
    if (error) throw new AuditOperationalError("database_query_failed");
    artifactDeletionRows.push(...(data ?? []));
  }
  return {
    run,
    targets,
    jobsById,
    contractsById,
    artifactDeletionRows,
    auditEventsById,
    auditSubjectsByEventId,
  };
}

export function geometryBackfillQualityReportDigest(summary) {
  const sortedViolations = Object.fromEntries(
    Object.entries(summary.violations ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  );
  return sha256(Buffer.from(JSON.stringify({
    schemaVersion: GEOMETRY_BACKFILL_QUALITY_SCHEMA_VERSION,
    cohortDigest: summary.cohortDigest,
    expectedDocuments: summary.expectedDocuments,
    targetsExamined: summary.targetsExamined,
    outcomes: summary.outcomes,
    jobsByStatus: summary.jobsByStatus,
    completedDocumentsPassingAllChecks: summary.completedDocumentsPassingAllChecks,
    baselineDocumentsPassingAllChecks: summary.baselineDocumentsPassingAllChecks,
    violations: sortedViolations,
  }), "utf8"));
}

export async function runGeometryBackfillAudit({
  db,
  runId,
  baseline,
  concurrency = DEFAULT_CONCURRENCY,
}) {
  if (!UUID_PATTERN.test(runId ?? "")) {
    throw new AuditOperationalError("geometry_backfill_run_id_invalid");
  }
  const snapshot = await loadGeometryBackfillRunSnapshot(db, runId);
  const sourceJobsById = new Map(snapshot.targets.map((target) => [
    target.source_job_id,
    snapshot.jobsById.get(target.source_job_id),
  ]));
  const stateSummary = auditGeometryBackfillRunRecords({
    ...snapshot,
    sourceJobsById,
    baseline,
  });
  const baselineJobsById = new Map(snapshot.targets.map((target) => [
    target.source_job_id,
    snapshot.jobsById.get(target.source_job_id),
  ]));
  const baselineSummary = await verifyBaseline({
    baseline,
    jobsById: baselineJobsById,
    contractsById: snapshot.contractsById,
    readStorage: createStorageReader(db),
    concurrency,
  });
  const completedJobs = snapshot.targets
    .map((target) => snapshot.jobsById.get(target.queued_job_id))
    .filter((job) => job?.status === "completed");
  const postBaselineAiCounts = await loadPostBaselineAiCounts(
    db,
    snapshot.targets.map((target) => target.contract_id),
    baseline.capturedAt,
  );
  const zeroAiCounts = new Map(completedJobs.map((job) => [job.contract_id, 0]));
  const baselineStatusByContract = new Map(
    baseline.records.map((record) => [record.contractId, record.contractStatus]),
  );
  const baselineOriginalByJob = new Map(baseline.records.map((record) => [
    record.contractId,
    {
      jobId: record.jobId,
      contractId: record.contractId,
      originalSha256: record.originalSha256,
      originalStoragePathDigest: record.originalStoragePathSha256,
      originalPdfReadable: record.originalPdfReadable,
      originalPageCount: record.originalPageCount,
      originalPageCountSource: record.originalPageCountSource,
    },
  ]));
  const completedSummary = await auditCompletedJobs({
    jobs: completedJobs,
    contractsById: snapshot.contractsById,
    activeAiCounts: zeroAiCounts,
    baselineStatusByContract,
    baselineOriginalByJob,
    readStorage: createStorageReader(db),
    concurrency,
  });
  const violations = emptyViolations();
  addViolations(violations, stateSummary.violations);
  addViolations(violations, baselineSummary.violations);
  addViolations(violations, completedSummary.violations);
  violations.geometryUnexpectedAiGeneration += [...postBaselineAiCounts.values()]
    .reduce((sum, count) => sum + count, 0);
  const summary = {
    expectedDocuments: stateSummary.expectedDocuments,
    targetsExamined: stateSummary.targetsExamined,
    cohortDigest: stateSummary.cohortDigest,
    runState: stateSummary.runState,
    outcomes: stateSummary.outcomes,
    jobsByStatus: stateSummary.jobsByStatus,
    completedDocumentsPassingAllChecks: completedSummary.documentsPassingAllChecks,
    baselineDocumentsPassingAllChecks: baselineSummary.baselineDocumentsPassingAllChecks,
    baselineSourceState: baselineSummary.baselineSourceState,
    violations,
  };
  const qualityReportDigest = geometryBackfillQualityReportDigest(summary);
  if (snapshot.run.state === "completed"
    && snapshot.run.quality_report_digest !== qualityReportDigest) {
    summary.violations.geometryRunMetadataMismatch += 1;
  }
  return { summary: { ...summary, qualityReportDigest }, run: snapshot.run };
}

export async function runAudit({ db, concurrency = DEFAULT_CONCURRENCY, baseline = null }) {
  const [jobs, allDocumentJobs] = await Promise.all([
    selectAllCompletedJobs(db),
    selectAllDocumentJobs(db),
  ]);
  if (baseline) assertValidBaseline(baseline);
  const baselineContractIds = baseline?.records.map((record) => record.contractId) ?? [];
  const contractIds = [...new Set([
    ...jobs.map((job) => job.contract_id),
    ...baselineContractIds,
  ])];
  const allDocumentContractIds = [...new Set(allDocumentJobs.map((job) => job.contract_id))];
  const [
    contractsById,
    activeAiCounts,
    baselineJobsById,
    relevantAiJobs,
    replacementDeletionState,
  ] = await Promise.all([
    loadContracts(db, contractIds),
    loadActiveAiCounts(db, jobs),
    baseline
      ? loadDocumentJobsById(db, baseline.records.map((record) => record.jobId))
      : Promise.resolve(new Map()),
    loadRelevantAiJobs(db, allDocumentContractIds, baseline?.capturedAt ?? null),
    loadReplacementDeletionState(db),
  ]);
  const baselineStatusByContract = new Map(
    baseline?.records.map((record) => [record.contractId, record.contractStatus]) ?? [],
  );
  const baselineOriginalByJob = new Map();
  for (const record of baseline?.records ?? []) {
    const entry = {
      jobId: record.jobId,
      contractId: record.contractId,
      originalSha256: record.originalSha256,
      originalStoragePathDigest: record.originalStoragePathSha256,
      originalPdfReadable: record.originalPdfReadable,
      originalPageCount: record.originalPageCount,
      originalPageCountSource: record.originalPageCountSource,
    };
    baselineOriginalByJob.set(record.jobId, entry);
    baselineOriginalByJob.set(record.contractId, entry);
  }

  const summary = await auditCompletedJobs({
    jobs,
    contractsById,
    activeAiCounts,
    baselineStatusByContract,
    baselineOriginalByJob,
    readStorage: createStorageReader(db),
    concurrency,
  });
  summary.operational = summarizeOperationalState({
    documentJobs: allDocumentJobs,
    aiJobs: relevantAiJobs,
  });
  const replacementViolations = auditReplacementDeletionLifecycle(replacementDeletionState);
  for (const [key, value] of Object.entries(replacementViolations)) {
    summary.violations[key] += value;
  }
  if (baseline) {
    const baselineSummary = await verifyBaseline({
      baseline,
      jobsById: baselineJobsById,
      contractsById,
      readStorage: createStorageReader(db),
      concurrency,
    });
    summary.baselineJobsExamined = baselineSummary.baselineJobsExamined;
    summary.baselineDocumentsPassingAllChecks = baselineSummary.baselineDocumentsPassingAllChecks;
    summary.baselineSourceState = { ...baselineSummary.baselineSourceState };
    for (const [key, value] of Object.entries(baselineSummary.violations)) {
      summary.violations[key] += value;
    }
  }
  return summary;
}

export function safeSummaryJson(summary) {
  return JSON.stringify(summary, null, 2);
}

function geometryBackfillExpectedCount() {
  return readPositiveInteger(
    process.env.OCR_GEOMETRY_BACKFILL_EXPECTED_COUNT,
    251,
    1000,
  );
}

async function approveGeometryBackfillQualityGate({ db, runId, audit }) {
  if (!geometryBackfillSummaryReadyForApproval(audit.summary)) {
    throw new AuditOperationalError("geometry_backfill_quality_failed");
  }
  if (audit.run.state === "completed") {
    if (audit.run.quality_report_digest !== audit.summary.qualityReportDigest) {
      throw new AuditOperationalError("geometry_backfill_quality_digest_drift");
    }
    return "already_approved";
  }
  if (audit.run.state !== "quality_pending") {
    throw new AuditOperationalError("geometry_backfill_quality_not_ready");
  }
  const { data, error } = await db.rpc(
    "complete_contract_document_geometry_backfill_run",
    {
      p_run_id: runId,
      p_cohort_digest: audit.summary.cohortDigest,
      p_quality_report_digest: audit.summary.qualityReportDigest,
      p_completed: audit.summary.outcomes.completed,
      p_needs_review: audit.summary.outcomes.needs_review,
      p_failed: audit.summary.outcomes.failed,
    },
  );
  if (error || data !== true) {
    throw new AuditOperationalError("geometry_backfill_quality_commit_failed");
  }
  return "approved";
}

async function main() {
  loadEnv({ path: ".env.local", quiet: true });
  const mode = process.argv[2] ?? "audit";
  if (![
    "audit",
    "capture-baseline",
    "capture-direct-vision-baseline",
    "capture-geometry-backfill-baseline",
    "verify-baseline",
    "verify-direct-vision-baseline",
    "verify-geometry-backfill-baseline",
    "audit-geometry-backfill",
    "approve-geometry-backfill",
  ].includes(mode)) {
    throw new AuditOperationalError("invalid_mode");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const concurrency = readPositiveInteger(
    process.env.OCR_AUDIT_CONCURRENCY,
    DEFAULT_CONCURRENCY,
    MAX_CONCURRENCY,
  );
  const db = createReadOnlySupabaseClient(url, serviceRoleKey);

  if ([
    "capture-baseline",
    "capture-direct-vision-baseline",
    "capture-geometry-backfill-baseline",
  ].includes(mode)) {
    const geometryMode = mode === "capture-geometry-backfill-baseline";
    const baselinePath = geometryMode
      ? process.env.OCR_GEOMETRY_BACKFILL_BASELINE_PATH
      : process.env.OCR_BACKFILL_BASELINE_PATH;
    assertSecureBaselinePath(baselinePath);
    const capture = geometryMode
      ? captureDatabaseGeometryBackfillBaseline
      : mode === "capture-direct-vision-baseline"
        ? captureDatabaseDirectVisionBaseline
        : captureDatabaseBaseline;
    const { baseline, summary } = await capture({
      db,
      concurrency,
      ...(geometryMode ? { expectedCount: geometryBackfillExpectedCount() } : {}),
    });
    if (!baseline || summaryHasViolations(summary)) {
      process.stdout.write(`${safeSummaryJson({ mode, ...summary })}\n`);
      process.exitCode = 1;
      return;
    }
    await writeBaselineFile(baselinePath, baseline);
    process.stdout.write(`${safeSummaryJson({ mode, ...summary })}\n`);
    return;
  }

  if (mode === "verify-direct-vision-baseline") {
    const baseline = await readBaselineFile(process.env.OCR_BACKFILL_BASELINE_PATH);
    const summary = await verifyDatabaseDirectVisionBaseline({ db, baseline, concurrency });
    process.stdout.write(`${safeSummaryJson({ mode, ...summary })}\n`);
    if (summaryHasViolations(summary)) process.exitCode = 1;
    return;
  }

  if (mode === "verify-geometry-backfill-baseline") {
    const baseline = await readBaselineFile(
      process.env.OCR_GEOMETRY_BACKFILL_BASELINE_PATH,
    );
    const summary = await verifyDatabaseGeometryBackfillBaseline({
      db,
      baseline,
      expectedCount: geometryBackfillExpectedCount(),
      concurrency,
    });
    process.stdout.write(`${safeSummaryJson({ mode, ...summary })}\n`);
    if (summaryHasViolations(summary)) process.exitCode = 1;
    return;
  }

  if (mode === "audit-geometry-backfill" || mode === "approve-geometry-backfill") {
    const runId = process.env.OCR_GEOMETRY_BACKFILL_RUN_ID;
    const baseline = await readBaselineFile(
      process.env.OCR_GEOMETRY_BACKFILL_BASELINE_PATH,
    );
    geometryBackfillBaselineCohort(baseline, {
      expectedCount: geometryBackfillExpectedCount(),
    });
    const audit = await runGeometryBackfillAudit({
      db,
      runId,
      baseline,
      concurrency,
    });
    if (mode === "audit-geometry-backfill") {
      process.stdout.write(`${safeSummaryJson({ mode, ...audit.summary })}\n`);
      if (summaryHasViolations(audit.summary)) process.exitCode = 1;
      return;
    }
    if (process.env.OCR_GEOMETRY_BACKFILL_APPROVE !== "APPROVE_VISION_V3_GEOMETRY_BACKFILL") {
      throw new AuditOperationalError("geometry_backfill_approval_required");
    }
    const writeDb = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    const outcome = await approveGeometryBackfillQualityGate({
      db: writeDb,
      runId,
      audit,
    });
    process.stdout.write(`${safeSummaryJson({
      mode,
      ...audit.summary,
      qualityGate: outcome,
    })}\n`);
    return;
  }

  const baseline = mode === "verify-baseline"
    ? await readBaselineFile(process.env.OCR_BACKFILL_BASELINE_PATH)
    : null;
  const summary = await runAudit({ db, concurrency, baseline });
  process.stdout.write(`${safeSummaryJson(summary)}\n`);
  if (summaryHasViolations(summary)) process.exitCode = 1;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error) => {
    const code = error instanceof AuditOperationalError ? error.code : "audit_failed";
    process.stderr.write(`${JSON.stringify({ error: code })}\n`);
    process.exitCode = 2;
  });
}
