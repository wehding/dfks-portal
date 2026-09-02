import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { GoogleOcrOperationalError } from "./google-vision-api.mjs";
import {
  createProcessor,
  FatalProcessingError,
  OCR_QUALITY_DIAGNOSTIC_CODES,
  parseProcessingDeadlineSeconds,
  readRuntimeConfig,
  runCommand,
  safeGoogleErrorCode,
  sanitiseAffectedPageNumbers,
  startLeaseHeartbeat,
} from "./processor.mjs";
import {
  processPdfSpatially,
  SPATIAL_VERIFICATION_PROFILE,
} from "./spatial-ocr.mjs";
import { createTailBlankProofManifest } from "./tail-blank-proof.mjs";

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
    leaseToken: "22222222-2222-4222-8222-222222222222",
    downloadUrl: "https://project.supabase.co/storage/v1/object/sign/kontrakter/original.pdf?token=signed-secret",
    uploadPath: "org/processed/job/normalised.pdf",
    spatialUploadPath: "org/processed/job/vision-layout.json.gz",
    sourceFormat: "pdf",
    maxBytes: config.maxBytes,
    ...overrides,
  };
}

test("berørte sidenumre sorteres, deduplikeres og afgrænses til dokumentet", () => {
  assert.deepEqual(sanitiseAffectedPageNumbers([3, 1, 3, 0, 5, "2", 2.5, 2], 3), [1, 2, 3]);
  assert.deepEqual(sanitiseAffectedPageNumbers([1], 0), []);
  assert.deepEqual(sanitiseAffectedPageNumbers("1", 3), []);
});

test("produktion kræver eksplicit RAM-disk til midlertidige kontraktfiler", () => {
  const env = {
    NODE_ENV: "production",
    PORTAL_BASE_URL: "https://portal.example",
    OCR_CLOUD_RUN_AUDIENCE: "https://portal.example/api/internal/document-processing",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "public-key",
    GOOGLE_CLOUD_PROJECT: "dfks-test",
  };
  assert.throws(() => readRuntimeConfig(env), (error) => (
    error instanceof FatalProcessingError
    && error.code === "invalid_temporary_storage_configuration"
  ));
  assert.equal(readRuntimeConfig({ ...env, OCR_TMP_DIR: "/mnt/ramdisk" }).tempRoot, "/mnt/ramdisk");
  assert.equal(readRuntimeConfig({
    ...env,
    OCR_TMP_DIR: "/mnt/ramdisk",
    OCR_REPLACEMENT_ONLY: "true",
  }).replacementOnly, true);
  assert.equal(readRuntimeConfig({
    ...env,
    OCR_TMP_DIR: "/mnt/ramdisk",
    OCR_GEOMETRY_BACKFILL_RUN_ID: "33333333-3333-4333-8333-333333333333",
  }).geometryBackfillRunId, "33333333-3333-4333-8333-333333333333");
  assert.throws(() => readRuntimeConfig({
    ...env,
    OCR_TMP_DIR: "/mnt/ramdisk",
    OCR_GEOMETRY_BACKFILL_RUN_ID: "not-a-run-id",
  }), (error) => (
    error instanceof FatalProcessingError
    && error.code === "invalid_geometry_backfill_configuration"
  ));
  assert.throws(() => readRuntimeConfig({
    ...env,
    OCR_TMP_DIR: "/mnt/ramdisk",
    OCR_REPLACEMENT_ONLY: "true",
    OCR_GEOMETRY_BACKFILL_RUN_ID: "33333333-3333-4333-8333-333333333333",
  }), (error) => (
    error instanceof FatalProcessingError
    && error.code === "conflicting_backfill_configuration"
  ));
  assert.throws(() => readRuntimeConfig({
    ...env,
    OCR_TMP_DIR: "/mnt/ramdisk",
    OCR_REPLACEMENT_ONLY: "TRUE",
  }), (error) => (
    error instanceof FatalProcessingError
    && error.code === "invalid_replacement_only_configuration"
  ));
  assert.equal(parseProcessingDeadlineSeconds(undefined), 780);
  assert.equal(parseProcessingDeadlineSeconds("0"), 0);
  assert.equal(parseProcessingDeadlineSeconds("900"), 900);
  for (const invalid of ["-1", "29", "43201", "1.5", "invalid"]) {
    assert.throws(() => parseProcessingDeadlineSeconds(invalid), (error) => (
      error instanceof FatalProcessingError && error.code === "invalid_processing_deadline"
    ));
  }
});

test("replacement-only worker markerer kun claim-kaldet eksplicit", async () => {
  let claimHeaders;
  const processor = createProcessor({
    config: { ...config, replacementOnly: true },
    identityTokenProvider: async () => "identity-secret",
    googleClient: {},
    fetchImpl: async (url, init) => {
      assert.ok(String(url).endsWith("/claim"));
      claimHeaders = init.headers;
      return response(null, { status: 204 });
    },
  });

  assert.deepEqual(await processor(), { outcome: "empty" });
  assert.equal(claimHeaders["X-DFKS-OCR-Replacement-Only"], "1");
  assert.equal(claimHeaders.Authorization, "Bearer identity-secret");
});

test("geometry-backfill worker afgrænser claim til det signerede run-id", async () => {
  let claimHeaders;
  const processor = createProcessor({
    config: {
      ...config,
      replacementOnly: false,
      geometryBackfillRunId: "33333333-3333-4333-8333-333333333333",
    },
    identityTokenProvider: async () => "identity-secret",
    googleClient: {},
    fetchImpl: async (url, init) => {
      assert.ok(String(url).endsWith("/claim"));
      claimHeaders = init.headers;
      return response(null, { status: 204 });
    },
  });

  assert.deepEqual(await processor(), { outcome: "empty" });
  assert.equal(
    claimHeaders["X-DFKS-OCR-Geometry-Backfill-Run"],
    "33333333-3333-4333-8333-333333333333",
  );
  assert.equal(claimHeaders["X-DFKS-OCR-Replacement-Only"], undefined);
  assert.equal(claimHeaders.Authorization, "Bearer identity-secret");
});

