import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { createGoogleOcrClient, GoogleOcrOperationalError } from "./google-secure-api.mjs";
import { processPdfSpatially, sha256 } from "./spatial-ocr.mjs";

const REQUIRED_ENV = ["PORTAL_BASE_URL", "OCR_CLOUD_RUN_AUDIENCE", "SUPABASE_URL", "SUPABASE_ANON_KEY", "GOOGLE_CLOUD_PROJECT"];
const MAX_BYTES = 25 * 1024 * 1024;
const DOCUMENT_GOOGLE_ERROR_CODES = new Set([
  "dlp_location_missing",
  "dlp_redacted_image_invalid",
  "dlp_redacted_image_missing",
  "dlp_redaction_not_applied",
  "dlp_too_many_locations",
  "vision_page_too_large",
  "vision_request_too_large",
  "vision_response_invalid",
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

class DocumentProcessingError extends Error {
  constructor(code, status = "failed", safeMessage = "PDF'en kunne ikke normaliseres eller OCR-behandles.") {
    super(code);
    this.name = "DocumentProcessingError";
    this.code = code;
    this.status = status;
    this.safeMessage = safeMessage;
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

async function portalRequest(config, token, path, init, fetchImpl) {
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

async function runCommand(command, args, timeoutMs = 12 * 60_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString()).slice(-20_000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-20_000); });
    child.once("error", () => reject(new DocumentProcessingError("document_processing_failed")));
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new DocumentProcessingError("document_processing_failed"));
    });
  });
}

