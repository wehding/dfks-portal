import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  auditCompletedJobs,
  captureBaseline,
  isActiveDlpReplacementCandidate,
  createReadOnlyFetch,
  extractPdfBboxPages,
  extractPdfPageCount,
  readBaselineFile,
  safeSummaryJson,
  sha256,
  summarizeOperationalState,
  summaryHasViolations,
  verifyBaseline,
  writeBaselineFile,
} from "../scripts/audit-ocr-backfill.mjs";

test("direct Vision-kohorten accepterer kun den aktive DLP-generation", () => {
  const job = {
    status: "completed",
    ocr_applied: true,
    redaction_profile: "dfks-contract-redaction-v1",
    spatial_schema_version: "google-vision-spatial-v2",
    superseded_by_job_id: null,
    original_storage_path: "org/contract/original.pdf",
    output_storage_path: "org/processed/contract/leases/lease/normalised.pdf",
    spatial_data_path: "org/processed/contract/leases/lease/vision-layout.json.gz",
  };
  const contract = {
    status: "afventer",
    pdf_url: job.original_storage_path,
    processed_pdf_url: job.output_storage_path,
    document_spatial_data_path: job.spatial_data_path,
  };
  assert.equal(isActiveDlpReplacementCandidate(job, contract), true);
  assert.equal(isActiveDlpReplacementCandidate(
    { ...job, redaction_profile: null }, contract,
  ), false);
  assert.equal(isActiveDlpReplacementCandidate(
    job, { ...contract, processed_pdf_url: "org/processed/newer.pdf" },
  ), false);
  assert.equal(isActiveDlpReplacementCandidate(
    { ...job, superseded_by_job_id: "00000000-0000-4000-8000-000000000001" }, contract,
  ), false);
});

const pdftotextUnavailable = spawnSync("pdftotext", ["-v"], { stdio: "ignore" }).error?.code === "ENOENT";
const pikepdfUnavailable = spawnSync(
  "python3", ["-c", "import pikepdf"], { stdio: "ignore" },
).status !== 0;

async function pdf(pages) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) document.addPage([595, 842]);
  return new Uint8Array(await document.save());
}

async function searchablePdf(text) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([200, 200]);
  page.drawText(text, { x: 20, y: 150, size: 12, font });
  return new Uint8Array(await document.save());
}

function fixture({
  original,
  output,
  expectedPages = 2,
  activeAiCount = 1,
  status = "kladde",
  originalHash = sha256(original),
  processedHash = sha256(output),
} = {}) {
  const contractId = "11111111-1111-4111-8111-111111111111";
  const orgId = "33333333-3333-4333-8333-333333333333";
  const leaseId = "44444444-4444-4444-8444-444444444444";
  const originalPath = "private/original.pdf";
  const outputPath = `${orgId}/processed/${contractId}/leases/${leaseId}/normalised.pdf`;
  const spatialPath = `${orgId}/processed/${contractId}/leases/${leaseId}/vision-layout.json.gz`;
  const spatial = gzipSync(Buffer.from(JSON.stringify({
    schemaVersion: "google-vision-spatial-v2",
    engine: "google-vision-document-text-detection",
    redactionEngine: "google-sensitive-data-protection-image-redact",
    redactionProfile: "dfks-contract-redaction-v1",
    redactions: [],
    spatialVerification: {
      expectedWords: expectedPages,
      matchedWords: expectedPages,
      measurableWords: expectedPages,
      matchCoverage: 1,
      score: 1,
      medianIou: 1,
      centerInsideRatio: 1,
      passed: true,
    },
    pages: Array.from({ length: expectedPages }, (_, index) => ({
      pageNumber: index + 1,
      sourceImageWidth: 100,
      sourceImageHeight: 100,
      imageWidth: 100,
      imageHeight: 100,
      orientationCorrection: 0,
      words: [{
        text: "tekst",
        confidence: 0.99,
        vertices: [{ x: 1, y: 1 }, { x: 20, y: 1 }, { x: 20, y: 10 }, { x: 1, y: 10 }],
      }],
    })),
  })),
  );
  return {
    jobs: [{
      id: "22222222-2222-4222-8222-222222222222",
      org_id: orgId,
      contract_id: contractId,
      original_storage_path: originalPath,
      output_storage_path: outputPath,
      spatial_data_path: spatialPath,
      ocr_applied: true,
      page_count: expectedPages,
      original_sha256: originalHash,
      processed_sha256: processedHash,
      spatial_sha256: sha256(spatial),
      spatial_schema_version: "google-vision-spatial-v2",
    }],
    contractsById: new Map([[
      contractId,
      {
        id: contractId,
        status,
        pdf_url: originalPath,
        processed_pdf_url: outputPath,
        document_spatial_data_path: spatialPath,
        document_processing_status: "ready",
      },
    ]]),
    activeAiCounts: new Map([[contractId, activeAiCount]]),
    extractBboxPages: async () => Array.from({ length: expectedPages }, () => ({
      width: 100,
      height: 100,
      words: [{ xMin: 1, yMin: 1, xMax: 20, yMax: 10, text: "tekst" }],
    })),
    readStorage: async (path) => {
      if (path === originalPath) return original;
      if (path === outputPath) return output;
      if (path === spatialPath) return spatial;
      throw new Error("missing");
    },
  };
}

