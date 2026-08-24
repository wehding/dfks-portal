import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { writeFile } from "node:fs/promises";
import test from "node:test";

import { createProcessor, FatalProcessingError } from "./processor.mjs";

const config = {
  portalBaseUrl: "https://portal.example",
  audience: "https://portal.example/api/internal/document-processing",
  supabaseUrl: "https://project.supabase.co",
  supabaseAnonKey: "public-key",
  supabaseOrigin: "https://project.supabase.co",
  googleProject: "dfks-test",
  googleLocation: "eu",
  tempRoot: tmpdir(),
  maxBytes: 25 * 1024 * 1024,
};

function response(body, init = {}, url = "https://portal.example") {
  const result = new Response(body, init);
  Object.defineProperty(result, "url", { value: url });
  return result;
}

function claimJob(overrides = {}) {
  return {
    jobId: "11111111-1111-4111-8111-111111111111",
    downloadUrl: "https://project.supabase.co/storage/v1/object/sign/kontrakter/original.pdf?token=signed-secret",
    uploadPath: "org/processed/job/normalised.pdf",
    uploadToken: "upload-secret",
    spatialUploadPath: "org/processed/job/vision-layout.json.gz",
    spatialUploadToken: "spatial-secret",
    maxBytes: config.maxBytes,
    ...overrides,
  };
}

test("en kontrolleret dokumentfejl registreres og batchen kan fortsætte", async () => {
  const completions = [];
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { throw new Error("storage should not be reached"); } },
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/complete")) {
        completions.push(JSON.parse(init.body));
        return response("{}", { status: 200 });
      }
      return response("not-a-pdf", { status: 200 }, value);
    },
  });
  assert.deepEqual(await processor(), { outcome: "needs_review" });
  assert.equal(completions[0].status, "needs_review");
  assert.equal(completions[0].errorCode, "invalid_pdf");
});

test("callbackfejl er fatal", async () => {
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { throw new Error("storage should not be reached"); } },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/complete")) return response("{}", { status: 503 });
      return response("not-a-pdf", { status: 200 }, value);
    },
  });
  await assert.rejects(processor, (error) => error instanceof FatalProcessingError && error.code === "completion_callback_failed");
});

test("fatal identitetsfejl stopper før claim", async () => {
  let fetched = false;
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => { throw new FatalProcessingError("identity_token_failed"); },
    storage: { from() { throw new Error("storage should not be reached"); } },
    fetchImpl: async () => { fetched = true; return response(null, { status: 204 }); },
  });
  await assert.rejects(processor, (error) => error instanceof FatalProcessingError && error.code === "identity_token_failed");
  assert.equal(fetched, false);
});

test("vellykket OCR uploader kun til jobbestemt derivat og afslutter completed", async () => {
  const uploads = [];
  const completions = [];
  const originalPath = "org/contracts/original.pdf";
  const job = claimJob({ downloadUrl: `https://project.supabase.co/storage/v1/object/sign/kontrakter/${originalPath}?token=signed-secret` });
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    storage: {
      from(bucket) {
        assert.equal(bucket, "kontrakter");
        return {
          async uploadToSignedUrl(path, token, bytes) {
            uploads.push({ path, token, bytes: bytes.length });
            return { error: null };
          },
        };
      },
    },
    spatialProcessor: async ({ outputPath, geometryPath }) => {
      await writeFile(outputPath, Buffer.from("%PDF-1.7\nprocessed"));
      await writeFile(geometryPath, Buffer.from("geometry"));
      return {
        status: "completed", classification: "image_only", pageCount: 2,
        nativePageCount: 0, ocrPageCount: 2, unreadablePageCount: 0,
        textCharCount: 300, redactionCounts: { DENMARK_CPR_NUMBER: 1 },
        spatial: { score: 0.99, medianIou: 0.9, centerInsideRatio: 1 },
      };
    },
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(job), { status: 200 });
      if (value.endsWith("/complete")) {
        completions.push(JSON.parse(init.body));
        return response("{}", { status: 200 });
      }
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });
  assert.deepEqual(await processor(), { outcome: "completed" });
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].path, job.uploadPath);
  assert.notEqual(uploads[0].path, originalPath);
  assert.equal(uploads[1].path, job.spatialUploadPath);
  assert.equal(completions[0].status, "completed");
  assert.equal(completions[0].pageCount, 2);
  assert.match(completions[0].originalSha256, /^[0-9a-f]{64}$/);
  assert.match(completions[0].processedSha256, /^[0-9a-f]{64}$/);
});

test("native tekst ændrer ikke originalen og uploader intet derivat", async () => {
  const uploads = [];
  const completions = [];
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { return { async uploadToSignedUrl(...args) { uploads.push(args); return { error: null }; } }; } },
    spatialProcessor: async () => ({
      status: "not_required", classification: "native_text", pageCount: 1,
      nativePageCount: 1, ocrPageCount: 0, unreadablePageCount: 0, textCharCount: 500,
    }),
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/complete")) { completions.push(JSON.parse(init.body)); return response("{}", { status: 200 }); }
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });
  assert.deepEqual(await processor(), { outcome: "completed" });
  assert.equal(uploads.length, 0);
  assert.equal(completions[0].status, "not_required");
  assert.equal(completions[0].ocrApplied, false);
});