test("HTTP-service afviser et job-only blank-side-manifest før filen læses", () => {
  assert.throws(() => createProcessor({
    executionMode: "service",
    env: { OCR_TAIL_BLANK_PROOF_FILE: "/private/does-not-exist.json" },
    config: {
      ...config,
      geometryBackfillRunId: "33333333-3333-4333-8333-333333333333",
    },
    googleClient: {},
  }), (error) => error instanceof FatalProcessingError
    && error.code === "tail_blank_proof_forbidden");
});

test("backfill binder det private manifest til run og den verificerede original", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dfks-processor-tail-proof-"));
  const proofPath = join(directory, "proof.json");
  const runId = "33333333-3333-4333-8333-333333333333";
  const original = Buffer.from("%PDF-1.7\nproof-bound-original");
  const proof = createTailBlankProofManifest({
    runId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    entries: [{
      originalSha256: "1".repeat(64),
      pageNumber: 2,
      pageCount: 2,
      sourceRasterSha256: "2".repeat(64),
      recoveryRasterSha256: "3".repeat(64),
    }, ...[4, 5, 6, 7].map((digit, index) => ({
      originalSha256: String(digit).repeat(64),
      pageNumber: 3 + index,
      pageCount: 3 + index,
      sourceRasterSha256: String(digit + 1).repeat(64),
      recoveryRasterSha256: String(digit + 2).repeat(64),
    }))],
  });
  await writeFile(proofPath, JSON.stringify(proof), { mode: 0o400 });
  let spatialOptions;
  try {
    const processor = createProcessor({
      executionMode: "backfill",
      env: { OCR_TAIL_BLANK_PROOF_FILE: proofPath },
      config: { ...config, geometryBackfillRunId: runId, processingDeadlineMs: 0 },
      identityTokenProvider: async () => "identity-secret",
      googleClient: {},
      leaseHeartbeatFactory: async () => ({ assertHealthy() {}, async stop() {} }),
      spatialProcessor: async (options) => {
        spatialOptions = options;
        return {
          status: "needs_review",
          classification: "image_only",
          pageCount: 2,
          nativePageCount: 0,
          ocrPageCount: 2,
          unreadablePageCount: 1,
          affectedPageNumbers: [2],
        };
      },
      fetchImpl: async (url) => {
        const value = String(url);
        if (value.endsWith("/claim")) {
          return response(JSON.stringify(claimJob()), { status: 200 });
        }
        if (value.endsWith("/complete")) return response("{}", { status: 200 });
        return response(original, { status: 200 }, value);
      },
    });
    assert.deepEqual(await processor(), {
      outcome: "needs_review",
      diagnosticCode: OCR_QUALITY_DIAGNOSTIC_CODES.unreadablePage,
      reviewDetails: {
        schemaVersion: 1,
        reasons: [{ code: OCR_QUALITY_DIAGNOSTIC_CODES.unreadablePage, pageNumbers: [2] }],
      },
    });
    assert.equal(spatialOptions.geometryBackfillRunId, runId);
    assert.equal(spatialOptions.originalSha256.length, 64);
    assert.equal(spatialOptions.tailBlankProofManifest.manifestDigest, proof.manifestDigest);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("HTTP-processoren stopper kontrolleret før Cloud Run-requestens hårde timeout", async () => {
  const completions = [];
  let clockReads = 0;
  const processor = createProcessor({
    config: { ...config, processingDeadlineMs: 1 },
    now: () => (clockReads++ === 0 ? 0 : 2),
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { throw new Error("storage should not be reached"); } },
    spatialProcessor: async () => { throw new Error("spatial processor should not be reached"); },
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/heartbeat")) return response("{}", { status: 200 });
      if (value.endsWith("/complete")) {
        completions.push(JSON.parse(init.body));
        return response("{}", { status: 200 });
      }
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });

  assert.deepEqual(await processor(), { outcome: "needs_review" });
  assert.equal(completions.length, 1);
  assert.equal(completions[0].status, "needs_review");
  assert.equal(completions[0].errorCode, "processing_deadline_exceeded");
});

test("deadline afbryder et igangværende spatialt OCR-kald og completion bruger et nyt signal", async () => {
  const completions = [];
  let spatialSignal;
  const processor = createProcessor({
    // Leave enough time for the mocked claim/download to reach the spatial
    // processor even when the complete test suite runs concurrently on CI.
    config: { ...config, processingDeadlineMs: 500 },
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { throw new Error("storage should not be reached"); } },
    spatialProcessor: async ({ signal }) => {
      spatialSignal = signal;
      await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/heartbeat")) return response("{}", { status: 200 });
      if (value.endsWith("/complete")) {
        assert.equal(init.signal.aborted, false);
        completions.push(JSON.parse(init.body));
        return response("{}", { status: 200 });
      }
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });

  assert.deepEqual(await processor(), { outcome: "needs_review" });
  assert.equal(spatialSignal.aborted, true);
  assert.equal(spatialSignal.reason.code, "processing_deadline_exceeded");
  assert.equal(completions.length, 1);
  assert.equal(completions[0].errorCode, "processing_deadline_exceeded");
});

test("deadline afbryder et igangværende dokumentdownload", async () => {
  const completions = [];
  let downloadSignal;
  const processor = createProcessor({
    config: { ...config, processingDeadlineMs: 20 },
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { throw new Error("storage should not be reached"); } },
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/heartbeat")) return response("{}", { status: 200 });
      if (value.endsWith("/complete")) {
        completions.push(JSON.parse(init.body));
        return response("{}", { status: 200 });
      }
      downloadSignal = init.signal;
      return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    },
  });

  assert.deepEqual(await processor(), { outcome: "needs_review" });
  assert.equal(downloadSignal.aborted, true);
  assert.equal(completions[0].errorCode, "processing_deadline_exceeded");
});