function baselineInput(original, status = "kladde") {
  const input = fixture({ original, output: original, expectedPages: 2, status });
  return {
    jobs: input.jobs.map((job) => ({
      id: job.id,
      contract_id: job.contract_id,
      original_storage_path: job.original_storage_path,
    })),
    contractsById: input.contractsById,
    readStorage: input.readStorage,
  };
}

function knownUnparseableBaseline(job, overrides = {}) {
  return {
    jobId: job.id,
    contractId: job.contract_id,
    originalSha256: job.original_sha256,
    originalStoragePathDigest: sha256(Buffer.from(job.original_storage_path, "utf8")),
    originalPdfReadable: false,
    originalPageCount: null,
    ...overrides,
  };
}

test("en intakt OCR-kørsel består alle kontroller", async () => {
  const original = await pdf(2);
  const output = await pdf(2);
  const summary = await auditCompletedJobs(fixture({ original, output }));

  assert.equal(summary.completedJobsExamined, 1);
  assert.equal(summary.documentsPassingAllChecks, 1);
  assert.equal(summaryHasViolations(summary), false);
});

test("audit accepterer workerens rotationsmetadata og kræver konsistente dimensioner", async () => {
  const original = await pdf(1);
  const output = await pdf(1);
  const input = fixture({ original, output, expectedPages: 1 });
  const spatialPath = input.jobs[0].spatial_data_path;
  const originalReader = input.readStorage;
  const geometry = JSON.parse(gunzipSync(await originalReader(spatialPath)).toString("utf8"));
  Object.assign(geometry.pages[0], {
    sourceImageWidth: 100,
    sourceImageHeight: 200,
    imageWidth: 200,
    imageHeight: 100,
    orientationCorrection: 90,
  });
  const rotated = gzipSync(Buffer.from(JSON.stringify(geometry)));
  input.jobs[0].spatial_sha256 = sha256(rotated);
  input.readStorage = async (path) => path === spatialPath ? rotated : originalReader(path);
  input.extractBboxPages = async () => [{
    width: 200,
    height: 100,
    words: [{ xMin: 1, yMin: 1, xMax: 20, yMax: 10, text: "tekst" }],
  }];

  const validSummary = await auditCompletedJobs(input);
  assert.equal(validSummary.violations.invalidSpatialArtifact, 0);
  assert.equal(validSummary.documentsPassingAllChecks, 1);

  geometry.pages[0].imageWidth = 100;
  const inconsistent = gzipSync(Buffer.from(JSON.stringify(geometry)));
  input.jobs[0].spatial_sha256 = sha256(inconsistent);
  input.readStorage = async (path) => path === spatialPath ? inconsistent : originalReader(path);
  const invalidSummary = await auditCompletedJobs(input);
  assert.equal(invalidSummary.violations.invalidSpatialArtifact, 1);
});

