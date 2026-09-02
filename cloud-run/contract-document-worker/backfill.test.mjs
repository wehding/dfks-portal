import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  main,
  parseDocumentLimit,
  parseFailureThreshold,
  parseQualityConsecutiveThreshold,
  parseQualityFailureRatePercent,
  parseQualityRateWindow,
  runBackfill,
} from "./backfill.mjs";
import {
  createProcessor,
  FatalProcessingError,
  OCR_QUALITY_DIAGNOSTIC_CODES,
} from "./processor.mjs";

test("tom kø afslutter med nul behandlinger", async () => {
  const result = await runBackfill({ processOneFn: async () => ({ outcome: "empty" }), log() {} });
  assert.deepEqual(result, { processed: 0, completed: 0, needsReview: 0, failed: 0 });
});

test("dokumentgrænsen overholdes", async () => {
  let claims = 0;
  const result = await runBackfill({
    maxDocuments: 4,
    processOneFn: async () => { claims += 1; return { outcome: "completed" }; },
    log() {},
  });
  assert.equal(claims, 4);
  assert.equal(result.completed, 4);
});

test("tre parallelle workers får forskellige atomisk claimede jobs", async () => {
  const queue = ["job-1", "job-2", "job-3"];
  const claimed = [];
  const atomicClaim = async () => {
    const id = queue.shift();
    await new Promise((resolve) => setImmediate(resolve));
    if (!id) return { outcome: "empty" };
    claimed.push(id);
    return { outcome: "completed" };
  };
  await Promise.all(Array.from({ length: 3 }, () => runBackfill({
    maxDocuments: 1,
    processOneFn: atomicClaim,
    log() {},
  })));
  assert.deepEqual(new Set(claimed), new Set(["job-1", "job-2", "job-3"]));
});

test("kontrollerede dokumentfejl stopper ikke batchen", async () => {
  const outcomes = ["handled_failure", "needs_review", "completed", "empty"];
  const result = await runBackfill({
    processOneFn: async () => ({ outcome: outcomes.shift() }),
    log() {},
  });
  assert.deepEqual(result, { processed: 3, completed: 1, needsReview: 1, failed: 1 });
});

test("fem sammenhængende driftsfejl stopper backfill-tasken", async () => {
  let calls = 0;
  await assert.rejects(() => runBackfill({
    processOneFn: async () => { calls += 1; return { outcome: "handled_failure" }; },
    log() {},
  }), (error) => error instanceof FatalProcessingError
    && error.code === "backfill_failure_threshold");
  assert.equal(calls, 5);
});

test("pilot stopper ved første driftsfejl med tærskel en", async () => {
  let calls = 0;
  await assert.rejects(() => runBackfill({
    maxDocuments: 4,
    failureThreshold: 1,
    processOneFn: async () => { calls += 1; return { outcome: "handled_failure" }; },
    log() {},
  }), (error) => error instanceof FatalProcessingError
    && error.code === "backfill_failure_threshold");
  assert.equal(calls, 1);
});

test("et isoleret OCR-kvalitetsproblem stopper ikke fuld backfill", async () => {
  const outcomes = [
    { outcome: "needs_review", diagnosticCode: "ocr_unreadable_page" },
    { outcome: "completed" },
    { outcome: "empty" },
  ];
  const result = await runBackfill({
    processOneFn: async () => outcomes.shift(),
    log() {},
  });
  assert.deepEqual(result, { processed: 2, completed: 1, needsReview: 1, failed: 0 });
});

test("pilot med højst fire dokumenter stopper ved første OCR-kvalitetsproblem", async () => {
  let calls = 0;
  await assert.rejects(() => runBackfill({
    maxDocuments: 4,
    processOneFn: async () => {
      calls += 1;
      return { outcome: "needs_review", diagnosticCode: "ocr_spatial_quality" };
    },
    log() {},
  }), (error) => error instanceof FatalProcessingError
    && error.code === "backfill_quality_consecutive_threshold");
  assert.equal(calls, 1);
});

