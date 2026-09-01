import { spawn } from "node:child_process";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createGoogleOcrClient,
  GoogleOcrOperationalError,
  readGoogleConfig,
} from "./google-vision-api.mjs";
import { MAX_SPATIAL_GZIP_BYTES } from "./resource-limits.mjs";
import { processPdfSpatially, sha256 } from "./spatial-ocr.mjs";

const REQUIRED_ENV = ["PORTAL_BASE_URL", "OCR_CLOUD_RUN_AUDIENCE", "SUPABASE_URL", "SUPABASE_ANON_KEY", "GOOGLE_CLOUD_PROJECT"];
const MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_PROCESSING_DEADLINE_SECONDS = 13 * 60;
const MAX_PROCESSING_DEADLINE_SECONDS = 12 * 60 * 60;
const DEFAULT_SIGNED_UPLOAD_TIMEOUT_MS = 60_000;
const MAX_SIGNED_UPLOAD_TIMEOUT_MS = 10 * 60_000;
export const OCR_QUALITY_DIAGNOSTIC_CODES = Object.freeze({
  unreadablePage: "ocr_unreadable_page",
  spatialQuality: "ocr_spatial_quality",
  orientationUncertain: "orientation_uncertain",
  pageGeometryUnavailable: "page_geometry_unavailable",
  visionPageInvalid: "vision_page_invalid",
  documentTextLimitExceeded: "document_text_limit_exceeded",
  processedFileTooLarge: "processed_file_too_large",
  spatialArtifactTooLarge: "spatial_artifact_too_large",
  visionResponseTooLarge: "vision_response_too_large",
  visionWordLimitExceeded: "vision_word_limit_exceeded",
});
const OCR_QUALITY_DIAGNOSTIC_CODE_SET = new Set(Object.values(OCR_QUALITY_DIAGNOSTIC_CODES));
const DOCUMENT_CLASSIFICATION_SET = new Set(["native_text", "image_only", "mixed", "unreadable"]);
const DOCUMENT_GOOGLE_ERROR_CODES = new Set([
  "document_page_limit_exceeded",
  "document_raster_budget_exceeded",
  OCR_QUALITY_DIAGNOSTIC_CODES.pageGeometryUnavailable,
  OCR_QUALITY_DIAGNOSTIC_CODES.visionPageInvalid,
  "vision_page_too_large",
  "vision_request_too_large",
  OCR_QUALITY_DIAGNOSTIC_CODES.documentTextLimitExceeded,
  OCR_QUALITY_DIAGNOSTIC_CODES.spatialArtifactTooLarge,
  OCR_QUALITY_DIAGNOSTIC_CODES.visionResponseTooLarge,
  OCR_QUALITY_DIAGNOSTIC_CODES.visionWordLimitExceeded,
]);
const SAFE_GOOGLE_ERROR_CODES = new Set([
  ...DOCUMENT_GOOGLE_ERROR_CODES,
  "google_access_token_failed",
  "google_endpoint_rejected",
  "google_request_failed",
  "google_request_timeout",
  "google_response_invalid",
  "google_tls_version_rejected",
  "invalid_google_ocr_configuration",
]);

export class FatalProcessingError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "FatalProcessingError";
    this.code = code;
  }
}

function requireDocumentClassification(value) {
  if (!DOCUMENT_CLASSIFICATION_SET.has(value)) {
    throw new FatalProcessingError("invalid_document_classification");
  }
  return value;
}

export function sanitiseAffectedPageNumbers(value, pageCount) {
  const maximum = Number.isSafeInteger(pageCount) && pageCount >= 1
    ? Math.min(pageCount, 200)
    : 0;
  if (!Array.isArray(value) || maximum === 0) return [];
  return [...new Set(value.filter((entry) => (
    Number.isSafeInteger(entry) && entry >= 1 && entry <= maximum
  )))].sort((left, right) => left - right);
}

export function buildReviewDetails(code, pageNumbers, pageCount) {
  const safePages = sanitiseAffectedPageNumbers(pageNumbers, pageCount);
  if (!OCR_QUALITY_DIAGNOSTIC_CODE_SET.has(code) || safePages.length === 0) return null;
  return {
    schemaVersion: 1,
    reasons: [{ code, pageNumbers: safePages }],
  };
}