test("produktionsaudit udtrækker bbox fra PDF uden shell eller dokumentlogs", {
  skip: pdftotextUnavailable,
}, async () => {
  const pages = await extractPdfBboxPages(await searchablePdf("SpatialAuditOrd"));
  assert.equal(pages.length, 1);
  assert.equal(pages[0].words.some((word) => word.text === "SpatialAuditOrd"), true);

  await assert.rejects(
    extractPdfBboxPages(Buffer.from("hemmelig kontrakttekst token=abc")),
    (error) => error?.code === "spatial_bbox_failed"
      && !String(error?.message).includes("hemmelig")
      && !String(error?.message).includes("token=abc"),
  );
});

test("produktionsaudit tæller PDF-sider med et uafhængigt værktøj", {
  skip: pikepdfUnavailable,
}, async () => {
  assert.equal(await extractPdfPageCount(await pdf(3)), 3);
  await assert.rejects(
    extractPdfPageCount(Buffer.from("ikke en kontrakt-pdf token=abc")),
    (error) => error?.code === "pdf_page_count_failed"
      && !String(error?.message).includes("token=abc"),
  );
});

test("kendt uparsebar original kræver samme hash og uafhængigt sideantal", async () => {
  const original = Buffer.from("%PDF-kendt-uparsebar");
  const output = await pdf(2);
  const input = fixture({ original, output, expectedPages: 2 });
  const job = input.jobs[0];
  input.baselineOriginalByJob = new Map([[
    job.id,
    knownUnparseableBaseline(job),
  ]]);
  let extractorCalls = 0;
  input.extractOriginalPageCount = async (bytes) => {
    extractorCalls += 1;
    assert.strictEqual(bytes, original);
    return 2;
  };

  const accepted = await auditCompletedJobs(input);
  assert.equal(accepted.violations.invalidOriginalPdf, 0);
  assert.equal(accepted.documentsPassingAllChecks, 1);
  assert.equal(extractorCalls, 1);

  input.extractOriginalPageCount = async (bytes) => {
    extractorCalls += 1;
    assert.strictEqual(bytes, original);
    return 1;
  };
  const rejected = await auditCompletedJobs(input);
  assert.equal(rejected.violations.invalidOriginalPdf, 1);
  assert.equal(rejected.documentsPassingAllChecks, 0);
  assert.equal(extractorCalls, 2);
});

test("uparsebar original uden baseline kalder ikke den uafhængige extractor", async () => {
  const original = Buffer.from("%PDF-uden-baseline");
  const input = fixture({ original, output: await pdf(2), expectedPages: 2 });
  let extractorCalls = 0;
  input.extractOriginalPageCount = async () => {
    extractorCalls += 1;
    return 2;
  };

  const summary = await auditCompletedJobs(input);
  assert.equal(summary.violations.invalidOriginalPdf, 1);
  assert.equal(summary.documentsPassingAllChecks, 0);
  assert.equal(extractorCalls, 0);
});

test("uparsebar original med læsbar baseline kalder ikke den uafhængige extractor", async () => {
  const original = Buffer.from("%PDF-læsbar-baseline");
  const input = fixture({ original, output: await pdf(2), expectedPages: 2 });
  const job = input.jobs[0];
  input.baselineOriginalByJob = new Map([[
    job.id,
    knownUnparseableBaseline(job, { originalPdfReadable: true, originalPageCount: 2 }),
  ]]);
  let extractorCalls = 0;
  input.extractOriginalPageCount = async () => {
    extractorCalls += 1;
    return 2;
  };

  const summary = await auditCompletedJobs(input);
  assert.equal(summary.violations.invalidOriginalPdf, 1);
  assert.equal(summary.documentsPassingAllChecks, 0);
  assert.equal(extractorCalls, 0);
});