test("rigtig processOne-orienteringsfejl stopper pilotens runBackfill", async () => {
  const completions = [];
  const processor = createProcessor({
    config: {
      portalBaseUrl: "https://portal.example",
      audience: "https://portal.example/api/internal/document-processing",
      supabaseUrl: "https://project.supabase.co",
      supabaseAnonKey: "public-key",
      supabaseOrigin: "https://project.supabase.co",
      googleProject: "dfks-test",
      tempRoot: tmpdir(),
      maxBytes: 25 * 1024 * 1024,
      processingDeadlineMs: 0,
    },
    identityTokenProvider: async () => "identity-secret",
    leaseHeartbeatFactory: async () => ({ assertHealthy() {}, async stop() {} }),
    spatialProcessor: async () => ({
      status: "needs_review",
      classification: "image_only",
      pageCount: 1,
      nativePageCount: 0,
      ocrPageCount: 1,
      unreadablePageCount: 0,
      orientationQualityFailed: true,
    }),
    fetchImpl: async (url, init) => {
      const value = String(url);
      if (value.endsWith("/claim")) return new Response(JSON.stringify({
        jobId: "11111111-1111-4111-8111-111111111111",
        leaseToken: "22222222-2222-4222-8222-222222222222",
        downloadUrl: "https://project.supabase.co/original.pdf",
        uploadPath: "org/processed/job/normalised.pdf",
        spatialUploadPath: "org/processed/job/vision-layout.json.gz",
        sourceFormat: "pdf",
      }), { status: 200 });
      if (value.endsWith("/complete")) {
        completions.push(JSON.parse(init.body));
        return new Response("{}", { status: 200 });
      }
      const download = new Response(Buffer.from("%PDF-1.7\noriginal"), { status: 200 });
      Object.defineProperty(download, "url", { value });
      return download;
    },
  });

  await assert.rejects(() => runBackfill({
    maxDocuments: 4,
    processOneFn: processor,
    log() {},
  }), (error) => error instanceof FatalProcessingError
    && error.code === "backfill_quality_consecutive_threshold");
  assert.equal(completions.length, 1);
  assert.equal(completions[0].errorCode, OCR_QUALITY_DIAGNOSTIC_CODES.orientationUncertain);
});

test("fem sammenhængende OCR-kvalitetsproblemer stopper fuld backfill", async () => {
  let calls = 0;
  await assert.rejects(() => runBackfill({
    processOneFn: async () => {
      calls += 1;
      return {
        outcome: "needs_review",
        diagnosticCode: OCR_QUALITY_DIAGNOSTIC_CODES.orientationUncertain,
      };
    },
    log() {},
  }), (error) => error instanceof FatalProcessingError
    && error.code === "backfill_quality_consecutive_threshold");
  assert.equal(calls, 5);
});

test("fem sammenhængende Vision-sideafvisninger stopper fuld backfill", async () => {
  let calls = 0;
  await assert.rejects(() => runBackfill({
    processOneFn: async () => {
      calls += 1;
      return {
        outcome: "needs_review",
        diagnosticCode: OCR_QUALITY_DIAGNOSTIC_CODES.visionPageInvalid,
      };
    },
    log() {},
  }), (error) => error instanceof FatalProcessingError
    && error.code === "backfill_quality_consecutive_threshold");
  assert.equal(calls, 5);
});

test("mere end halvdelen OCR-kvalitetsproblemer i rullende vindue stopper", async () => {
  const outcomes = [
    "ocr_unreadable_page", null,
    "ocr_spatial_quality", null,
    OCR_QUALITY_DIAGNOSTIC_CODES.orientationUncertain, null,
    "ocr_unreadable_page", null,
    "ocr_spatial_quality", "ocr_unreadable_page",
  ];
  let calls = 0;
  await assert.rejects(() => runBackfill({
    qualityConsecutiveThreshold: 5,
    processOneFn: async () => {
      const diagnosticCode = outcomes[calls++];
      return diagnosticCode
        ? { outcome: "needs_review", diagnosticCode }
        : { outcome: "completed" };
    },
    log() {},
  }), (error) => error instanceof FatalProcessingError
    && error.code === "backfill_quality_rate_threshold");
  assert.equal(calls, 10);
});