test("subprocesser dræbes straks, når processeringssignalet afbrydes", async () => {
  const controller = new AbortController();
  const reason = Object.assign(new Error("processing_deadline_exceeded"), { code: "processing_deadline_exceeded" });
  const startedAt = Date.now();
  const command = runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], 10_000, {
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(reason), 20);

  await assert.rejects(command, (error) => error === reason);
  assert.equal(Date.now() - startedAt < 1_000, true);
});

test("et stort men afgrænset pdfimages-inventar bevarer både header og slutning", async () => {
  const header = "page num type width height color comp bpc enc interp object ID x-ppi y-ppi\n";
  const result = await runCommand(process.execPath, [
    "-e",
    `process.stdout.write(${JSON.stringify(header)} + "x".repeat(30_000) + "slut")`,
  ], 10_000, { stdoutMode: "full", maxStdoutBytes: 40_000 });

  assert.equal(result.stdout.startsWith(header), true);
  assert.equal(result.stdout.endsWith("slut"), true);
});

test("fuld subprocess-output afvises sikkert, når den overskrider sin særskilte grænse", async () => {
  await assert.rejects(
    () => runCommand(process.execPath, [
      "-e",
      "process.stdout.write('x'.repeat(30_000))",
    ], 10_000, { stdoutMode: "full", maxStdoutBytes: 20_000 }),
    (error) => error?.code === "document_processing_failed",
  );
});

test("spatial processor sender abortsignal til lokale subprocesser", async () => {
  const controller = new AbortController();
  const reason = new Error("processing_deadline_exceeded");
  let receivedSignal;
  const processing = processPdfSpatially({
    inputPath: "/tmp/input.pdf",
    outputPath: "/tmp/output.pdf",
    geometryPath: "/tmp/geometry.gz",
    workDir: "/tmp",
    googleClient: {},
    signal: controller.signal,
    commandRunner: async (_command, _args, _timeoutMs, { signal }) => {
      receivedSignal = signal;
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  });
  setTimeout(() => controller.abort(reason), 10);

  await assert.rejects(processing, (error) => error === reason);
  assert.equal(receivedSignal, controller.signal);
});

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
  assert.equal(completions[0].errorCode, "unsupported_document_format");
});

test("DOCX konverteres til PDF og tvinges gennem spatial OCR", async () => {
  const completions = [];
  let spatialInput;
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    commandRunner: async (command, args) => {
      assert.equal(command, "libreoffice");
      const outputDirectory = args[args.indexOf("--outdir") + 1];
      await writeFile(join(outputDirectory, "source.pdf"), Buffer.from("%PDF-1.7\nconverted"));
      return { stdout: "", stderr: "" };
    },
    spatialProcessor: async (options) => {
      spatialInput = options;
      return {
        status: "needs_review",
        classification: "mixed",
        pageCount: 1,
        nativePageCount: 0,
        ocrPageCount: 1,
        unreadablePageCount: 1,
        orientationCorrections: [],
        redactionCounts: {},
      };
    },
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob({ sourceFormat: "docx" })), { status: 200 });
      if (value.endsWith("/heartbeat")) return response("{}", { status: 200 });
      if (value.endsWith("/complete")) {
        completions.push(JSON.parse(init.body));
        return response("{}", { status: 200 });
      }
      return response(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]), { status: 200 }, value);
    },
  });

  assert.deepEqual(await processor(), { outcome: "needs_review", diagnosticCode: "ocr_unreadable_page" });
  assert.equal(spatialInput.forceOcr, true);
  assert.equal(spatialInput.inputPath.endsWith("source.pdf"), true);
  assert.equal(completions[0].status, "needs_review");
  assert.equal(completions[0].errorCode, "ocr_unreadable_page");
});

test("en vellykket Word-behandling gemmer neutral visnings-PDF separat fra OCR-PDF", async () => {
  const uploads = [];
  const completions = [];
  const job = claimJob({
    sourceFormat: "docx",
    originalViewUploadPath: "org/processed/job/original-view.pdf",
  });
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    commandRunner: async (command, args) => {
      assert.equal(command, "libreoffice");
      const outputDirectory = args[args.indexOf("--outdir") + 1];
      await writeFile(join(outputDirectory, "source.pdf"), Buffer.from("%PDF-1.7\nneutral-word-view"));
      return { stdout: "", stderr: "" };
    },
    spatialProcessor: async ({ outputPath, geometryPath, forceOcr }) => {
      assert.equal(forceOcr, true);
      await writeFile(outputPath, Buffer.from("%PDF-1.7\ncommented-working-copy"));
      await writeFile(geometryPath, Buffer.from("geometry"));
      return {
        status: "completed", classification: "mixed", pageCount: 1,
        nativePageCount: 0, ocrPageCount: 1, unreadablePageCount: 0,
        textCharCount: 120, redactionCounts: {},
      };
    },
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(job), { status: 200 });
      if (value.endsWith("/heartbeat")) return response("{}", { status: 200 });
      if (value.endsWith("/upload-authorisation")) return response(JSON.stringify({
        uploadToken: "processed-token",
        originalViewUploadToken: "original-view-token",
        spatialUploadToken: "spatial-token",
      }), { status: 200 });
      if (value.includes("/storage/v1/object/upload/sign/kontrakter/")) {
        uploads.push({ path: decodeURIComponent(new URL(value).pathname.split("/kontrakter/")[1]), bytes: Buffer.from(init.body).toString("utf8") });
        return response("{}", { status: 200 }, value);
      }
      if (value.endsWith("/complete")) {
        completions.push(JSON.parse(init.body));
        return response("{}", { status: 200 });
      }
      return response(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]), { status: 200 }, value);
    },
  });

  assert.deepEqual(await processor(), { outcome: "completed" });
  assert.equal(uploads.length, 3);
  assert.deepEqual(uploads.map(item => item.path), [job.uploadPath, job.originalViewUploadPath, job.spatialUploadPath]);
  assert.match(uploads[1].bytes, /neutral-word-view/);
  assert.match(completions[0].originalViewSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(completions[0].originalViewSha256, completions[0].processedSha256);
});