test("uparsebar original kræver match mellem aktuelle bytes, job og baseline", async () => {
  const cases = [
    {
      name: "baselinejob",
      mutate: (_job, baseline) => { baseline.jobId = "00000000-0000-4000-8000-000000000099"; },
    },
    {
      name: "baselinecontract",
      mutate: (_job, baseline) => { baseline.contractId = "00000000-0000-4000-8000-000000000098"; },
    },
    {
      name: "jobhash",
      mutate: (job) => { job.original_sha256 = "a".repeat(64); },
    },
    {
      name: "baselinehash",
      mutate: (_job, baseline) => { baseline.originalSha256 = "b".repeat(64); },
    },
    {
      name: "baselinepath",
      mutate: (_job, baseline) => { baseline.originalStoragePathDigest = "c".repeat(64); },
    },
  ];

  for (const testCase of cases) {
    const original = Buffer.from(`%PDF-mismatch-${testCase.name}`);
    const input = fixture({ original, output: await pdf(2), expectedPages: 2 });
    const job = input.jobs[0];
    const baseline = knownUnparseableBaseline(job);
    testCase.mutate(job, baseline);
    input.baselineOriginalByJob = new Map([[job.id, baseline]]);
    let extractorCalls = 0;
    input.extractOriginalPageCount = async () => {
      extractorCalls += 1;
      return 2;
    };

    const summary = await auditCompletedJobs(input);
    assert.equal(summary.violations.invalidOriginalPdf, 1, testCase.name);
    assert.equal(summary.documentsPassingAllChecks, 0, testCase.name);
    assert.equal(extractorCalls, 0, testCase.name);
  }
});

test("fejl i den uafhængige extractor afviser en ellers kendt uparsebar original", async () => {
  const original = Buffer.from("%PDF-extractor-fejl");
  const input = fixture({ original, output: await pdf(2), expectedPages: 2 });
  const job = input.jobs[0];
  input.baselineOriginalByJob = new Map([[
    job.id,
    knownUnparseableBaseline(job),
  ]]);
  let extractorCalls = 0;
  input.extractOriginalPageCount = async () => {
    extractorCalls += 1;
    throw new Error("token=skal-ikke-lækkes");
  };

  const summary = await auditCompletedJobs(input);
  assert.equal(summary.violations.invalidOriginalPdf, 1);
  assert.equal(summary.documentsPassingAllChecks, 0);
  assert.equal(extractorCalls, 1);
  assert.doesNotMatch(safeSummaryJson(summary), /skal-ikke-lækkes/);
});

test("originalens ændrede hash og outputtets sideantal afvises", async () => {
  const original = await pdf(2);
  const output = await pdf(1);
  const summary = await auditCompletedJobs(fixture({
    original,
    output,
    originalHash: "a".repeat(64),
  }));

  assert.equal(summary.violations.originalHashMismatch, 1);
  assert.equal(summary.violations.outputPageCountMismatch, 1);
  assert.equal(summary.violations.originalOutputPageCountMismatch, 1);
  assert.equal(summaryHasViolations(summary), true);
});

test("geometriartefaktets hash, gzip og sideantal kontrolleres", async () => {
  const original = await pdf(2);
  const output = await pdf(2);

  const hashMismatch = fixture({ original, output });
  hashMismatch.jobs[0].spatial_sha256 = "f".repeat(64);
  const hashSummary = await auditCompletedJobs(hashMismatch);
  assert.equal(hashSummary.violations.spatialHashMismatch, 1);

  const corrupt = fixture({ original, output });
  const corruptBytes = Buffer.from("ikke gzip");
  corrupt.jobs[0].spatial_sha256 = sha256(corruptBytes);
  const normalReader = corrupt.readStorage;
  corrupt.readStorage = async (path) => path === corrupt.jobs[0].spatial_data_path
    ? corruptBytes : normalReader(path);
  const corruptSummary = await auditCompletedJobs(corrupt);
  assert.equal(corruptSummary.violations.invalidSpatialArtifact, 1);

  const wrongPages = fixture({ original, output });
  const shortGeometry = gzipSync(Buffer.from(JSON.stringify({
    schemaVersion: "google-vision-spatial-v2",
    engine: "google-vision-document-text-detection",
    redactionEngine: "google-sensitive-data-protection-image-redact",
    redactionProfile: "dfks-contract-redaction-v1",
    redactions: [],
    pages: [{
      pageNumber: 1,
      imageWidth: 100,
      imageHeight: 100,
      words: [{
        text: "tekst",
        confidence: 0.99,
        vertices: [{ x: 1, y: 1 }, { x: 20, y: 1 }, { x: 20, y: 10 }, { x: 1, y: 10 }],
      }],
    }],
  })));
  wrongPages.jobs[0].spatial_sha256 = sha256(shortGeometry);
  const wrongReader = wrongPages.readStorage;
  wrongPages.readStorage = async (path) => path === wrongPages.jobs[0].spatial_data_path
    ? shortGeometry : wrongReader(path);
  const pageSummary = await auditCompletedJobs(wrongPages);
  assert.equal(pageSummary.violations.invalidSpatialArtifact, 1);
  assert.equal(pageSummary.violations.spatialPageCountMismatch, 1);
});

