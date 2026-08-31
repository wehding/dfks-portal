#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
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
const DOWNLOAD_TIMEOUT_MS = 90_000;
const PDFTOTEXT_TIMEOUT_MS = 120_000;
const BASELINE_SCHEMA_VERSION = "dfks-ocr-backfill-baseline-v3";
const MAX_BASELINE_BYTES = 64 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export async function pdfPageCount(bytes) {
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
  }
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
  if (!hasExactKeys(page, ["pageNumber", "imageWidth", "imageHeight", "words"])
    || !Number.isInteger(page.pageNumber) || page.pageNumber < 1 || page.pageNumber > pageCount
    || !Number.isFinite(page.imageWidth) || page.imageWidth <= 0 || page.imageWidth > 100_000
    || !Number.isFinite(page.imageHeight) || page.imageHeight <= 0 || page.imageHeight > 100_000
    || !Array.isArray(page.words) || page.words.length > 1_000_000) return false;
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
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new AuditOperationalError("spatial_bbox_failed"));
      }, PDFTOTEXT_TIMEOUT_MS);
      child.stdout.on("data", (chunk) => {
        length += chunk.length;
        if (length > MAX_BBOX_BYTES) {
          child.kill("SIGKILL");
          finish(new AuditOperationalError("spatial_bbox_failed"));
          return;
        }
        chunks.push(chunk);
      });
      child.once("error", () => finish(new AuditOperationalError("spatial_bbox_failed")));
      child.once("close", (code) => {
        if (code !== 0) finish(new AuditOperationalError("spatial_bbox_failed"));
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
    const valid = hasExactKeys(geometry, [
      "schemaVersion", "engine", "redactionEngine", "redactionProfile", "redactions", "pages",
      "spatialVerification",
    ])
      && geometry.schemaVersion === "google-vision-spatial-v2"
      && geometry.engine === "google-vision-document-text-detection"
      && geometry.redactionEngine === "google-sensitive-data-protection-image-redact"
      && geometry.redactionProfile === "dfks-contract-redaction-v1"
      && job.spatial_schema_version === geometry.schemaVersion
      && Array.isArray(geometry.redactions) && geometry.redactions.length <= 200_000
      && geometry.redactions.every((redaction) => validRedaction(redaction, job.page_count))
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
  readStorage,
  extractBboxPages,
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

  const hasMetadata = job.ocr_applied === true
    && Number.isInteger(job.page_count) && job.page_count > 0
    && typeof job.original_sha256 === "string" && /^[0-9a-f]{64}$/.test(job.original_sha256)
    && typeof job.processed_sha256 === "string" && /^[0-9a-f]{64}$/.test(job.processed_sha256)
    && typeof job.spatial_sha256 === "string" && /^[0-9a-f]{64}$/.test(job.spatial_sha256)
    && job.spatial_schema_version === "google-vision-spatial-v2"
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
      if (original.invalidPdf) violations.invalidOriginalPdf += 1;
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
          if (!recomputed.passed || recomputed.matchCoverage < 0.95) {
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

  if (activeAiCount !== 1) {
    violations.activeAiJobCountMismatch += 1;
  }

  return violations;
}

export async function auditCompletedJobs({
  jobs,
  contractsById,
  activeAiCounts,
  baselineStatusByContract = new Map(),
  readStorage,
  concurrency = 1,
  extractBboxPages = extractPdfBboxPages,
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
    readStorage,
    extractBboxPages,
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

function baselineDigest({ schemaVersion, capturedAt, records }) {
  return sha256(Buffer.from(JSON.stringify({ schemaVersion, capturedAt, records }), "utf8"));
}

function assertValidBaseline(baseline) {
  if (!baseline || typeof baseline !== "object"
    || baseline.schemaVersion !== BASELINE_SCHEMA_VERSION
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
    if (!record || typeof record !== "object"
      || !UUID_PATTERN.test(record.jobId ?? "")
      || !UUID_PATTERN.test(record.contractId ?? "")
      || typeof record.originalSha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(record.originalSha256)
      || typeof record.originalStoragePathSha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(record.originalStoragePathSha256)
      || typeof record.originalPdfReadable !== "boolean"
      || (record.originalPdfReadable && (
        !Number.isInteger(record.originalPageCount)
        || record.originalPageCount < 1
        || record.originalPageCount > 10_000
      ))
      || (!record.originalPdfReadable && record.originalPageCount !== null)
      || typeof record.contractStatus !== "string"
      || record.contractStatus.length < 1
      || record.contractStatus.length > 80
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
    return {
      violations,
      record: {
        jobId: job.id,
        contractId: job.contract_id,
        originalSha256: fingerprint.sha256,
        originalStoragePathSha256: sha256(Buffer.from(job.original_storage_path, "utf8")),
        originalPdfReadable,
        originalPageCount: originalPdfReadable ? fingerprint.pageCount : null,
        contractStatus: contract.status,
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
      .select("id,org_id,contract_id,original_storage_path,output_storage_path,spatial_data_path,ocr_applied,page_count,original_sha256,processed_sha256,spatial_sha256,spatial_schema_version,completed_at")
      .eq("status", "completed")
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

async function loadDocumentJobsById(db, jobIds) {
  const result = new Map();
  for (const ids of chunks(jobIds, QUERY_CHUNK_SIZE)) {
    if (!ids.length) continue;
    const { data, error } = await db
      .from("contract_document_jobs")
      .select("id,contract_id,original_storage_path")
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
  const [contractsById, activeAiCounts, baselineJobsById, relevantAiJobs] = await Promise.all([
    loadContracts(db, contractIds),
    loadActiveAiCounts(db, jobs),
    baseline
      ? loadDocumentJobsById(db, baseline.records.map((record) => record.jobId))
      : Promise.resolve(new Map()),
    loadRelevantAiJobs(db, allDocumentContractIds, baseline?.capturedAt ?? null),
  ]);
  const baselineStatusByContract = new Map(
    baseline?.records.map((record) => [record.contractId, record.contractStatus]) ?? [],
  );

  const summary = await auditCompletedJobs({
    jobs,
    contractsById,
    activeAiCounts,
    baselineStatusByContract,
    readStorage: createStorageReader(db),
    concurrency,
  });
  summary.operational = summarizeOperationalState({
    documentJobs: allDocumentJobs,
    aiJobs: relevantAiJobs,
  });
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
    for (const [key, value] of Object.entries(baselineSummary.violations)) {
      summary.violations[key] += value;
    }
  }
  return summary;
}

export function safeSummaryJson(summary) {
  return JSON.stringify(summary, null, 2);
}

async function main() {
  loadEnv({ path: ".env.local", quiet: true });
  const mode = process.argv[2] ?? "audit";
  if (!["audit", "capture-baseline", "verify-baseline"].includes(mode)) {
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

  if (mode === "capture-baseline") {
    const baselinePath = process.env.OCR_BACKFILL_BASELINE_PATH;
    assertSecureBaselinePath(baselinePath);
    const { baseline, summary } = await captureDatabaseBaseline({ db, concurrency });
    if (!baseline || summaryHasViolations(summary)) {
      process.stdout.write(`${safeSummaryJson({ mode, ...summary })}\n`);
      process.exitCode = 1;
      return;
    }
    await writeBaselineFile(baselinePath, baseline);
    process.stdout.write(`${safeSummaryJson({ mode, ...summary })}\n`);
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