export function parseProcessingDeadlineSeconds(value) {
  if (value == null || value === "") return DEFAULT_PROCESSING_DEADLINE_SECONDS;
  if (value === "0") return 0;
  if (!/^\d+$/.test(value)) throw new FatalProcessingError("invalid_processing_deadline");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 30 || parsed > MAX_PROCESSING_DEADLINE_SECONDS) {
    throw new FatalProcessingError("invalid_processing_deadline");
  }
  return parsed;
}

class DocumentProcessingError extends Error {
  constructor(code, status = "failed", safeMessage = "PDF'en kunne ikke normaliseres eller OCR-behandles.") {
    super(code);
    this.name = "DocumentProcessingError";
    this.code = code;
    this.status = status;
    this.safeMessage = safeMessage;
  }
}

async function readLocalArtifactWithinLimit(path, maxBytes, errorCode, safeMessage) {
  let handle;
  try {
    handle = await open(path, "r");
    const fileInfo = await handle.stat();
    if (!fileInfo.isFile() || fileInfo.size < 1) {
      throw new DocumentProcessingError("document_processing_failed");
    }
    if (fileInfo.size > maxBytes) {
      throw new DocumentProcessingError(errorCode, "needs_review", safeMessage);
    }
    const bytes = Buffer.allocUnsafe(fileInfo.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const overflowProbe = Buffer.allocUnsafe(1);
    const { bytesRead: overflowBytes } = await handle.read(overflowProbe, 0, 1, offset);
    if (overflowBytes > 0) {
      throw new DocumentProcessingError(errorCode, "needs_review", safeMessage);
    }
    if (offset !== bytes.length) throw new DocumentProcessingError("document_processing_failed");
    return bytes;
  } catch (error) {
    if (error instanceof DocumentProcessingError) throw error;
    throw new DocumentProcessingError("document_processing_failed");
  } finally {
    await handle?.close();
  }
}

export function readRuntimeConfig(env = process.env) {
  for (const key of REQUIRED_ENV) {
    if (!env[key]) throw new FatalProcessingError("missing_configuration");
  }
  let portalBaseUrl;
  let supabaseOrigin;
  try {
    portalBaseUrl = new URL(env.PORTAL_BASE_URL).origin;
    supabaseOrigin = new URL(env.SUPABASE_URL).origin;
  } catch {
    throw new FatalProcessingError("invalid_configuration");
  }
  if (!portalBaseUrl.startsWith("https://") || !supabaseOrigin.startsWith("https://")) {
    throw new FatalProcessingError("invalid_configuration");
  }
  const tempRoot = env.OCR_TMP_DIR || tmpdir();
  if (env.NODE_ENV === "production" && tempRoot !== "/mnt/ramdisk") {
    throw new FatalProcessingError("invalid_temporary_storage_configuration");
  }
  return {
    portalBaseUrl,
    audience: env.OCR_CLOUD_RUN_AUDIENCE,
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    supabaseOrigin,
    googleProject: env.GOOGLE_CLOUD_PROJECT,
    tempRoot,
    maxBytes: MAX_BYTES,
    processingDeadlineMs: parseProcessingDeadlineSeconds(env.OCR_PROCESSING_DEADLINE_SECONDS) * 1000,
  };
}

export async function fetchIdentityToken(audience, fetchImpl = fetch) {
  const response = await fetchImpl(
    `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`,
    {
      headers: { "Metadata-Flavor": "Google" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new FatalProcessingError("identity_token_failed");
  const token = await response.text();
  if (!token) throw new FatalProcessingError("identity_token_failed");
  return token;
}

async function readPortalIdentityToken(identityTokenProvider) {
  let token;
  try {
    token = await identityTokenProvider();
  } catch (error) {
    if (error instanceof FatalProcessingError) throw error;
    throw new FatalProcessingError("identity_token_failed", { cause: error });
  }
  if (typeof token !== "string" || !token || token.length > 16_384 || /\s/.test(token)) {
    throw new FatalProcessingError("identity_token_failed");
  }
  return token;
}

async function portalRequest(config, identityTokenProvider, path, init, fetchImpl) {
  // Cloud Run identity tokens are deliberately fetched for every privileged
  // portal operation. A claim can run for many minutes; reusing its token for
  // lease renewal or completion can make an otherwise valid job fail after
  // the short-lived token expires.
  const token = await readPortalIdentityToken(identityTokenProvider);
  let response;
  try {
    response = await fetchImpl(new URL(path, config.portalBaseUrl), {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new FatalProcessingError("portal_request_failed", { cause: error });
  }
  return response;
}

function processingDeadlineError() {
  return new DocumentProcessingError(
    "processing_deadline_exceeded",
    "needs_review",
    "Dokumentet kunne ikke færdigbehandles inden for den sikre tidsgrænse og kræver manuel kontrol.",
  );
}

function abortedProcessingError(signal) {
  return signal?.reason instanceof Error ? signal.reason : processingDeadlineError();
}

function signedUploadTimeoutMs(value) {
  const parsed = value ?? DEFAULT_SIGNED_UPLOAD_TIMEOUT_MS;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_SIGNED_UPLOAD_TIMEOUT_MS) {
    throw new FatalProcessingError("invalid_signed_upload_timeout");
  }
  return parsed;
}

function encodeStoragePath(path) {
  if (typeof path !== "string" || !path || path.length > 2_048 || /[\u0000-\u001f\u007f]/.test(path)) {
    throw new FatalProcessingError("invalid_claim_response");
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new FatalProcessingError("invalid_claim_response");
  }
  return segments.map(encodeURIComponent).join("/");
}

async function uploadSignedArtifact({
  config,
  fetchImpl,
  path,
  token,
  bytes,
  contentType,
  signal,
  timeoutMs,
  errorCode,
}) {
  const uploadUrl = new URL(
    `/storage/v1/object/upload/sign/kontrakter/${encodeStoragePath(path)}`,
    config.supabaseUrl,
  );
  uploadUrl.searchParams.set("token", token);
  // AbortSignal.timeout() deliberately uses an unref'ed timer in Node. A
  // stalled fetch implementation can therefore leave an awaited Promise with
  // no referenced event-loop handle, which prevents the timeout from firing.
  // Keep this explicit timer referenced until the upload settles so the
  // timeout is deterministic for both the native fetch and test transports.
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  const uploadSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;
  let response;
  try {
    response = await fetchImpl(uploadUrl, {
      method: "PUT",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${config.supabaseAnonKey}`,
        "cache-control": "max-age=3600",
        "content-type": contentType,
        "x-upsert": "false",
      },
      body: bytes,
      redirect: "error",
      signal: uploadSignal,
    });
  } catch {
    if (signal?.aborted) throw abortedProcessingError(signal);
    throw new DocumentProcessingError(errorCode);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new DocumentProcessingError(errorCode);
}

const DEFAULT_COMMAND_OUTPUT_BYTES = 20_000;
const MAX_BOUNDED_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;

function boundedCommandOutputLimit(value) {
  if (value == null) return DEFAULT_COMMAND_OUTPUT_BYTES;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_BOUNDED_COMMAND_OUTPUT_BYTES) {
    throw new DocumentProcessingError("document_processing_failed");
  }
  return value;
}

export async function runCommand(command, args, timeoutMs = 12 * 60_000, {
  signal,
  stdoutMode = "tail",
  maxStdoutBytes,
} = {}) {
  if (!["tail", "full"].includes(stdoutMode)) {
    throw new DocumentProcessingError("document_processing_failed");
  }
  const stdoutLimit = boundedCommandOutputLimit(maxStdoutBytes);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedProcessingError(signal));
      return;
    }
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(reject, abortedProcessingError(signal));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(reject, new DocumentProcessingError("document_processing_failed"));
    }, timeoutMs);
    timer.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => {
      const value = chunk.toString();
      if (stdoutMode === "tail") {
        stdout = (stdout + value).slice(-stdoutLimit);
        return;
      }
      if (Buffer.byteLength(stdout) + chunk.length > stdoutLimit) {
        child.kill("SIGKILL");
        finish(reject, new DocumentProcessingError("document_processing_failed"));
        return;
      }
      stdout += value;
    });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-DEFAULT_COMMAND_OUTPUT_BYTES); });
    child.once("error", () => finish(reject, signal?.aborted
      ? abortedProcessingError(signal)
      : new DocumentProcessingError("document_processing_failed")));
    child.once("close", (code) => {
      if (code === 0) finish(resolve, { stdout, stderr });
      else finish(reject, signal?.aborted
        ? abortedProcessingError(signal)
        : new DocumentProcessingError("document_processing_failed"));
    });
  });
}

async function readResponseWithLimit(response, byteLimit, signal) {
  if (!response.body) throw new DocumentProcessingError("download_failed");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    if (signal?.aborted) throw abortedProcessingError(signal);
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > byteLimit) {
      await reader.cancel();
      throw new DocumentProcessingError("file_too_large", "needs_review", "PDF-filen overskrider den tilladte størrelse.");
    }
    chunks.push(Buffer.from(value));
  }
  if (signal?.aborted) throw abortedProcessingError(signal);
  return Buffer.concat(chunks, total);
}

function validateClaim(job) {
  if (!job || typeof job !== "object" || typeof job.jobId !== "string"
    || typeof job.leaseToken !== "string"
    || typeof job.downloadUrl !== "string" || typeof job.uploadPath !== "string"
    || typeof job.spatialUploadPath !== "string"
    || (job.expectedOriginalSha256 != null
      && (typeof job.expectedOriginalSha256 !== "string"
        || !/^[0-9a-f]{64}$/.test(job.expectedOriginalSha256)))) {
    throw new FatalProcessingError("invalid_claim_response");
  }
  return job;
}

function validateUploadAuthorisation(value) {
  if (!value || typeof value !== "object"
    || typeof value.uploadToken !== "string" || !value.uploadToken
    || typeof value.spatialUploadToken !== "string" || !value.spatialUploadToken
    || value.uploadToken.length > 16_384 || value.spatialUploadToken.length > 16_384
    || /\s/.test(value.uploadToken) || /\s/.test(value.spatialUploadToken)) {
    throw new FatalProcessingError("invalid_upload_authorisation_response");
  }
  return value;
}

async function requestUploadAuthorisation(config, identityTokenProvider, job, fetchImpl) {
  const response = await portalRequest(
    config,
    identityTokenProvider,
    "/api/internal/document-processing/upload-authorisation",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.jobId, leaseToken: job.leaseToken }),
    },
    fetchImpl,
  );
  if (!response.ok) throw new FatalProcessingError("upload_authorisation_failed");
  try {
    return validateUploadAuthorisation(await response.json());
  } catch (error) {
    if (error instanceof FatalProcessingError) throw error;
    throw new FatalProcessingError("invalid_upload_authorisation_response", { cause: error });
  }
}

async function sendCompletion(config, identityTokenProvider, body, fetchImpl, {
  assertHealthy = () => {},
} = {}) {
  const safeFailureCodes = new Set([
    "completion_generation_conflict",
    "completion_integrity_rejected",
    "completion_lease_inactive",
    "completion_persistence_failed",
  ]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assertHealthy();
    let response;
    try {
      response = await portalRequest(config, identityTokenProvider, "/api/internal/document-processing/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }, fetchImpl);
    } catch (error) {
      if (error instanceof FatalProcessingError
        && error.code === "portal_request_failed" && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        assertHealthy();
        continue;
      }
      throw error;
    }
    if (response.ok) return;
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      assertHealthy();
      continue;
    }
    if (response.status === 409) {
      try {
        const result = await response.json();
        if (safeFailureCodes.has(result?.code)) {
          throw new FatalProcessingError(result.code);
        }
      } catch (error) {
        if (error instanceof FatalProcessingError) throw error;
      }
    }
    throw new FatalProcessingError("completion_callback_failed");
  }
}

export async function startLeaseHeartbeat({
  config,
  identityTokenProvider,
  jobId,
  leaseToken,
  fetchImpl,
  intervalMs = 4 * 60_000,
}) {
  let stopped = false;
  let timer;
  let activeRenewal = null;
  let failure = null;

  const renew = async () => {
    const response = await portalRequest(config, identityTokenProvider, "/api/internal/document-processing/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, leaseToken }),
    }, fetchImpl);
    if (!response.ok) throw new FatalProcessingError("document_lease_renewal_failed");
  };
  // Verify the lease token and endpoint before any contract bytes are fetched.
  await renew();

  const schedule = () => {
    if (stopped || failure) return;
    timer = setTimeout(() => {
      activeRenewal = renew()
        .catch((error) => {
          failure = error instanceof FatalProcessingError
            ? error : new FatalProcessingError("document_lease_renewal_failed", { cause: error });
        })
        .finally(() => {
          activeRenewal = null;
          schedule();
        });
    }, intervalMs);
    timer.unref?.();
  };
  schedule();

  return {
    assertHealthy() {
      if (failure) throw failure;
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (activeRenewal) await activeRenewal;
    },
  };
}

function safeDocumentError(error) {
  if (error instanceof DocumentProcessingError) return error;
  return new DocumentProcessingError("document_processing_failed");
}

export function safeGoogleErrorCode(value) {
  if (SAFE_GOOGLE_ERROR_CODES.has(value) || /^(?:google|vision)_api_[1-5][0-9]{2}$/.test(value)) {
    return value;
  }
  return "google_ocr_service_failed";
}

function isDocumentGoogleError(value) {
  return DOCUMENT_GOOGLE_ERROR_CODES.has(value);
}

export function createProcessor(options = {}) {
  const env = options.env ?? process.env;
  const config = options.config ?? readRuntimeConfig(env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const commandRunner = options.commandRunner ?? runCommand;
  const identityTokenProvider = options.identityTokenProvider
    ?? (() => fetchIdentityToken(config.audience, fetchImpl));
  const uploadTimeoutMs = signedUploadTimeoutMs(options.uploadTimeoutMs);
  let googleClient = options.googleClient;
  if (!googleClient) {
    try {
      googleClient = createGoogleOcrClient({
        config: readGoogleConfig({ ...env, GOOGLE_CLOUD_PROJECT: config.googleProject }),
      });
    } catch (error) {
      if (error instanceof GoogleOcrOperationalError) {
        throw new FatalProcessingError(safeGoogleErrorCode(error.code), { cause: error });
      }
      throw error;
    }
  }
  const spatialProcessor = options.spatialProcessor ?? processPdfSpatially;
  const leaseHeartbeatFactory = options.leaseHeartbeatFactory ?? startLeaseHeartbeat;
  const now = options.now ?? Date.now;

  return async function processOne() {
    const claim = await portalRequest(
      config,
      identityTokenProvider,
      "/api/internal/document-processing/claim",
      { method: "POST" },
      fetchImpl,
    );
    if (claim.status === 204) return { outcome: "empty" };
    if (!claim.ok) throw new FatalProcessingError("claim_failed");
    const job = validateClaim(await claim.json());
    const processingDeadlineAt = config.processingDeadlineMs > 0
      ? now() + config.processingDeadlineMs
      : null;
    const processingAbortController = processingDeadlineAt == null ? null : new AbortController();
    const processingDeadlineTimer = processingAbortController == null ? null : setTimeout(() => {
      processingAbortController.abort(processingDeadlineError());
    }, Math.max(0, processingDeadlineAt - now()));
    const processingSignal = processingAbortController?.signal;
    let workDir;
    let heartbeat;
    // Preserve a previously verified source hash across every terminal
    // callback. Once this run has downloaded and verified the immutable
    // original, replace it with the freshly calculated value.
    let originalSha256 = job.expectedOriginalSha256 ?? null;
    const completionOptions = {
      assertHealthy: () => heartbeat?.assertHealthy(),
    };
    try {
      heartbeat = await leaseHeartbeatFactory({
        config, identityTokenProvider, jobId: job.jobId, leaseToken: job.leaseToken, fetchImpl,
      });
      const assertProcessingHealthy = () => {
        heartbeat.assertHealthy();
        if (processingDeadlineAt != null && now() >= processingDeadlineAt) {
          if (!processingSignal.aborted) processingAbortController.abort(processingDeadlineError());
          throw abortedProcessingError(processingSignal);
        }
        if (processingSignal?.aborted) throw abortedProcessingError(processingSignal);
      };
      workDir = await mkdtemp(join(config.tempRoot, "dfks-ocr-"));
      const inputPath = join(workDir, "input.pdf");
      const outputPath = join(workDir, "output.pdf");
      const geometryPath = join(workDir, "vision-layout.json.gz");
      let downloadUrl;
      try {
        downloadUrl = new URL(job.downloadUrl);
      } catch {
        throw new DocumentProcessingError("invalid_download_origin", "needs_review", "Den midlertidige filadresse kom ikke fra den forventede lagerkonto.");
      }
      if (downloadUrl.origin !== config.supabaseOrigin) {
        throw new DocumentProcessingError("invalid_download_origin", "needs_review", "Den midlertidige filadresse kom ikke fra den forventede lagerkonto.");
      }
      let source;
      try {
        source = await fetchImpl(downloadUrl, {
          signal: processingSignal
            ? AbortSignal.any([processingSignal, AbortSignal.timeout(60_000)])
            : AbortSignal.timeout(60_000),
          redirect: "error",
        });
      } catch {
        if (processingSignal?.aborted) throw abortedProcessingError(processingSignal);
        throw new DocumentProcessingError("download_failed");
      }
      if (!source.ok || new URL(source.url).origin !== config.supabaseOrigin) {
        throw new DocumentProcessingError("download_failed");
      }
      const byteLimit = Math.min(Number(job.maxBytes) || config.maxBytes, config.maxBytes);
      const contentLength = Number(source.headers.get("content-length") || 0);
      if (contentLength > byteLimit) {
        throw new DocumentProcessingError("file_too_large", "needs_review", "PDF-filen overskrider den tilladte størrelse.");
      }
      const input = await readResponseWithLimit(source, byteLimit, processingSignal);
      assertProcessingHealthy();
      if (input.length < 5 || input.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new DocumentProcessingError("invalid_pdf", "needs_review", "Filen er ikke en gyldig PDF.");
      }
      const downloadedOriginalSha256 = sha256(input);
      if (job.expectedOriginalSha256 != null
        && downloadedOriginalSha256 !== job.expectedOriginalSha256) {
        throw new DocumentProcessingError(
          "original_sha256_mismatch",
          "needs_review",
          "Originalfilens integritetskontrol stemte ikke. Dokumentet blev ikke sendt til OCR.",
        );
      }
      originalSha256 = downloadedOriginalSha256;
      await writeFile(inputPath, input, { mode: 0o600 });
      const result = await spatialProcessor({
        inputPath, outputPath, geometryPath, workDir, commandRunner, googleClient,
        assertLeaseHealthy: assertProcessingHealthy,
        signal: processingSignal,
      });
      assertProcessingHealthy();
      const completion = {
        jobId: job.jobId,
        leaseToken: job.leaseToken,
        documentClassification: requireDocumentClassification(result.classification),
        ocrEngine: result.status === "not_required" ? null : "google-vision-eu-v1",
        orientationCorrections: result.orientationCorrections ?? [],
        ocrApplied: result.status === "completed",
        pageCount: result.pageCount,
        textCharCount: result.textCharCount ?? null,
        nativePageCount: result.nativePageCount,
        ocrPageCount: result.ocrPageCount,
        unreadablePageCount: result.unreadablePageCount,
        processingProfile: result.processingProfile ?? null,
        spatialSchemaVersion: result.spatialSchemaVersion ?? null,
        spatialAccuracyScore: result.spatial?.score ?? null,
        spatialMedianIou: result.spatial?.medianIou ?? null,
        spatialCenterInsideRatio: result.spatial?.centerInsideRatio ?? null,
        originalSha256,
      };
      const affectedPageNumbers = sanitiseAffectedPageNumbers(
        result.affectedPageNumbers,
        result.pageCount,
      );
      if (result.status === "not_required") {
        await sendCompletion(config, identityTokenProvider, { ...completion, status: "not_required" }, fetchImpl, completionOptions);
        return { outcome: "completed" };
      }
      if (result.status === "needs_review") {
        const diagnosticCode = result.orientationQualityFailed === true
          ? OCR_QUALITY_DIAGNOSTIC_CODES.orientationUncertain
          : result.unreadablePageCount > 0
            ? OCR_QUALITY_DIAGNOSTIC_CODES.unreadablePage
            : OCR_QUALITY_DIAGNOSTIC_CODES.spatialQuality;
        const reviewDetails = buildReviewDetails(
          diagnosticCode,
          affectedPageNumbers,
          result.pageCount,
        );
        await sendCompletion(config, identityTokenProvider, {
          ...completion,
          status: "needs_review",
          errorCode: diagnosticCode,
          ...(reviewDetails ? { reviewDetails } : {}),
          safeErrorMessage: result.orientationQualityFailed === true
            ? "Mindst én sides orientering kunne ikke bestemmes sikkert. Kontrollér scanningens retning."
            : result.unreadablePageCount > 0
              ? "Mindst én side gav ikke læsbar tekst. Kontrollér scanningens kvalitet."
              : "Tekstlagets placering bestod ikke den geometriske kvalitetskontrol.",
        }, fetchImpl, completionOptions);
        return {
          outcome: "needs_review",
          diagnosticCode,
          ...(reviewDetails ? { reviewDetails } : {}),
        };
      }

      const output = await readLocalArtifactWithinLimit(
        outputPath,
        config.maxBytes,
        OCR_QUALITY_DIAGNOSTIC_CODES.processedFileTooLarge,
        "PDF-filen overskrider den tilladte størrelse efter behandling.",
      );
      const geometry = await readLocalArtifactWithinLimit(
        geometryPath,
        MAX_SPATIAL_GZIP_BYTES,
        OCR_QUALITY_DIAGNOSTIC_CODES.spatialArtifactTooLarge,
        "Dokumentets geometridata overskrider den sikre størrelsesgrænse.",
      );
      assertProcessingHealthy();
      // Signed upload tokens are deliberately minted immediately before use.
      // Long backfill jobs must not depend on tokens issued hours earlier at
      // claim time, and the endpoint also proves that this lease is still the
      // active owner of the immutable derivative paths.
      const uploadAuthorisation = await requestUploadAuthorisation(
        config, identityTokenProvider, job, fetchImpl,
      );
      assertProcessingHealthy();
      await uploadSignedArtifact({
        config,
        fetchImpl,
        path: job.uploadPath,
        token: uploadAuthorisation.uploadToken,
        bytes: output,
        contentType: "application/pdf",
        signal: processingSignal,
        timeoutMs: uploadTimeoutMs,
        errorCode: "upload_failed",
      });
      assertProcessingHealthy();
      await uploadSignedArtifact({
        config,
        fetchImpl,
        path: job.spatialUploadPath,
        token: uploadAuthorisation.spatialUploadToken,
        bytes: geometry,
        contentType: "application/gzip",
        signal: processingSignal,
        timeoutMs: uploadTimeoutMs,
        errorCode: "spatial_upload_failed",
      });
      assertProcessingHealthy();
      await sendCompletion(config, identityTokenProvider, {
        ...completion,
        status: "completed",
        processedSha256: sha256(output),
        spatialSha256: sha256(geometry),
      }, fetchImpl, completionOptions);
      return { outcome: "completed" };
    } catch (error) {
      const processingError = processingSignal?.aborted && !(error instanceof FatalProcessingError)
        ? abortedProcessingError(processingSignal)
        : error;
      if (processingError instanceof FatalProcessingError) throw processingError;
      heartbeat?.assertHealthy();
      if (processingError instanceof GoogleOcrOperationalError) {
        const errorCode = safeGoogleErrorCode(processingError.code);
        // Google failures happen after a job has been claimed. Always complete
        // the claim first so it is never left locked in `processing`. Only
        // explicitly classified document-quality failures may let a batch
        // continue; IAM, identity, endpoint and service failures stop the task.
        const documentError = isDocumentGoogleError(errorCode);
        await sendCompletion(config, identityTokenProvider, {
          jobId: job.jobId,
          leaseToken: job.leaseToken,
          originalSha256,
          status: documentError ? "needs_review" : "failed",
          errorCode,
          safeErrorMessage: documentError
            ? "Dokumentet kunne ikke sikkerhedsbehandles automatisk og kræver manuel kontrol."
            : "Google OCR-tjenesten kunne ikke behandle dokumentet. Fejlen er registreret.",
        }, fetchImpl, completionOptions);
        if (!documentError) {
          throw new FatalProcessingError(errorCode, { cause: processingError });
        }
        return { outcome: "needs_review", diagnosticCode: errorCode };
      }
      const documentError = safeDocumentError(processingError);
      await sendCompletion(config, identityTokenProvider, {
        jobId: job.jobId,
        leaseToken: job.leaseToken,
        originalSha256,
        status: documentError.status,
        errorCode: documentError.code,
        safeErrorMessage: documentError.safeMessage,
      }, fetchImpl, completionOptions);
      return {
        outcome: documentError.status === "needs_review" ? "needs_review" : "handled_failure",
        ...(documentError.status === "needs_review"
          && OCR_QUALITY_DIAGNOSTIC_CODE_SET.has(documentError.code)
          ? { diagnosticCode: documentError.code } : {}),
      };
    } finally {
      if (processingDeadlineTimer) clearTimeout(processingDeadlineTimer);
      await heartbeat?.stop();
      if (workDir) await rm(workDir, { recursive: true, force: true });
    }
  };
}

let defaultProcessor;
export async function processOne() {
  defaultProcessor ??= createProcessor();
  return defaultProcessor();
}