test("præcis halvdelen OCR-kvalitetsproblemer i ti dokumenter fortsætter", async () => {
  const outcomes = Array.from({ length: 10 }, (_, index) => index % 2 === 0
    ? { outcome: "needs_review", diagnosticCode: "ocr_spatial_quality" }
    : { outcome: "completed" });
  outcomes.push({ outcome: "empty" });
  const result = await runBackfill({
    processOneFn: async () => outcomes.shift(),
    log() {},
  });
  assert.deepEqual(result, { processed: 10, completed: 5, needsReview: 5, failed: 0 });
});

test("fatal identitetsfejl giver non-zero", async () => {
  const code = await main({
    processOneFn: async () => { throw new FatalProcessingError("identity_token_failed"); },
    log() {},
    errorLog() {},
  });
  assert.equal(code, 1);
});

test("ugyldig OCR_MAX_DOCUMENTS_PER_TASK afvises", () => {
  for (const value of ["-1", "1.5", "abc", "100001", " 4"]) {
    assert.throws(() => parseDocumentLimit(value), FatalProcessingError);
  }
  assert.equal(parseDocumentLimit(undefined), 0);
  assert.equal(parseDocumentLimit("0"), 0);
  assert.equal(parseDocumentLimit("4"), 4);
});

test("ugyldig OCR_MAX_CONSECUTIVE_FAILURES afvises", () => {
  for (const value of ["0", "-1", "1.5", "abc", "101", " 1"]) {
    assert.throws(() => parseFailureThreshold(value), FatalProcessingError);
  }
  assert.equal(parseFailureThreshold(undefined), 5);
  assert.equal(parseFailureThreshold("1"), 1);
  assert.equal(parseFailureThreshold("5"), 5);
});

test("ugyldige OCR-kvalitetsstopindstillinger afvises", () => {
  for (const value of ["0", "6", "-1", "1.5", "abc", " 1"]) {
    assert.throws(() => parseQualityConsecutiveThreshold(value), FatalProcessingError);
  }
  for (const value of ["0", "9", "101", "1.5", "abc", " 10"]) {
    assert.throws(() => parseQualityRateWindow(value), FatalProcessingError);
  }
  for (const value of ["0", "51", "-1", "1.5", "abc", " 50"]) {
    assert.throws(() => parseQualityFailureRatePercent(value), FatalProcessingError);
  }
  assert.equal(parseQualityConsecutiveThreshold(undefined), 5);
  assert.equal(parseQualityRateWindow(undefined), 10);
  assert.equal(parseQualityFailureRatePercent(undefined), 50);
});

test("slutlog indeholder kun sikre aggregater", async () => {
  const logs = [];
  let calls = 0;
  await runBackfill({
    processOneFn: async () => calls++ === 0
      ? { outcome: "needs_review", diagnosticCode: "kontrakttekst secret-token" }
      : { outcome: "empty" },
    log: (line) => logs.push(line),
  });
  const combined = logs.join("\n");
  for (const secret of ["kontrakttekst", "/storage/private.pdf", "https://signed.example", "secret-token"]) {
    assert.equal(combined.includes(secret), false);
  }
  assert.deepEqual(JSON.parse(combined), {
    event: "backfill_finished", processed: 1, completed: 0, needsReview: 1, failed: 0,
  });
});

test("kvalitetsstop logger kun en sikker fejlkode", async () => {
  const errors = [];
  const exitCode = await main({
    maxDocuments: 4,
    processOneFn: async () => ({
      outcome: "needs_review",
      diagnosticCode: "ocr_unreadable_page",
      documentText: "kontrakttekst",
      storagePath: "/storage/private.pdf",
    }),
    log() {},
    errorLog: (line) => errors.push(line),
  });
  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(errors.join("\n")), {
    event: "backfill_fatal",
    code: "backfill_quality_consecutive_threshold",
  });
  assert.doesNotMatch(errors.join("\n"), /kontrakttekst|private\.pdf/);
});
