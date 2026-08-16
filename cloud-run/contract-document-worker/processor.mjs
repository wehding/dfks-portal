import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

const REQUIRED_ENV = ["PORTAL_BASE_URL", "OCR_CLOUD_RUN_AUDIENCE", "SUPABASE_URL", "SUPABASE_ANON_KEY"];
const MAX_BYTES = 25 * 1024 * 1024;
const MIN_READABLE_TEXT_CHARS = 120;

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
  return {
    portalBaseUrl,
    audience: env.OCR_CLOUD_RUN_AUDIENCE,
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    supabaseOrigin,
    maxBytes: MAX_BYTES,
    minReadableTextChars: MIN_READABLE_TEXT_CHARS,
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

function orientationCorrections(stderr) {
  const corrections = [];
  const pattern = /page\s+(\d+).*?(?:rotate|rotation).*?(90|180|270)/gi;
  for (const match of stderr.matchAll(pattern)) {
    corrections.push({ page: Number(match[1]), degrees: Number(match[2]) });
    if (corrections.length >= 500) break;
  }
  return corrections;
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
    || typeof job.uploadToken !== "string") {
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

  return async function processOne() {
    const token = await identityTokenProvider();
    const claim = await portalRequest(config, token, "/api/internal/document-processing/claim", { method: "POST" }, fetchImpl);
    if (claim.status === 204) return { outcome: "empty" };
    if (!claim.ok) throw new FatalProcessingError("claim_failed");
    const job = validateClaim(await claim.json());
    let workDir;
    try {
      workDir = await mkdtemp(join(tmpdir(), "dfks-ocr-"));
      const inputPath = join(workDir, "input.pdf");
      const outputPath = join(workDir, "output.pdf");
      const sidecarPath = join(workDir, "ocr.txt");
      const textPath = join(workDir, "text.txt");
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

      const ocrResult = await commandRunner("ocrmypdf", [
        "--rotate-pages", "--rotate-pages-threshold", "2.5", "--deskew", "--clean-final", "--skip-text",
        "--language", "dan+eng", "--output-type", "pdfa-2", "--sidecar", sidecarPath, inputPath, outputPath,
      ]);
      const output = await readFile(outputPath);
      if (output.length > config.maxBytes * 2) {
        throw new DocumentProcessingError("processed_file_too_large", "needs_review", "PDF-filen overskrider den tilladte størrelse efter behandling.");
      }
      const { error: uploadError } = await storage.from("kontrakter")
        .uploadToSignedUrl(job.uploadPath, job.uploadToken, output, { contentType: "application/pdf" });
      if (uploadError) throw new DocumentProcessingError("upload_failed");

      const info = await commandRunner("pdfinfo", [outputPath], 30_000);
      const pageCount = Number(info.stdout.match(/Pages:\s+(\d+)/i)?.[1] || 0) || null;
      await commandRunner("pdftotext", [outputPath, textPath], 60_000);
      const extractedText = await readFile(textPath, "utf8").catch(() => "");
      const sidecar = await readFile(sidecarPath, "utf8").catch(() => "");
      const textCharCount = extractedText.replace(/\s/g, "").length;
      const completion = {
        jobId: job.jobId,
        orientationCorrections: orientationCorrections(ocrResult.stderr),
        ocrApplied: sidecar.trim().length > 0,
        pageCount,
        textCharCount,
      };
      if (textCharCount < config.minReadableTextChars) {
        await sendCompletion(config, token, {
          ...completion,
          status: "needs_review",
          errorCode: "ocr_no_readable_text",
          safeErrorMessage: "OCR-behandlingen fandt ikke nok læsbar tekst. Kontrollér scanningens kvalitet.",
        }, fetchImpl);
        return { outcome: "needs_review" };
      }
      await sendCompletion(config, token, { ...completion, status: "completed" }, fetchImpl);
      return { outcome: "completed" };
    } catch (error) {
      if (error instanceof FatalProcessingError) throw error;
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