test("claim og dokument skal have samme filformat", async () => {
  const completions = [];
  let spatialCalled = false;
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { throw new Error("storage should not be reached"); } },
    spatialProcessor: async () => {
      spatialCalled = true;
      throw new Error("spatial processor should not be reached");
    },
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) {
        return response(JSON.stringify(claimJob({ sourceFormat: "docx" })), { status: 200 });
      }
      if (value.endsWith("/complete")) {
        completions.push(JSON.parse(init.body));
        return response("{}", { status: 200 });
      }
      return response(Buffer.from("%PDF-1.7\nnot-a-docx"), { status: 200 }, value);
    },
  });

  assert.deepEqual(await processor(), { outcome: "needs_review" });
  assert.equal(spatialCalled, false);
  assert.equal(completions.length, 1);
  assert.equal(completions[0].errorCode, "source_format_mismatch");
});

test("en genkørsel stopper før Vision, hvis originalens hash er ændret", async () => {
  const completions = [];
  let spatialCalls = 0;
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    spatialProcessor: async () => {
      spatialCalls += 1;
      throw new Error("spatial processor should not be reached");
    },
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob({
        expectedOriginalSha256: "0".repeat(64),
      })), { status: 200 });
      if (value.endsWith("/heartbeat")) return response("{}", { status: 200 });
      if (value.endsWith("/complete")) {
        completions.push(JSON.parse(init.body));
        return response("{}", { status: 200 });
      }
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });

  assert.deepEqual(await processor(), { outcome: "needs_review" });
  assert.equal(spatialCalls, 0);
  assert.equal(completions.length, 1);
  assert.equal(completions[0].status, "needs_review");
  assert.equal(completions[0].errorCode, "original_sha256_mismatch");
  assert.equal(completions[0].originalSha256, "0".repeat(64));
  assert.equal(JSON.stringify(completions[0]).includes("%PDF-"), false);
  assert.equal(JSON.stringify(completions[0]).includes("signed-secret"), false);
});

test("OCR-kvalitetsfejl propagerer en sikker diagnose til backfill-stopreglen", async () => {
  const completions = [];
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    spatialProcessor: async () => ({
      status: "needs_review",
      classification: "image_only",
      pageCount: 1,
      nativePageCount: 0,
      ocrPageCount: 1,
      unreadablePageCount: 1,
      textCharCount: 0,
      affectedPageNumbers: [1, 1, 0, 2, "1"],
    }),
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/heartbeat")) return response("{}", { status: 200 });
      if (value.endsWith("/complete")) {
        completions.push(JSON.parse(init.body));
        return response("{}", { status: 200 });
      }
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });

  assert.deepEqual(await processor(), {
    outcome: "needs_review",
    diagnosticCode: "ocr_unreadable_page",
    reviewDetails: {
      schemaVersion: 1,
      reasons: [{ code: "ocr_unreadable_page", pageNumbers: [1] }],
    },
  });
  assert.equal(completions[0].errorCode, "ocr_unreadable_page");
  assert.deepEqual(completions[0].reviewDetails, {
    schemaVersion: 1,
    reasons: [{ code: "ocr_unreadable_page", pageNumbers: [1] }],
  });
  assert.equal("affectedPageNumbers" in completions[0], false);
});

test("spatial needs_review sender kun sikre måltal, schema og kanoniske sidenumre", async () => {
  const completions = [];
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    spatialProcessor: async () => ({
      status: "needs_review",
      classification: "mixed",
      pageCount: 2,
      nativePageCount: 0,
      ocrPageCount: 2,
      unreadablePageCount: 0,
      textCharCount: 4704,
      processingProfile: "google-vision-direct-v1",
      spatialSchemaVersion: "google-vision-spatial-v3",
      spatialVerificationProfile: SPATIAL_VERIFICATION_PROFILE,
      spatial: { score: 0.94, medianIou: 0.88, centerInsideRatio: 0.97 },
      affectedPageNumbers: [2, 1, 2],
    }),
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/heartbeat")) return response("{}", { status: 200 });
      if (value.endsWith("/complete")) {
        completions.push(JSON.parse(init.body));
        return response("{}", { status: 200 });
      }
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });

  assert.equal((await processor()).diagnosticCode, "ocr_spatial_quality");
  assert.equal(completions[0].spatialAccuracyScore, 0.94);
  assert.equal(completions[0].spatialMedianIou, 0.88);
  assert.equal(completions[0].spatialCenterInsideRatio, 0.97);
  assert.equal(completions[0].spatialSchemaVersion, "google-vision-spatial-v3");
  assert.equal(completions[0].spatialVerificationProfile, SPATIAL_VERIFICATION_PROFILE);
  assert.deepEqual(completions[0].reviewDetails, {
    schemaVersion: 1,
    reasons: [{ code: "ocr_spatial_quality", pageNumbers: [1, 2] }],
  });
  for (const forbidden of ["geometry", "vertices", "storagePath", "spatialPath", "ocrText"]) {
    assert.equal(forbidden in completions[0], false);
  }
});