test("geometriskemaet afviser ekstra felter og bokse uden areal", async () => {
  const original = await pdf(1);
  const output = await pdf(1);
  const input = fixture({ original, output, expectedPages: 1 });
  const unsafeGeometry = gzipSync(Buffer.from(JSON.stringify({
    schemaVersion: "google-vision-spatial-v2",
    engine: "google-vision-document-text-detection",
    redactionEngine: "google-sensitive-data-protection-image-redact",
    redactionProfile: "dfks-contract-redaction-v1",
    redactions: [],
    note: "access_token_should_never_be_here",
    pages: [{
      pageNumber: 1,
      imageWidth: 100,
      imageHeight: 100,
      words: [{
        text: "tekst",
        confidence: 0.99,
        vertices: [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }],
      }],
    }],
  })));
  input.jobs[0].spatial_sha256 = sha256(unsafeGeometry);
  const baseReader = input.readStorage;
  input.readStorage = async (path) => path === input.jobs[0].spatial_data_path
    ? unsafeGeometry : baseReader(path);
  const summary = await auditCompletedJobs(input);
  assert.equal(summary.violations.invalidSpatialArtifact, 1);
  assert.doesNotMatch(safeSummaryJson(summary), /access_token_should_never_be_here/);
});

test("audit genberegner spatial dækning fra den behandlede PDF", async () => {
  const original = await pdf(1);
  const output = await pdf(1);
  const input = fixture({ original, output, expectedPages: 1 });
  input.extractBboxPages = async () => [{
    width: 100,
    height: 100,
    words: [{ xMin: 1, yMin: 1, xMax: 20, yMax: 10, text: "manipuleret" }],
  }];

  const summary = await auditCompletedJobs(input);
  assert.equal(summary.violations.spatialIndependentVerificationFailure, 1);
  assert.equal(summary.violations.spatialMetricMismatch, 1);
  assert.equal(summary.documentsPassingAllChecks, 0);
});

test("audit afviser manipulerede gemte spatialmetrikker selv med gyldig hash", async () => {
  const original = await pdf(1);
  const output = await pdf(1);
  const input = fixture({ original, output, expectedPages: 1 });
  const spatialPath = input.jobs[0].spatial_data_path;
  const originalReader = input.readStorage;
  const stored = await originalReader(spatialPath);
  const geometry = JSON.parse(gunzipSync(stored).toString("utf8"));
  geometry.spatialVerification.score = 0.99;
  const manipulated = gzipSync(Buffer.from(JSON.stringify(geometry)));
  input.jobs[0].spatial_sha256 = sha256(manipulated);
  input.readStorage = async (path) => path === spatialPath ? manipulated : originalReader(path);

  const summary = await auditCompletedJobs(input);
  assert.equal(summary.violations.spatialMetricMismatch, 1);
  assert.equal(summary.documentsPassingAllChecks, 0);
});

test("audit downloader kun leasebundne derivative paths", async () => {
  const original = await pdf(1);
  const output = await pdf(1);
  const input = fixture({ original, output, expectedPages: 1 });
  input.jobs[0].output_storage_path = "private/processed.pdf";
  input.contractsById.values().next().value.processed_pdf_url = "private/processed.pdf";
  let derivativeReads = 0;
  const originalReader = input.readStorage;
  input.readStorage = async (path) => {
    if (path !== input.jobs[0].original_storage_path) derivativeReads += 1;
    return originalReader(path);
  };

  const summary = await auditCompletedJobs(input);
  assert.equal(summary.violations.derivativePathInvalid, 1);
  assert.equal(derivativeReads, 0);
  assert.doesNotMatch(safeSummaryJson(summary), /private\/processed|vision-layout|normalised/);
});

