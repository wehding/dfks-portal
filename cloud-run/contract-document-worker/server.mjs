import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const required = ["PORTAL_BASE_URL", "OCR_CLOUD_RUN_AUDIENCE", "SUPABASE_URL", "SUPABASE_ANON_KEY"];
for (const key of required) if (!process.env[key]) throw new Error(`Missing ${key}`);
const portalBaseUrl = new URL(process.env.PORTAL_BASE_URL).origin;
const maxBytes = 25 * 1024 * 1024;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function identityToken() {
  const audience = encodeURIComponent(process.env.OCR_CLOUD_RUN_AUDIENCE);
  const response = await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${audience}&format=full`, {
    headers: { "Metadata-Flavor": "Google" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("identity_token_failed");
  return response.text();
}

async function portal(path, token, init = {}) {
  return fetch(new URL(path, portalBaseUrl), {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
}

async function run(command, args, timeoutMs = 12 * 60_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", chunk => { stdout = (stdout + chunk.toString()).slice(-20_000); });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-20_000); });
    child.once("error", reject);
    child.once("close", code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error("document_processing_failed"), { safeDetails: stderr }));
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

async function complete(token, body) {
  const response = await portal("/api/internal/document-processing/complete", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("completion_callback_failed");
}

async function processOne() {
  const token = await identityToken();
  const claim = await portal("/api/internal/document-processing/claim", token, { method: "POST" });
  if (claim.status === 204) return { processed: false };
  if (!claim.ok) throw new Error("claim_failed");
  const job = await claim.json();
  let workDir;
  try {
    workDir = await mkdtemp(join(tmpdir(), "dfks-ocr-"));
    const inputPath = join(workDir, "input.pdf");
    const outputPath = join(workDir, "output.pdf");
    const sidecarPath = join(workDir, "ocr.txt");
    const source = await fetch(job.downloadUrl, { signal: AbortSignal.timeout(60_000) });
    if (!source.ok) throw new Error("download_failed");
    const contentLength = Number(source.headers.get("content-length") || 0);
    if (contentLength > Math.min(job.maxBytes || maxBytes, maxBytes)) throw new Error("file_too_large");
    const input = Buffer.from(await source.arrayBuffer());
    if (input.length > maxBytes || input.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("invalid_pdf");
    await import("node:fs/promises").then(fs => fs.writeFile(inputPath, input, { mode: 0o600 }));

    const ocrResult = await run("ocrmypdf", [
      "--rotate-pages", "--rotate-pages-threshold", "2.5", "--deskew", "--clean-final", "--skip-text",
      "--language", "dan+eng", "--output-type", "pdfa-2",
      "--sidecar", sidecarPath, inputPath, outputPath,
    ]);
    const output = await readFile(outputPath);
    if (output.length > maxBytes * 2) throw new Error("processed_file_too_large");
    const { error: uploadError } = await supabase.storage.from("kontrakter")
      .uploadToSignedUrl(job.uploadPath, job.uploadToken, output, { contentType: "application/pdf" });
    if (uploadError) throw new Error("upload_failed");

    const info = await run("pdfinfo", [outputPath], 30_000);
    const pageCount = Number(info.stdout.match(/Pages:\s+(\d+)/i)?.[1] || 0) || null;
    await run("pdftotext", [outputPath, join(workDir, "text.txt")], 60_000);
    const extractedText = await readFile(join(workDir, "text.txt"), "utf8").catch(() => "");
    const sidecar = await readFile(sidecarPath, "utf8").catch(() => "");
    await complete(token, {
      jobId: job.jobId,
      status: "completed",
      orientationCorrections: orientationCorrections(ocrResult.stderr),
      ocrApplied: sidecar.trim().length > 0,
      pageCount,
      textCharCount: extractedText.trim().length,
    });
    return { processed: true, jobId: job.jobId, pageCount };
  } catch (error) {
    const code = ["file_too_large", "invalid_pdf", "processed_file_too_large"].includes(error?.message)
      ? error.message : "document_processing_failed";
    const needsReview = code !== "document_processing_failed";
    try {
      await complete(token, {
        jobId: job.jobId,
        status: needsReview ? "needs_review" : "failed",
        errorCode: code,
        safeErrorMessage: code === "invalid_pdf"
          ? "Filen er ikke en gyldig PDF."
          : code === "file_too_large" || code === "processed_file_too_large"
            ? "PDF-filen overskrider den tilladte størrelse."
            : "PDF'en kunne ikke normaliseres eller OCR-behandles.",
      });
    } catch { /* Lease expiry/retry is handled by the database. */ }
    throw error;
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  }
}

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    response.end("ok");
    return;
  }
  if (request.method !== "POST" || request.url !== "/run") {
    response.writeHead(404).end();
    return;
  }
  try {
    const result = await processOne();
    response.writeHead(result.processed ? 200 : 204, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(result.processed ? JSON.stringify(result) : undefined);
  } catch (error) {
    console.error(JSON.stringify({ event: "document_job_failed", code: error?.message || "unknown" }));
    response.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ error: "processing_failed" }));
  }
}).listen(Number(process.env.PORT || 8080));