test("fysiske orienteringsrettelser sendes i completion-payload", async () => {
  const completions = [];
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    spatialProcessor: async () => ({
      status: "needs_review",
      classification: "image_only",
      pageCount: 3,
      nativePageCount: 0,
      ocrPageCount: 3,
      unreadablePageCount: 0,
      orientationCorrections: [{ page: 1, degrees: 270 }, { page: 3, degrees: 90 }],
      orientationQualityFailed: true,
      affectedPageNumbers: [3, 2, 3, 4],
    }),
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/heartbeat")) return response("{}", { status: 200 });
      if (value.endsWith("/complete")) {
        completions.push(JSON.parse(init.body));
        return response("{}", { status: 200 });
      }
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });

  assert.deepEqual(await processor(), {
    outcome: "needs_review",
    diagnosticCode: "orientation_uncertain",
    reviewDetails: {
      schemaVersion: 1,
      reasons: [{ code: "orientation_uncertain", pageNumbers: [2, 3] }],
    },
  });
  assert.deepEqual(completions[0].orientationCorrections, [
    { page: 1, degrees: 270 }, { page: 3, degrees: 90 },
  ]);
  assert.equal(completions[0].errorCode, "orientation_uncertain");
  assert.deepEqual(completions[0].reviewDetails, {
    schemaVersion: 1,
    reasons: [{ code: "orientation_uncertain", pageNumbers: [2, 3] }],
  });
  assert.equal("affectedPageNumbers" in completions[0], false);
  assert.equal(completions[0].documentClassification, "image_only");
});

test("en diagnose kan ikke bruges som dokumentklassifikation", async () => {
  let completionCalls = 0;
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    spatialProcessor: async () => ({
      status: "needs_review",
      classification: "orientation_uncertain",
      pageCount: 1,
      nativePageCount: 0,
      ocrPageCount: 1,
      unreadablePageCount: 0,
      orientationQualityFailed: true,
    }),
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/heartbeat")) return response("{}", { status: 200 });
      if (value.endsWith("/complete")) {
        completionCalls += 1;
        return response("{}", { status: 200 });
      }
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });

  await assert.rejects(processor, (error) => error instanceof FatalProcessingError
    && error.code === "invalid_document_classification");
  assert.equal(completionCalls, 0);
});

test("callbackfejl er fatal", async () => {
  let completionCalls = 0;
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { throw new Error("storage should not be reached"); } },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/complete")) {
        completionCalls += 1;
        return response("{}", { status: 503 });
      }
      return response("not-a-pdf", { status: 200 }, value);
    },
  });
  await assert.rejects(processor, (error) => error instanceof FatalProcessingError && error.code === "completion_callback_failed");
  assert.equal(completionCalls, 3);
});

test("midlertidig callbackfejl prøves igen uden at oprette et nyt claim", async () => {
  let claims = 0;
  let completionCalls = 0;
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { throw new Error("storage should not be reached"); } },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/claim")) {
        claims += 1;
        return response(JSON.stringify(claimJob()), { status: 200 });
      }
      if (value.endsWith("/complete")) {
        completionCalls += 1;
        return response("{}", { status: completionCalls === 1 ? 503 : 200 });
      }
      return response("not-a-pdf", { status: 200 }, value);
    },
  });
  assert.deepEqual(await processor(), { outcome: "needs_review" });
  assert.equal(claims, 1);
  assert.equal(completionCalls, 2);
});

test("midlertidig callback-netværksfejl prøves igen uden et nyt claim", async () => {
  let claims = 0;
  let completionCalls = 0;
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { throw new Error("storage should not be reached"); } },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/claim")) {
        claims += 1;
        return response(JSON.stringify(claimJob()), { status: 200 });
      }
      if (value.endsWith("/complete")) {
        completionCalls += 1;
        if (completionCalls === 1) throw new Error("temporary network failure");
        return response("{}", { status: 200 });
      }
      return response("not-a-pdf", { status: 200 }, value);
    },
  });
  assert.deepEqual(await processor(), { outcome: "needs_review" });
  assert.equal(claims, 1);
  assert.equal(completionCalls, 2);
});

test("permanent callback-netværksfejl stopper efter tre forsøg", async () => {
  let completionCalls = 0;
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { throw new Error("storage should not be reached"); } },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/complete")) {
        completionCalls += 1;
        throw new Error("persistent network failure");
      }
      return response("not-a-pdf", { status: 200 }, value);
    },
  });
  await assert.rejects(processor, (error) => error instanceof FatalProcessingError
    && error.code === "portal_request_failed");
  assert.equal(completionCalls, 3);
});

test("callbackens sikre konfliktkode bevares", async () => {
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { throw new Error("storage should not be reached"); } },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/complete")) {
        return response(JSON.stringify({ code: "completion_integrity_rejected" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      return response("not-a-pdf", { status: 200 }, value);
    },
  });
  await assert.rejects(processor, (error) => error instanceof FatalProcessingError
    && error.code === "completion_integrity_rejected");
});