test("manglende aktivt AI-job og valideret kontrakt afvises", async () => {
  const original = await pdf(2);
  const output = await pdf(2);
  const summary = await auditCompletedJobs(fixture({
    original,
    output,
    activeAiCount: 0,
    status: "valideret",
  }));

  assert.equal(summary.violations.activeAiJobCountMismatch, 1);
  assert.equal(summary.violations.automaticallyValidatedContract, 1);
  assert.equal(summary.documentsPassingAllChecks, 0);
});

test("uændret valideret kontrakt accepteres når status er beskyttet af baseline", async () => {
  const original = await pdf(2);
  const output = await pdf(2);
  const input = fixture({ original, output, status: "valideret" });
  const contractId = input.jobs[0].contract_id;
  const summary = await auditCompletedJobs({
    ...input,
    baselineStatusByContract: new Map([[contractId, "valideret"]]),
  });

  assert.equal(summary.violations.automaticallyValidatedContract, 0);
  assert.equal(summary.documentsPassingAllChecks, 1);
  assert.equal(summaryHasViolations(summary), false);
});

test("validering efter baseline afvises selv om kontrakten findes i baseline", async () => {
  const original = await pdf(2);
  const output = await pdf(2);
  const input = fixture({ original, output, status: "valideret" });
  const contractId = input.jobs[0].contract_id;
  const summary = await auditCompletedJobs({
    ...input,
    baselineStatusByContract: new Map([[contractId, "kladde"]]),
  });

  assert.equal(summary.violations.automaticallyValidatedContract, 1);
  assert.equal(summary.documentsPassingAllChecks, 0);
  assert.equal(summaryHasViolations(summary), true);
});

test("storagefejl rapporteres kun som aggregat", async () => {
  const original = await pdf(2);
  const output = await pdf(2);
  const sensitivePath = "org/person/cpr-0101011234.pdf";
  const sensitiveHash = "f".repeat(64);
  const input = fixture({ original, output });
  input.jobs[0].original_storage_path = sensitivePath;
  input.jobs[0].original_sha256 = sensitiveHash;
  input.contractsById.values().next().value.pdf_url = sensitivePath;
  input.readStorage = async () => { throw new Error("signed=https://secret.invalid?token=abc"); };

  const summary = await auditCompletedJobs(input);
  const rendered = safeSummaryJson(summary);

  assert.equal(summary.violations.originalReadFailure, 1);
  assert.equal(summary.violations.outputReadFailure, 1);
  assert.doesNotMatch(rendered, /0101011234|secret\.invalid|token=abc|private\/|[a-f0-9]{64}/);
});

test("audittransporten afviser alle skrivende HTTP-metoder før netværket", async () => {
  let outboundCalls = 0;
  const readOnlyFetch = createReadOnlyFetch(async () => {
    outboundCalls += 1;
    return new Response(null, { status: 204 });
  });

  await assert.rejects(
    readOnlyFetch("https://example.invalid/rest/v1/contracts", { method: "POST" }),
    (error) => error?.code === "read_only_transport_violation",
  );
  assert.equal(outboundCalls, 0);

  const response = await readOnlyFetch("https://example.invalid/rest/v1/contracts", { method: "GET" });
  assert.equal(response.status, 204);
  assert.equal(outboundCalls, 1);
});