async function readResponseWithLimit(response, byteLimit) {
  if (!response.body) throw new DocumentProcessingError("download_failed");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > byteLimit) {
      await reader.cancel();
      throw new DocumentProcessingError("file_too_large", "needs_review", "PDF-filen overskrider den tilladte størrelse.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function validateClaim(job) {
  if (!job || typeof job !== "object" || typeof job.jobId !== "string"
    || typeof job.downloadUrl !== "string" || typeof job.uploadPath !== "string"
    || typeof job.uploadToken !== "string" || typeof job.spatialUploadPath !== "string"
    || typeof job.spatialUploadToken !== "string") {
    throw new FatalProcessingError("invalid_claim_response");
  }
  return job;
}

async function sendCompletion(config, token, body, fetchImpl) {
  const response = await portalRequest(config, token, "/api/internal/document-processing/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, fetchImpl);
  if (!response.ok) throw new FatalProcessingError("completion_callback_failed");
}

function safeDocumentError(error) {
  if (error instanceof DocumentProcessingError) return error;
  return new DocumentProcessingError("document_processing_failed");
}

export function safeGoogleErrorCode(value) {
  if (SAFE_GOOGLE_ERROR_CODES.has(value) || /^google_api_[1-5][0-9]{2}$/.test(value)) {
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
  const storage = options.storage ?? createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).storage;
  const googleClient = options.googleClient ?? createGoogleOcrClient({ config: {
    projectId: config.googleProject,
    visionLocation: "eu",
    dlpLocation: "eu",
    visionEndpoint: "https://eu-vision.googleapis.com",
    dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
  } });
  const spatialProcessor = options.spatialProcessor ?? processPdfSpatially;

  return async function processOne() {
    const token = await identityTokenProvider();
    const claim = await portalRequest(config, token, "/api/internal/document-processing/claim", { method: "POST" }, fetchImpl);
    if (claim.status === 204) return { outcome: "empty" };
    if (!claim.ok) throw new FatalProcessingError("claim_failed");
    const job = validateClaim(await claim.json());
    let workDir;
    try {
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
      const source = await fetchImpl(downloadUrl, {
        signal: AbortSignal.timeout(60_000),
        redirect: "error",
      });
      if (!source.ok || new URL(source.url).origin !== config.supabaseOrigin) {
        throw new DocumentProcessingError("download_failed");
      }
      const byteLimit = Math.min(Number(job.maxBytes) || config.maxBytes, config.maxBytes);
      const contentLength = Number(source.headers.get("content-length") || 0);
      if (contentLength > byteLimit) {
        throw new DocumentProcessingError("file_too_large", "needs_review", "PDF-filen overskrider den tilladte størrelse.");
      }
      const input = await readResponseWithLimit(source, byteLimit);
      if (input.length < 5 || input.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new DocumentProcessingError("invalid_pdf", "needs_review", "Filen er ikke en gyldig PDF.");
      }
      await writeFile(inputPath, input, { mode: 0o600 });
      const originalSha256 = sha256(input);
      const result = await spatialProcessor({
        inputPath, outputPath, geometryPath, workDir, commandRunner, googleClient,
      });
      const completion = {
        jobId: job.jobId,
        documentClassification: result.classification,
        ocrEngine: result.status === "not_required" ? null : "google-vision-eu-v1",
        orientationCorrections: [],
        ocrApplied: result.status === "completed",
        pageCount: result.pageCount,
        textCharCount: result.textCharCount ?? null,
        nativePageCount: result.nativePageCount,
        ocrPageCount: result.ocrPageCount,
        unreadablePageCount: result.unreadablePageCount,
        redactionCounts: result.redactionCounts ?? {},
        redactionProfile: result.redactionProfile ?? null,
        spatialSchemaVersion: result.spatialSchemaVersion ?? null,
        spatialAccuracyScore: result.spatial?.score ?? null,
        spatialMedianIou: result.spatial?.medianIou ?? null,
        spatialCenterInsideRatio: result.spatial?.centerInsideRatio ?? null,
        originalSha256,
      };
      if (result.status === "not_required") {
        await sendCompletion(config, token, { ...completion, status: "not_required" }, fetchImpl);
        return { outcome: "completed" };
      }
      if (result.status === "needs_review") {
        await sendCompletion(config, token, {
          ...completion,
          status: "needs_review",
          errorCode: result.unreadablePageCount > 0 ? "ocr_unreadable_page" : "ocr_spatial_quality",
          safeErrorMessage: result.unreadablePageCount > 0
            ? "Mindst én side gav ikke læsbar tekst. Kontrollér scanningens kvalitet."
            : "Tekstlagets placering bestod ikke den geometriske kvalitetskontrol.",
        }, fetchImpl);
        return { outcome: "needs_review" };
      }

      const output = await readFile(outputPath);
      const geometry = await readFile(geometryPath);
      if (output.length > config.maxBytes * 2) {
        throw new DocumentProcessingError("processed_file_too_large", "needs_review", "PDF-filen overskrider den tilladte størrelse efter behandling.");
      }
      const { error: uploadError } = await storage.from("kontrakter")
        .uploadToSignedUrl(job.uploadPath, job.uploadToken, output, { contentType: "application/pdf" });
      if (uploadError) throw new DocumentProcessingError("upload_failed");
      const { error: spatialUploadError } = await storage.from("kontrakter")
        .uploadToSignedUrl(job.spatialUploadPath, job.spatialUploadToken, geometry, { contentType: "application/gzip" });
      if (spatialUploadError) throw new DocumentProcessingError("spatial_upload_failed");
      await sendCompletion(config, token, {
        ...completion, status: "completed", processedSha256: sha256(output),
      }, fetchImpl);
      return { outcome: "completed" };
    } catch (error) {
      if (error instanceof FatalProcessingError) throw error;
      if (error instanceof GoogleOcrOperationalError) {
        const errorCode = safeGoogleErrorCode(error.code);
        // Google failures happen after a job has been claimed. Always complete
        // the claim first so it is never left locked in `processing`. Only
        // explicitly classified document-quality failures may let a batch
        // continue; IAM, identity, endpoint and service failures stop the task.
        await sendCompletion(config, token, {
          jobId: job.jobId,
          status: "failed",
          errorCode,
          safeErrorMessage: "Google OCR-tjenesten kunne ikke behandle dokumentet. Fejlen er registreret.",
        }, fetchImpl);
        if (!isDocumentGoogleError(errorCode)) {
          throw new FatalProcessingError(errorCode, { cause: error });
        }
        return { outcome: "handled_failure", diagnosticCode: errorCode };
      }
      const documentError = safeDocumentError(error);
      await sendCompletion(config, token, {
        jobId: job.jobId,
        status: documentError.status,
        errorCode: documentError.code,
        safeErrorMessage: documentError.safeMessage,
      }, fetchImpl);
      return {
        outcome: documentError.status === "needs_review" ? "needs_review" : "handled_failure",
      };
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true });
    }
  };
}

let defaultProcessor;
export async function processOne() {
  defaultProcessor ??= createProcessor();
  return defaultProcessor();
}