test("lease-heartbeat valideres før dokumentdownload og stopper ved tabt lease", async () => {
  let renewals = 0;
  let identityTokens = 0;
  const heartbeat = await startLeaseHeartbeat({
    config,
    identityTokenProvider: async () => `identity-${++identityTokens}`,
    jobId: claimJob().jobId,
    leaseToken: claimJob().leaseToken,
    intervalMs: 1,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.jobId, claimJob().jobId);
      assert.equal(body.leaseToken, claimJob().leaseToken);
      renewals += 1;
      return response("{}", { status: renewals === 1 ? 200 : 409 });
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(identityTokens >= 2, true);
  assert.throws(() => heartbeat.assertHealthy(), (error) =>
    error instanceof FatalProcessingError && error.code === "document_lease_renewal_failed");
  await heartbeat.stop();
});

test("claim, heartbeat og completion henter hver sit kortlivede identitetstoken", async () => {
  let tokenSequence = 0;
  const portalAuthorizations = [];
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => `identity-${++tokenSequence}`,
    storage: { from() { throw new Error("storage should not be reached"); } },
    spatialProcessor: async () => ({
      status: "not_required", classification: "native_text", pageCount: 1,
      nativePageCount: 1, ocrPageCount: 0, unreadablePageCount: 0, textCharCount: 500,
    }),
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.startsWith(config.portalBaseUrl)) {
        portalAuthorizations.push({
          path: new URL(value).pathname,
          authorization: init.headers.Authorization,
        });
      }
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/heartbeat") || value.endsWith("/complete")) {
        return response("{}", { status: 200 });
      }
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });

  assert.deepEqual(await processor(), { outcome: "completed" });
  assert.deepEqual(portalAuthorizations, [
    { path: "/api/internal/document-processing/claim", authorization: "Bearer identity-1" },
    { path: "/api/internal/document-processing/heartbeat", authorization: "Bearer identity-2" },
    { path: "/api/internal/document-processing/complete", authorization: "Bearer identity-3" },
  ]);
});

test("fejl ved tokenfornyelse før completion er fatal og genbruger ikke claim-tokenet", async () => {
  let tokenCalls = 0;
  let completionCalled = false;
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => {
      tokenCalls += 1;
      if (tokenCalls === 3) throw new FatalProcessingError("identity_token_failed");
      return `identity-${tokenCalls}`;
    },
    storage: { from() { throw new Error("storage should not be reached"); } },
    spatialProcessor: async () => ({
      status: "not_required", classification: "native_text", pageCount: 1,
      nativePageCount: 1, ocrPageCount: 0, unreadablePageCount: 0, textCharCount: 500,
    }),
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/heartbeat")) return response("{}", { status: 200 });
      if (value.endsWith("/complete")) completionCalled = true;
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });

  await assert.rejects(
    processor,
    (error) => error instanceof FatalProcessingError && error.code === "identity_token_failed",
  );
  assert.equal(tokenCalls, 3);
  assert.equal(completionCalled, false);
});

test("afvist første heartbeat stopper før kontrakten downloades", async () => {
  let downloadCalled = false;
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { throw new Error("storage should not be reached"); } },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/heartbeat")) return response("{}", { status: 409 });
      downloadCalled = true;
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });
  await assert.rejects(processor, (error) =>
    error instanceof FatalProcessingError && error.code === "document_lease_renewal_failed");
  assert.equal(downloadCalled, false);
});

test("dokumentrelateret Google OCR-fejl registreres og batchen kan fortsætte", async () => {
  const completions = [];
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { throw new Error("storage should not be reached"); } },
    spatialProcessor: async () => { throw new GoogleOcrOperationalError("vision_page_too_large"); },
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/complete")) {
        completions.push(JSON.parse(init.body));
        return response("{}", { status: 200 });
      }
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });

  assert.deepEqual(await processor(), {
    outcome: "needs_review",
    diagnosticCode: "vision_page_too_large",
  });
  assert.equal(completions[0].jobId, claimJob().jobId);
  assert.equal(completions[0].leaseToken, claimJob().leaseToken);
  assert.equal(completions[0].status, "needs_review");
  assert.equal(completions[0].errorCode, "vision_page_too_large");
  assert.equal(completions[0].safeErrorMessage, "Dokumentet kunne ikke sikkerhedsbehandles automatisk og kræver manuel kontrol.");
  assert.match(completions[0].originalSha256, /^[0-9a-f]{64}$/);
});

test("Vision-geometri der ikke kan sikkerhedsverificeres sendes til manuel kontrol", async () => {
  const completions = [];
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { throw new Error("storage should not be reached"); } },
    spatialProcessor: async () => { throw new GoogleOcrOperationalError("vision_page_invalid"); },
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/complete")) {
        completions.push(JSON.parse(init.body));
        return response("{}", { status: 200 });
      }
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });
  assert.deepEqual(await processor(), {
    outcome: "needs_review",
    diagnosticCode: OCR_QUALITY_DIAGNOSTIC_CODES.visionPageInvalid,
  });
  assert.equal(completions[0].status, "needs_review");
  assert.equal(completions[0].errorCode, OCR_QUALITY_DIAGNOSTIC_CODES.visionPageInvalid);
});

test("Google IAM-fejl frigiver claim og stopper tasken", async () => {
  const completions = [];
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { throw new Error("storage should not be reached"); } },
    spatialProcessor: async () => { throw new GoogleOcrOperationalError("vision_api_403"); },
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/complete")) {
        completions.push(JSON.parse(init.body));
        return response("{}", { status: 200 });
      }
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });

  await assert.rejects(processor, (error) =>
    error instanceof FatalProcessingError && error.code === "vision_api_403");
  assert.equal(completions.length, 1);
  assert.equal(completions[0].status, "failed");
  assert.equal(completions[0].errorCode, "vision_api_403");
});

test("ugyldig Google-runtimekonfiguration stopper før claim med sikker kode", () => {
  assert.throws(() => createProcessor({
    config,
    env: { GOOGLE_VISION_LOCATION: "us" },
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { throw new Error("storage should not be reached"); } },
  }), (error) => error instanceof FatalProcessingError
    && error.code === "invalid_google_ocr_configuration");
});

test("callbackfejl efter Google-fejl er fatal", async () => {
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { throw new Error("storage should not be reached"); } },
    spatialProcessor: async () => { throw new GoogleOcrOperationalError("vision_page_invalid"); },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/complete")) return response("{}", { status: 503 });
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });

  await assert.rejects(processor, (error) =>
    error instanceof FatalProcessingError && error.code === "completion_callback_failed");
});