test("baseline gemmes eksklusivt som 0600 uden paths i filen eller detaljer i output", async () => {
  const original = await pdf(2);
  const captured = await captureBaseline({
    ...baselineInput(original),
    capturedAt: "2026-08-30T12:00:00.000Z",
  });
  assert.ok(captured.baseline);
  assert.equal(summaryHasViolations(captured.summary), false);
  assert.equal(captured.baseline.records.length, 1);
  assert.equal("originalStoragePath" in captured.baseline.records[0], false);

  const directory = await mkdtemp(join(tmpdir(), "dfks-ocr-baseline-"));
  const baselinePath = join(directory, "baseline.json");
  try {
    await writeBaselineFile(baselinePath, captured.baseline);
    const fileStat = await stat(baselinePath);
    assert.equal(fileStat.mode & 0o777, 0o600);
    assert.deepEqual(await readBaselineFile(baselinePath), captured.baseline);
    await assert.rejects(
      writeBaselineFile(baselinePath, captured.baseline),
      (error) => error?.code === "baseline_write_failed",
    );

    const rendered = safeSummaryJson(captured.summary);
    assert.doesNotMatch(rendered, /private\/|11111111|22222222|[a-f0-9]{64}/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("baselineaudit opdager ændret original, sideantal og kontraktstatus som aggregater", async () => {
  const original = await pdf(2);
  const changed = await pdf(1);
  const input = baselineInput(original);
  const captured = await captureBaseline({
    ...input,
    capturedAt: "2026-08-30T12:00:00.000Z",
  });
  assert.ok(captured.baseline);

  const job = input.jobs[0];
  const contract = input.contractsById.get(job.contract_id);
  contract.status = "valideret";
  const summary = await verifyBaseline({
    baseline: captured.baseline,
    jobsById: new Map([[job.id, job]]),
    contractsById: input.contractsById,
    readStorage: async () => changed,
  });

  assert.equal(summary.baselineJobsExamined, 1);
  assert.equal(summary.baselineDocumentsPassingAllChecks, 0);
  assert.equal(summary.violations.baselineOriginalHashMismatch, 1);
  assert.equal(summary.violations.baselineOriginalPageCountMismatch, 1);
  assert.equal(summary.violations.baselineContractStatusMismatch, 1);
  assert.equal(summaryHasViolations(summary), true);
  assert.doesNotMatch(safeSummaryJson(summary), /private\/|11111111|22222222|[a-f0-9]{64}/);
});

test("baseline opdager samme bytes flyttet til en anden storage-sti", async () => {
  const original = await pdf(2);
  const input = baselineInput(original);
  const captured = await captureBaseline({
    ...input,
    capturedAt: "2026-08-30T12:00:00.000Z",
  });
  assert.ok(captured.baseline);
  const job = input.jobs[0];
  job.original_storage_path = "private/flyttet-original.pdf";
  input.contractsById.get(job.contract_id).pdf_url = job.original_storage_path;

  const summary = await verifyBaseline({
    baseline: captured.baseline,
    jobsById: new Map([[job.id, job]]),
    contractsById: input.contractsById,
    readStorage: async () => original,
  });
  assert.equal(summary.violations.baselineOriginalPathMismatch, 1);
  assert.equal(summary.baselineDocumentsPassingAllChecks, 0);
  assert.doesNotMatch(safeSummaryJson(summary), /flyttet-original/);
});

test("baselinefilen afvises ved ændret indhold eller for brede filrettigheder", async () => {
  const original = await pdf(2);
  const captured = await captureBaseline({
    ...baselineInput(original),
    capturedAt: "2026-08-30T12:00:00.000Z",
  });
  const directory = await mkdtemp(join(tmpdir(), "dfks-ocr-baseline-"));
  const baselinePath = join(directory, "baseline.json");
  try {
    await writeBaselineFile(baselinePath, captured.baseline);
    const raw = await readFile(baselinePath, "utf8");
    await writeFile(baselinePath, raw.replace('"contractStatus":"kladde"', '"contractStatus":"valideret"'), { mode: 0o600 });
    await assert.rejects(
      readBaselineFile(baselinePath),
      (error) => error?.code === "baseline_integrity_failed",
    );

    await writeFile(baselinePath, raw, { mode: 0o600 });
    await chmod(baselinePath, 0o644);
    await assert.rejects(
      readBaselineFile(baselinePath),
      (error) => error?.code === "baseline_permissions_invalid",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("baseline registrerer en allerede uparsebar original som kendt hashbundet kildetilstand", async () => {
  const input = baselineInput(await pdf(2));
  input.readStorage = async () => new Uint8Array(Buffer.from("not a pdf"));
  const captured = await captureBaseline({
    ...input,
    capturedAt: "2026-08-30T12:00:00.000Z",
  });

  assert.ok(captured.baseline);
  assert.equal(captured.baseline.records[0].originalPdfReadable, false);
  assert.equal(captured.baseline.records[0].originalPageCount, null);
  assert.equal(captured.summary.baselineSourceState.readablePdf, 0);
  assert.equal(captured.summary.baselineSourceState.unparseablePdf, 1);
  assert.equal(summaryHasViolations(captured.summary), false);
  assert.doesNotMatch(
    safeSummaryJson(captured.summary),
    /not a pdf|private\/|11111111|22222222|[a-f0-9]{64}/,
  );
});

test("baselineaudit kræver samme hash og samme parsebarhed for uparsebar original", async () => {
  const invalid = new Uint8Array(Buffer.from("not a pdf"));
  const input = baselineInput(await pdf(2));
  input.readStorage = async () => invalid;
  const captured = await captureBaseline({
    ...input,
    capturedAt: "2026-08-30T12:00:00.000Z",
  });
  assert.ok(captured.baseline);

  const job = input.jobs[0];
  const unchanged = await verifyBaseline({
    baseline: captured.baseline,
    jobsById: new Map([[job.id, job]]),
    contractsById: input.contractsById,
    readStorage: async () => invalid,
  });
  assert.equal(unchanged.baselineDocumentsPassingAllChecks, 1);
  assert.equal(unchanged.baselineSourceState.unparseablePdf, 1);
  assert.equal(summaryHasViolations(unchanged), false);

  const changed = await verifyBaseline({
    baseline: captured.baseline,
    jobsById: new Map([[job.id, job]]),
    contractsById: input.contractsById,
    readStorage: async () => pdf(2),
  });
  assert.equal(changed.violations.baselineOriginalHashMismatch, 1);
  assert.equal(changed.violations.baselineOriginalPdfReadabilityMismatch, 1);
  assert.equal(changed.baselineDocumentsPassingAllChecks, 0);
  assert.equal(summaryHasViolations(changed), true);
});

test("slutaudit viser kun sikre dokument-, side-, retry- og AI-aggregater", () => {
  const documentJobs = [
    { status: "queued", attempts: 0, page_count: null, ocr_applied: false },
    { status: "processing", attempts: 1, page_count: 2, ocr_applied: false },
    { status: "completed", attempts: 1, page_count: 3, ocr_applied: true },
    { status: "needs_review", attempts: 2, page_count: 4, ocr_applied: false },
    { status: "failed", attempts: 3, page_count: null, ocr_applied: false },
    { status: "not_required", attempts: 1, page_count: 5, ocr_applied: false },
    {
      status: "unexpected", attempts: 4, page_count: 6, ocr_applied: true,
      id: "11111111-1111-4111-8111-111111111111", original_storage_path: "private/sensitive.pdf",
    },
  ];
  const aiJobs = [
    { status: "queued", attempts: 0 },
    { status: "done", attempts: 1 },
    { status: "dead", attempts: 2 },
    { status: "error", attempts: 3 },
    { status: "unexpected", attempts: 4, contract_id: "22222222-2222-4222-8222-222222222222" },
  ];
  const summary = summarizeOperationalState({ documentJobs, aiJobs });

  assert.equal(summary.documentJobsTotal, 7);
  for (const status of ["queued", "processing", "completed", "needs_review", "failed", "not_required", "unknown"]) {
    assert.equal(summary.documentJobsByStatus[status], 1);
  }
  assert.equal(summary.ocrApplied, 2);
  assert.equal(summary.nativeTextNotRequired, 1);
  assert.equal("normalizedWithoutOcr" in summary, false);
  assert.deepEqual(summary.pageCounts, { documentsWithPageCount: 5, average: 4, maximum: 6 });
  assert.deepEqual(summary.attempts, {
    documentAttempts: 12,
    documentRetries: 6,
    aiAttempts: 10,
    aiRetries: 6,
    totalAttempts: 22,
    totalRetries: 12,
  });
  assert.equal(summary.relevantAiJobsTotal, 5);
  assert.equal(summary.relevantAiJobsByStatus.queued, 1);
  assert.equal(summary.relevantAiJobsByStatus.done, 1);
  assert.equal(summary.relevantAiJobsByStatus.dead, 1);
  assert.equal(summary.relevantAiJobsByStatus.error, 1);
  assert.equal(summary.relevantAiJobsByStatus.unknown, 1);
  assert.doesNotMatch(
    safeSummaryJson(summary),
    /private\/|sensitive|11111111|22222222|[a-f0-9]{64}/,
  );
});