test("ukendt Google-fejlkode bliver sanitiseret", () => {
  assert.equal(safeGoogleErrorCode("CPR 010101-1234"), "google_ocr_service_failed");
  assert.equal(safeGoogleErrorCode("google_api_503"), "google_api_503");
  assert.equal(safeGoogleErrorCode("dlp_api_400"), "google_ocr_service_failed");
  assert.equal(safeGoogleErrorCode("vision_api_503"), "vision_api_503");
  assert.equal(safeGoogleErrorCode("dlp_location_missing"), "google_ocr_service_failed");
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
  const events = [];
  const originalPath = "org/contracts/original.pdf";
  const job = claimJob({ downloadUrl: `https://project.supabase.co/storage/v1/object/sign/kontrakter/${originalPath}?token=signed-secret` });
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    spatialProcessor: async ({ outputPath, geometryPath }) => {
      events.push("spatial-complete");
      await writeFile(outputPath, Buffer.from("%PDF-1.7\nprocessed"));
      await writeFile(geometryPath, Buffer.from("geometry"));
      return {
        status: "completed", classification: "image_only", pageCount: 2,
        nativePageCount: 0, ocrPageCount: 2, unreadablePageCount: 0,
        textCharCount: 300,
        spatial: { score: 0.99, medianIou: 0.9, centerInsideRatio: 1 },
        processingProfile: "google-vision-direct-v1",
        spatialSchemaVersion: "google-vision-spatial-v3",
        spatialVerificationProfile: SPATIAL_VERIFICATION_PROFILE,
      };
    },
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(job), { status: 200 });
      if (value.endsWith("/upload-authorisation")) {
        events.push("upload-authorisation");
        assert.deepEqual(JSON.parse(init.body), { jobId: job.jobId, leaseToken: job.leaseToken });
        return response(JSON.stringify({
          uploadToken: "fresh-upload-secret",
          spatialUploadToken: "fresh-spatial-secret",
        }), { status: 200 });
      }
      if (value.includes("/storage/v1/object/upload/sign/kontrakter/")) {
        const uploadUrl = new URL(value);
        uploads.push({
          path: decodeURIComponent(uploadUrl.pathname.split("/kontrakter/")[1]),
          token: uploadUrl.searchParams.get("token"),
          bytes: init.body.length,
        });
        assert.equal(init.method, "PUT");
        assert.equal(init.redirect, "error");
        assert.equal(init.signal.aborted, false);
        return response("{}", { status: 200 }, value);
      }
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
  assert.equal(uploads[0].token, "fresh-upload-secret");
  assert.notEqual(uploads[0].path, originalPath);
  assert.equal(uploads[1].path, job.spatialUploadPath);
  assert.equal(uploads[1].token, "fresh-spatial-secret");
  assert.deepEqual(events, ["spatial-complete", "upload-authorisation"]);
  assert.equal(completions[0].status, "completed");
  assert.equal(completions[0].pageCount, 2);
  assert.equal(completions[0].processingProfile, "google-vision-direct-v1");
  assert.equal(completions[0].spatialSchemaVersion, "google-vision-spatial-v3");
  assert.equal(completions[0].spatialVerificationProfile, SPATIAL_VERIFICATION_PROFILE);
  assert.match(completions[0].originalSha256, /^[0-9a-f]{64}$/);
  assert.match(completions[0].processedSha256, /^[0-9a-f]{64}$/);
  assert.match(completions[0].spatialSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(completions[0].processedSha256, completions[0].spatialSha256);
});

async function runOversizedDerivativeTest(artifact) {
  const completions = [];
  let uploadAuthorisationCalled = false;
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    spatialProcessor: async ({ outputPath, geometryPath }) => {
      await writeFile(outputPath, Buffer.from("%PDF-1.7\nprocessed"));
      await writeFile(geometryPath, Buffer.from("geometry"));
      await truncate(
        artifact === "pdf" ? outputPath : geometryPath,
        (25 * 1024 * 1024) + 1,
      );
      return {
        status: "completed", classification: "image_only", pageCount: 1,
        nativePageCount: 0, ocrPageCount: 1, unreadablePageCount: 0, textCharCount: 300,
      };
    },
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/heartbeat")) return response("{}", { status: 200 });
      if (value.endsWith("/upload-authorisation")) {
        uploadAuthorisationCalled = true;
        return response("{}", { status: 200 });
      }
      if (value.endsWith("/complete")) {
        completions.push(JSON.parse(init.body));
        return response("{}", { status: 200 });
      }
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });
  return { result: await processor(), completions, uploadAuthorisationCalled };
}

test("for stor behandlet PDF læses ikke i RAM og sendes til manuel kontrol", async () => {
  const result = await runOversizedDerivativeTest("pdf");
  assert.deepEqual(result.result, {
    outcome: "needs_review",
    diagnosticCode: OCR_QUALITY_DIAGNOSTIC_CODES.processedFileTooLarge,
  });
  assert.equal(result.completions[0].errorCode, "processed_file_too_large");
  assert.match(result.completions[0].originalSha256, /^[0-9a-f]{64}$/);
  assert.equal(result.uploadAuthorisationCalled, false);
});

test("for stor geometri læses ikke i RAM og sendes til manuel kontrol", async () => {
  const result = await runOversizedDerivativeTest("geometry");
  assert.deepEqual(result.result, {
    outcome: "needs_review",
    diagnosticCode: OCR_QUALITY_DIAGNOSTIC_CODES.spatialArtifactTooLarge,
  });
  assert.equal(result.completions[0].errorCode, "spatial_artifact_too_large");
  assert.equal(result.uploadAuthorisationCalled, false);
});

async function runHangingUploadTest(hangingArtifact) {
  const completions = [];
  const attemptedArtifacts = [];
  let abortedSignal;
  const job = claimJob();
  const processor = createProcessor({
    config,
    uploadTimeoutMs: 20,
    identityTokenProvider: async () => "identity-secret",
    spatialProcessor: async ({ outputPath, geometryPath }) => {
      await writeFile(outputPath, Buffer.from("%PDF-1.7\nprocessed"));
      await writeFile(geometryPath, Buffer.from("geometry"));
      return {
        status: "completed", classification: "image_only", pageCount: 1,
        nativePageCount: 0, ocrPageCount: 1, unreadablePageCount: 0, textCharCount: 300,
      };
    },
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(job), { status: 200 });
      if (value.endsWith("/heartbeat")) return response("{}", { status: 200 });
      if (value.endsWith("/upload-authorisation")) {
        return response(JSON.stringify({
          uploadToken: "fresh-upload-secret",
          spatialUploadToken: "fresh-spatial-secret",
        }), { status: 200 });
      }
      if (value.includes("/storage/v1/object/upload/sign/kontrakter/")) {
        const artifact = value.includes("vision-layout") ? "geometry" : "pdf";
        attemptedArtifacts.push(artifact);
        assert.equal(init.redirect, "error");
        if (artifact !== hangingArtifact) return response("{}", { status: 200 }, value);
        abortedSignal = init.signal;
        return new Promise((resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        });
      }
      if (value.endsWith("/complete")) {
        completions.push(JSON.parse(init.body));
        return response("{}", { status: 200 });
      }
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });

  return {
    result: await processor(),
    attemptedArtifacts,
    abortedSignal,
    completions,
  };
}

test("hængende PDF-upload afbrydes og registreres sikkert", async () => {
  const result = await runHangingUploadTest("pdf");
  assert.deepEqual(result.result, { outcome: "handled_failure" });
  assert.deepEqual(result.attemptedArtifacts, ["pdf"]);
  assert.equal(result.abortedSignal.aborted, true);
  assert.equal(result.completions.length, 1);
  assert.equal(result.completions[0].status, "failed");
  assert.equal(result.completions[0].errorCode, "upload_failed");
});

test("hængende geometriupload afbrydes uden at genstarte PDF-uploaden", async () => {
  const result = await runHangingUploadTest("geometry");
  assert.deepEqual(result.result, { outcome: "handled_failure" });
  assert.deepEqual(result.attemptedArtifacts, ["pdf", "geometry"]);
  assert.equal(result.abortedSignal.aborted, true);
  assert.equal(result.completions.length, 1);
  assert.equal(result.completions[0].status, "failed");
  assert.equal(result.completions[0].errorCode, "spatial_upload_failed");
});

test("ugyldig frisk uploadautorisation stopper uden at uploade derivater", async () => {
  let uploadCalled = false;
  let completionCalled = false;
  const processor = createProcessor({
    config,
    identityTokenProvider: async () => "identity-secret",
    storage: { from() { return { async uploadToSignedUrl() { uploadCalled = true; return { error: null }; } }; } },
    spatialProcessor: async ({ outputPath, geometryPath }) => {
      await writeFile(outputPath, Buffer.from("%PDF-1.7\nprocessed"));
      await writeFile(geometryPath, Buffer.from("geometry"));
      return {
        status: "completed", classification: "image_only", pageCount: 1,
        nativePageCount: 0, ocrPageCount: 1, unreadablePageCount: 0, textCharCount: 300,
      };
    },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/heartbeat")) return response("{}", { status: 200 });
      if (value.endsWith("/upload-authorisation")) {
        return response(JSON.stringify({ uploadToken: "", spatialUploadToken: "secret" }), { status: 200 });
      }
      if (value.endsWith("/complete")) {
        completionCalled = true;
        return response("{}", { status: 200 });
      }
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });

  await assert.rejects(processor, (error) => error instanceof FatalProcessingError
    && error.code === "invalid_upload_authorisation_response");
  assert.equal(uploadCalled, false);
  assert.equal(completionCalled, false);
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

test("replacement-only sender native kilder gennem den tvungne OCR-port", async () => {
  let forceOcr;
  const processor = createProcessor({
    config: { ...config, replacementOnly: true },
    identityTokenProvider: async () => "identity-secret",
    googleClient: {},
    spatialProcessor: async (options) => {
      forceOcr = options.forceOcr;
      return {
        status: "not_required", classification: "native_text", pageCount: 1,
        nativePageCount: 1, ocrPageCount: 0, unreadablePageCount: 0, textCharCount: 500,
      };
    },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/complete")) return response("{}", { status: 200 });
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });
  assert.deepEqual(await processor(), { outcome: "completed" });
  assert.equal(forceOcr, true);
});

test("geometry-backfill sender native kilder gennem den tvungne OCR-port", async () => {
  let forceOcr;
  const processor = createProcessor({
    config: {
      ...config,
      replacementOnly: false,
      geometryBackfillRunId: "33333333-3333-4333-8333-333333333333",
    },
    identityTokenProvider: async () => "identity-secret",
    googleClient: {},
    spatialProcessor: async (options) => {
      forceOcr = options.forceOcr;
      return {
        status: "not_required", classification: "native_text", pageCount: 1,
        nativePageCount: 1, ocrPageCount: 0, unreadablePageCount: 0, textCharCount: 500,
      };
    },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/claim")) return response(JSON.stringify(claimJob()), { status: 200 });
      if (value.endsWith("/complete")) return response("{}", { status: 200 });
      return response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 }, value);
    },
  });
  assert.deepEqual(await processor(), { outcome: "completed" });
  assert.equal(forceOcr, true);
});
