import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  SPATIAL_VERIFICATION_PROFILE,
  V2_SPATIAL_VERIFICATION_PROFILE,
  computeSpatialAccuracy,
} from "../cloud-run/contract-document-worker/spatial-ocr.mjs";

import {
  auditCompletedJobs,
  auditGeometryBackfillRunRecords,
  auditReplacementDeletionLifecycle,
  captureBaseline,
  geometryBackfillBaselineCohort,
  geometryBackfillQualityReportDigest,
  geometryBackfillSummaryReadyForApproval,
  isActiveDlpReplacementCandidate,
  createReadOnlyFetch,
  extractPdfBboxPages,
  extractLegacyPdfPageCount,
  extractPdfPageCount,
  GEOMETRY_AUDIT_PDFTOTEXT_VERSION,
  readBaselineFile,
  loadPostBaselineAiCounts,
  requireMatchingPdfPageCounts,
  requireGeometryAuditPdftotextVersion,
  safeSummaryJson,
  selectGeometryBackfillSources,
  sha256,
  summarizeOperationalState,
  summaryHasViolations,
  verifyBaseline,
  writeBaselineFile,
} from "../scripts/audit-ocr-backfill.mjs";

test("geometry-audit bindes til workerens Poppler-generation", () => {
  assert.equal(GEOMETRY_AUDIT_PDFTOTEXT_VERSION, "22.12.0");
  assert.equal(
    requireGeometryAuditPdftotextVersion("pdftotext version 22.12.0\n"),
    "22.12.0",
  );
  for (const output of [
    "pdftotext version 26.05.0\n",
    "pdftotext version 22.11.0\n",
    "22.12.0",
    "",
  ]) {
    assert.throws(
      () => requireGeometryAuditPdftotextVersion(output),
      (error) => error?.code === "geometry_audit_runtime_mismatch",
    );
  }
});

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
const legacyPageCountToolsUnavailable = [
  ["qpdf", ["--version"]],
  ["pdfinfo", ["-v"]],
].some(([command, args]) => spawnSync(command, args, { stdio: "ignore" }).error?.code === "ENOENT");

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
  direct = false,
  directOverlayProfile = "primary-v1",
  directSpatialVerificationProfile = SPATIAL_VERIFICATION_PROFILE,
  completedAt = "2026-09-01T13:00:00.000Z",
  downstreamAiPolicy = null,
} = {}) {
  const contractId = "11111111-1111-4111-8111-111111111111";
  const orgId = "33333333-3333-4333-8333-333333333333";
  const leaseId = "44444444-4444-4444-8444-444444444444";
  const originalPath = "private/original.pdf";
  const outputPath = `${orgId}/processed/${contractId}/leases/${leaseId}/normalised.pdf`;
  const spatialPath = `${orgId}/processed/${contractId}/leases/${leaseId}/vision-layout.json.gz`;
  const spatial = gzipSync(Buffer.from(JSON.stringify({
    schemaVersion: direct ? "google-vision-spatial-v3" : "google-vision-spatial-v2",
    engine: "google-vision-document-text-detection",
    ...(direct ? {
      processingProfile: "google-vision-direct-v1",
      overlayProfile: directOverlayProfile,
      ...(directSpatialVerificationProfile === null ? {} : {
        spatialVerificationProfile: directSpatialVerificationProfile,
      }),
    } : {
      redactionEngine: "google-sensitive-data-protection-image-redact",
      redactionProfile: "dfks-contract-redaction-v1",
      redactions: [],
    }),
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
      spatial_schema_version: direct ? "google-vision-spatial-v3" : "google-vision-spatial-v2",
      redaction_profile: direct ? null : "dfks-contract-redaction-v1",
      processing_profile: direct ? "google-vision-direct-v1" : null,
      completed_at: completedAt,
      downstream_ai_policy: downstreamAiPolicy,
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
      status: "not_required",
    })),
    contractsById: input.contractsById,
    readStorage: input.readStorage,
  };
}

test("geometry-kohorten bindes til latest terminal source og alle syv digestfelter", async () => {
  const original = await pdf(2);
  const captured = await captureBaseline({
    ...baselineInput(original),
    concurrency: 1,
    capturedAt: "2026-09-01T00:00:00.000Z",
  });
  const cohort = geometryBackfillBaselineCohort(captured.baseline, { expectedCount: 1 });
  assert.equal(cohort.targets.length, 1);
  assert.equal(cohort.targets[0].sourceJobId, captured.baseline.records[0].jobId);
  assert.equal(cohort.targets[0].originalPathDigest,
    captured.baseline.records[0].originalStoragePathSha256);
  assert.equal(cohort.targets[0].priorProcessingStatus, "not_required");

  const altered = structuredClone(captured.baseline);
  altered.records[0].priorProcessingStatus = "failed";
  const payload = {
    schemaVersion: altered.schemaVersion,
    capturedAt: altered.capturedAt,
    records: altered.records,
  };
  altered.integritySha256 = sha256(Buffer.from(JSON.stringify(payload), "utf8"));
  const changed = geometryBackfillBaselineCohort(altered, { expectedCount: 1 });
  assert.notEqual(changed.digest, cohort.digest);
});

test("geometry-kohorten accepterer kun legacy-PDF med dobbeltverificeret sideantal", async () => {
  const legacyPdf = new Uint8Array(Buffer.from("%PDF-legacy-parser-format"));
  const input = baselineInput(await pdf(2));
  input.readStorage = async () => legacyPdf;
  let extractionCalls = 0;
  const captured = await captureBaseline({
    ...input,
    capturedAt: "2026-09-01T00:00:00.000Z",
    extractLegacyPageCount: async (bytes) => {
      extractionCalls += 1;
      assert.strictEqual(bytes, legacyPdf);
      return 2;
    },
  });

  assert.equal(extractionCalls, 1);
  assert.equal(captured.baseline.records[0].originalPdfReadable, false);
  assert.equal(captured.baseline.records[0].originalPageCount, 2);
  assert.equal(captured.baseline.records[0].originalPageCountSource, "qpdf-poppler");
  assert.equal(
    geometryBackfillBaselineCohort(captured.baseline, { expectedCount: 1 }).targets.length,
    1,
  );

  const job = input.jobs[0];
  const valid = await verifyBaseline({
    baseline: captured.baseline,
    jobsById: new Map([[job.id, job]]),
    contractsById: input.contractsById,
    readStorage: async () => legacyPdf,
    extractLegacyPageCount: async () => 2,
  });
  assert.equal(summaryHasViolations(valid), false);

  const changed = await verifyBaseline({
    baseline: captured.baseline,
    jobsById: new Map([[job.id, job]]),
    contractsById: input.contractsById,
    readStorage: async () => legacyPdf,
    extractLegacyPageCount: async () => 1,
  });
  assert.equal(changed.violations.baselineOriginalPageCountMismatch, 1);
});

test("geometry-kohorten afviser legacy-PDF uden uafhængigt sideantal", async () => {
  const input = baselineInput(await pdf(2));
  input.readStorage = async () => new Uint8Array(Buffer.from("%PDF-unavailable"));
  const captured = await captureBaseline({
    ...input,
    capturedAt: "2026-09-01T00:00:00.000Z",
    extractLegacyPageCount: async () => {
      throw new Error("unavailable");
    },
  });
  assert.equal(captured.baseline.records[0].originalPageCount, null);
  assert.equal(captured.baseline.records[0].originalPageCountSource, "unavailable");
  assert.throws(
    () => geometryBackfillBaselineCohort(captured.baseline, { expectedCount: 1 }),
    (error) => error?.code === "geometry_backfill_baseline_ineligible",
  );
});

test("v3-baselines for læsbare PDF'er forbliver kompatible", async () => {
  const captured = await captureBaseline({
    ...baselineInput(await pdf(1)),
    capturedAt: "2026-09-01T00:00:00.000Z",
  });
  const legacy = structuredClone(captured.baseline);
  legacy.schemaVersion = "dfks-ocr-backfill-baseline-v3";
  delete legacy.records[0].originalPageCountSource;
  legacy.integritySha256 = sha256(Buffer.from(JSON.stringify({
    schemaVersion: legacy.schemaVersion,
    capturedAt: legacy.capturedAt,
    records: legacy.records,
  }), "utf8"));
  assert.equal(
    geometryBackfillBaselineCohort(legacy, { expectedCount: 1 }).targets.length,
    1,
  );
});

test("geometry-selektoren vælger aldrig en ældre, aktiv eller allerede kvalificeret generation", () => {
  const orgId = "33333333-3333-4333-8333-333333333333";
  const eligibleContractId = "11111111-1111-4111-8111-111111111111";
  const activeContractId = "11111111-1111-4111-8111-111111111112";
  const qualifiedContractId = "11111111-1111-4111-8111-111111111113";
  const baseContract = {
    org_id: orgId,
    status: "kladde",
    pdf_url: "private/original.pdf",
    processed_pdf_url: null,
    document_spatial_data_path: null,
    document_processing_status: "not_required",
  };
  const contracts = [
    { ...baseContract, id: eligibleContractId },
    { ...baseContract, id: activeContractId },
    {
      ...baseContract,
      id: qualifiedContractId,
      document_processing_status: "needs_review",
      processed_pdf_url: "private/direct.pdf",
      document_spatial_data_path: "private/direct.json.gz",
    },
  ];
  const baseJob = {
    org_id: orgId,
    original_storage_path: "private/original.pdf",
    status: "not_required",
    attempts: 1,
    ocr_applied: false,
    processing_profile: null,
    spatial_schema_version: null,
    superseded_by_job_id: null,
    replacement_of_job_id: null,
    backfill_run_id: null,
    backfill_source_job_id: null,
  };
  const jobs = [
    {
      ...baseJob,
      id: "22222222-2222-4222-8222-222222222221",
      contract_id: eligibleContractId,
      created_at: "2026-08-01T00:00:00.000Z",
    },
    {
      ...baseJob,
      id: "22222222-2222-4222-8222-222222222222",
      contract_id: activeContractId,
      created_at: "2026-08-01T00:00:00.000Z",
    },
    {
      ...baseJob,
      id: "22222222-2222-4222-8222-222222222223",
      contract_id: activeContractId,
      status: "processing",
      created_at: "2026-08-02T00:00:00.000Z",
    },
    {
      ...baseJob,
      id: "22222222-2222-4222-8222-222222222224",
      contract_id: qualifiedContractId,
      status: "completed",
      ocr_applied: true,
      ocr_engine: "google-vision-eu-v1",
      processing_profile: "google-vision-direct-v1",
      spatial_schema_version: "google-vision-spatial-v3",
      spatial_accuracy_score: 0.99,
      spatial_median_iou: 0.9,
      spatial_center_inside_ratio: 0.99,
      output_storage_path: "private/direct.pdf",
      spatial_data_path: "private/direct.json.gz",
      created_at: "2026-08-01T00:00:00.000Z",
    },
  ];
  const selected = selectGeometryBackfillSources({ contracts, jobs, expectedCount: 1 });
  assert.deepEqual(selected.jobs.map((job) => job.contract_id), [eligibleContractId]);
  assert.equal(selected.rejectedByReason.source_not_latest_terminal, 1);
  assert.equal(selected.rejectedByReason.already_qualified, 1);

  jobs[0].superseded_by_job_id = "77777777-7777-4777-8777-777777777777";
  assert.throws(
    () => selectGeometryBackfillSources({ contracts, jobs, expectedCount: 1 }),
    (error) => error?.code === "geometry_backfill_cohort_count_drift",
  );
  jobs[0].superseded_by_job_id = null;
  contracts[0].document_processing_status = "failed";
  assert.throws(
    () => selectGeometryBackfillSources({ contracts, jobs, expectedCount: 1 }),
    (error) => error?.code === "geometry_backfill_cohort_count_drift",
  );
});

test("geometry-run-audit kræver eksakt lineage og bevarer original og kontraktstatus", async () => {
  const original = await pdf(2);
  const captured = await captureBaseline({
    ...baselineInput(original),
    concurrency: 1,
    capturedAt: "2026-09-01T00:00:00.000Z",
  });
  const cohort = geometryBackfillBaselineCohort(captured.baseline, { expectedCount: 1 });
  const baselineTarget = cohort.targets[0];
  const runId = "55555555-5555-4555-8555-555555555555";
  const queuedJobId = "66666666-6666-4666-8666-666666666666";
  const orgId = "33333333-3333-4333-8333-333333333333";
  const outputPath = `${orgId}/processed/${baselineTarget.contractId}/leases/44444444-4444-4444-8444-444444444444/normalised.pdf`;
  const spatialPath = `${orgId}/processed/${baselineTarget.contractId}/leases/44444444-4444-4444-8444-444444444444/vision-layout.json.gz`;
  const source = {
    id: baselineTarget.sourceJobId,
    org_id: orgId,
    contract_id: baselineTarget.contractId,
    original_storage_path: "private/original.pdf",
    original_sha256: baselineTarget.originalSha256,
    page_count: 2,
    status: "not_required",
    superseded_by_job_id: queuedJobId,
  };
  const job = {
    id: queuedJobId,
    org_id: orgId,
    contract_id: baselineTarget.contractId,
    original_storage_path: source.original_storage_path,
    output_storage_path: outputPath,
    spatial_data_path: spatialPath,
    original_sha256: baselineTarget.originalSha256,
    status: "completed",
    attempts: 1,
    downstream_ai_policy: "preserve",
    processing_profile: "google-vision-direct-v1",
    processing_intent: "direct_vision_geometry_backfill_v1",
    backfill_run_id: runId,
    backfill_source_job_id: source.id,
    replacement_of_job_id: null,
    recovery_of_job_id: null,
    recovery_reason_code: null,
    backfill_recovery_audit_event_id: null,
  };
  const contract = {
    id: baselineTarget.contractId,
    org_id: orgId,
    rights_holder_id: "77777777-7777-4777-8777-777777777777",
    status: "kladde",
    pdf_url: source.original_storage_path,
    processed_pdf_url: outputPath,
    document_spatial_data_path: spatialPath,
    document_processing_status: "ready",
    document_processing_error_code: null,
    document_processing_profile: "google-vision-direct-v1",
    document_spatial_schema_version: "google-vision-spatial-v3",
    document_spatial_accuracy: 0.99,
  };
  const target = {
    run_id: runId,
    contract_id: baselineTarget.contractId,
    org_id: orgId,
    source_job_id: source.id,
    queued_job_id: queuedJobId,
    original_sha256: baselineTarget.originalSha256,
    original_page_count: 2,
    original_path_digest: baselineTarget.originalPathDigest,
    contract_status: "kladde",
    prior_processing_status: "not_required",
    prior_processing_error_code: null,
    prior_processing_profile: null,
    prior_spatial_schema_version: null,
    prior_spatial_accuracy: null,
    prior_processed_path_digest: null,
    prior_spatial_path_digest: null,
    outcome: "completed",
    recovery_generation: 0,
  };
  const run = {
    id: runId,
    kind: "direct_vision_geometry_v3",
    processing_profile: "google-vision-direct-v1",
    spatial_schema_version: "google-vision-spatial-v3",
    state: "quality_pending",
    expected_count: 1,
    cohort_digest: cohort.digest,
  };
  const state = auditGeometryBackfillRunRecords({
    run,
    targets: [target],
    jobsById: new Map([[queuedJobId, job]]),
    sourceJobsById: new Map([[source.id, source]]),
    contractsById: new Map([[contract.id, contract]]),
    artifactDeletionRows: [],
    baseline: captured.baseline,
  });
  assert.equal(summaryHasViolations(state), false);
  assert.equal(geometryBackfillSummaryReadyForApproval({
    ...state,
    completedDocumentsPassingAllChecks: 1,
  }), true);
  const firstDigest = geometryBackfillQualityReportDigest({
    ...state,
    completedDocumentsPassingAllChecks: 1,
    baselineDocumentsPassingAllChecks: 1,
  });
  const secondDigest = geometryBackfillQualityReportDigest({
    ...state,
    completedDocumentsPassingAllChecks: 1,
    baselineDocumentsPassingAllChecks: 1,
  });
  assert.equal(firstDigest, secondDigest);

  source.superseded_by_job_id = null;
  const invalid = auditGeometryBackfillRunRecords({
    run,
    targets: [target],
    jobsById: new Map([[queuedJobId, job]]),
    sourceJobsById: new Map([[source.id, source]]),
    contractsById: new Map([[contract.id, contract]]),
    artifactDeletionRows: [{ replacement_job_id: queuedJobId }],
    baseline: captured.baseline,
  });
  assert.equal(invalid.violations.geometrySourceLineageMismatch, 1);
  assert.equal(invalid.violations.geometryUnexpectedArtifactDeletion, 1);

  const unresolvedJob = { ...job, status: "needs_review" };
  const unresolvedContract = {
    ...contract,
    processed_pdf_url: null,
    document_spatial_data_path: null,
    document_processing_status: "not_required",
    document_processing_profile: null,
    document_spatial_schema_version: null,
  };
  const unresolved = auditGeometryBackfillRunRecords({
    run,
    targets: [{ ...target, outcome: "needs_review" }],
    jobsById: new Map([[queuedJobId, unresolvedJob]]),
    sourceJobsById: new Map([[source.id, { ...source, superseded_by_job_id: null }]]),
    contractsById: new Map([[contract.id, unresolvedContract]]),
    artifactDeletionRows: [],
    baseline: captured.baseline,
  });
  assert.equal(unresolved.violations.geometryUnresolvedOutcome, 1);
  assert.equal(geometryBackfillSummaryReadyForApproval({
    ...unresolved,
    completedDocumentsPassingAllChecks: 0,
  }), false);
});

test("geometry-run-audit verificerer recovery-kæde og semantisk medlemsaudit", async () => {
  const original = await pdf(1);
  const captured = await captureBaseline({
    ...baselineInput(original),
    concurrency: 1,
    capturedAt: "2026-09-01T00:00:00.000Z",
  });
  const cohort = geometryBackfillBaselineCohort(captured.baseline, { expectedCount: 1 });
  const baselineTarget = cohort.targets[0];
  const runId = "55555555-5555-4555-8555-555555555556";
  const parentId = "66666666-6666-4666-8666-666666666661";
  const childId = "66666666-6666-4666-8666-666666666662";
  const auditId = "88888888-8888-4888-8888-888888888888";
  const memberId = "77777777-7777-4777-8777-777777777778";
  const orgId = "33333333-3333-4333-8333-333333333334";
  const source = {
    id: baselineTarget.sourceJobId,
    org_id: orgId,
    contract_id: baselineTarget.contractId,
    original_storage_path: "private/original.pdf",
    original_sha256: baselineTarget.originalSha256,
    page_count: 1,
    status: "not_required",
    superseded_by_job_id: childId,
  };
  const common = {
    org_id: orgId,
    contract_id: baselineTarget.contractId,
    original_storage_path: source.original_storage_path,
    original_sha256: baselineTarget.originalSha256,
    downstream_ai_policy: "preserve",
    processing_profile: "google-vision-direct-v1",
    processing_intent: "direct_vision_geometry_backfill_v1",
    backfill_run_id: runId,
    backfill_source_job_id: source.id,
    replacement_of_job_id: null,
  };
  const parent = {
    ...common,
    id: parentId,
    status: "needs_review",
    attempts: 1,
    recovery_of_job_id: null,
    recovery_reason_code: null,
    backfill_recovery_audit_event_id: null,
  };
  const outputPath = `${orgId}/processed/${baselineTarget.contractId}/leases/44444444-4444-4444-8444-444444444445/normalised.pdf`;
  const spatialPath = `${orgId}/processed/${baselineTarget.contractId}/leases/44444444-4444-4444-8444-444444444445/vision-layout.json.gz`;
  const child = {
    ...common,
    id: childId,
    status: "completed",
    attempts: 1,
    output_storage_path: outputPath,
    spatial_data_path: spatialPath,
    recovery_of_job_id: parentId,
    recovery_reason_code: "geometry_quality_recovery_v1",
    backfill_recovery_audit_event_id: auditId,
  };
  const contract = {
    id: baselineTarget.contractId,
    org_id: orgId,
    rights_holder_id: memberId,
    status: "kladde",
    pdf_url: source.original_storage_path,
    processed_pdf_url: outputPath,
    document_spatial_data_path: spatialPath,
    document_processing_status: "ready",
    document_processing_error_code: null,
    document_processing_profile: "google-vision-direct-v1",
    document_spatial_schema_version: "google-vision-spatial-v3",
    document_spatial_accuracy: 0.99,
  };
  const target = {
    run_id: runId,
    contract_id: baselineTarget.contractId,
    org_id: orgId,
    source_job_id: source.id,
    queued_job_id: childId,
    original_sha256: baselineTarget.originalSha256,
    original_page_count: 1,
    original_path_digest: baselineTarget.originalPathDigest,
    contract_status: "kladde",
    prior_processing_status: "not_required",
    prior_processing_error_code: null,
    prior_processing_profile: null,
    prior_spatial_schema_version: null,
    prior_spatial_accuracy: null,
    prior_processed_path_digest: null,
    prior_spatial_path_digest: null,
    outcome: "completed",
    recovery_generation: 1,
  };
  const run = {
    id: runId,
    kind: "direct_vision_geometry_v3",
    processing_profile: "google-vision-direct-v1",
    spatial_schema_version: "google-vision-spatial-v3",
    state: "quality_pending",
    expected_count: 1,
    cohort_digest: cohort.digest,
  };
  const event = {
    id: auditId,
    entity_type: "contract_document_backfill_recovery",
    entity_id: runId,
    correlation_id: runId,
    metadata: {
      event_code: "vision_v3_geometry_backfill_recovery_queued",
      audit_subject_count: 1,
      audit_subject_set_hash: sha256(Buffer.from(memberId, "utf8")),
    },
  };
  const valid = auditGeometryBackfillRunRecords({
    run,
    targets: [target],
    jobsById: new Map([[parentId, parent], [childId, child]]),
    sourceJobsById: new Map([[source.id, source]]),
    contractsById: new Map([[contract.id, contract]]),
    artifactDeletionRows: [],
    auditEventsById: new Map([[auditId, event]]),
    auditSubjectsByEventId: new Map([[auditId, new Set([memberId])]]),
    baseline: captured.baseline,
  });
  assert.equal(summaryHasViolations(valid), false);

  child.backfill_recovery_audit_event_id = null;
  const invalid = auditGeometryBackfillRunRecords({
    run,
    targets: [target],
    jobsById: new Map([[parentId, parent], [childId, child]]),
    sourceJobsById: new Map([[source.id, source]]),
    contractsById: new Map([[contract.id, contract]]),
    artifactDeletionRows: [],
    auditEventsById: new Map([[auditId, event]]),
    auditSubjectsByEventId: new Map([[auditId, new Set([memberId])]]),
    baseline: captured.baseline,
  });
  assert.equal(invalid.violations.geometryRecoveryAuditMismatch, 1);

  child.backfill_recovery_audit_event_id = auditId;
  child.recovery_reason_code = "unexpected_recovery_reason";
  const reasonTampered = auditGeometryBackfillRunRecords({
    run,
    targets: [target],
    jobsById: new Map([[parentId, parent], [childId, child]]),
    sourceJobsById: new Map([[source.id, source]]),
    contractsById: new Map([[contract.id, contract]]),
    artifactDeletionRows: [],
    auditEventsById: new Map([[auditId, event]]),
    auditSubjectsByEventId: new Map([[auditId, new Set([memberId])]]),
    baseline: captured.baseline,
  });
  assert.ok(reasonTampered.violations.geometryRecoveryAuditMismatch > 0);
});

test("geometry-audit tæller alle AI-generationer efter baseline uanset terminal status", async () => {
  const contractId = "11111111-1111-4111-8111-111111111111";
  const calls = [];
  const db = {
    from(table) {
      assert.equal(table, "contract_ai_jobs");
      const builder = {
        select(value) { calls.push(["select", value]); return builder; },
        in(field, values) { calls.push(["in", field, values]); return builder; },
        gte(field, value) { calls.push(["gte", field, value]); return builder; },
        order() { return builder; },
        async range() {
          return {
            data: [{
              id: "22222222-2222-4222-8222-222222222222",
              contract_id: contractId,
              created_at: "2026-09-01T00:01:00.000Z",
              status: "completed",
            }],
            error: null,
          };
        },
      };
      return builder;
    },
  };
  const counts = await loadPostBaselineAiCounts(
    db,
    [contractId],
    "2026-09-01T00:00:00.000Z",
  );
  assert.equal(counts.get(contractId), 1);
  assert.ok(calls.some(([operation]) => operation === "gte"));
  assert.ok(!calls.some(([, value]) => value === "status"));
});

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

test("direkte Vision v3 består metadata- og geometriporten uden DLP-felter", async () => {
  const original = await pdf(2);
  const output = await pdf(2);
  const summary = await auditCompletedJobs(fixture({ original, output, direct: true }));
  assert.equal(summary.violations.missingJobMetadata, 0);
  assert.equal(summary.violations.invalidSpatialArtifact, 0);
  assert.equal(summary.documentsPassingAllChecks, 1);
});

test("direkte Vision v3 kræver en allowlistet spatial-verifikationsprofil når feltet findes", async () => {
  const original = await pdf(2);
  const output = await pdf(2);
  const accepted = await auditCompletedJobs(fixture({ original, output, direct: true }));
  assert.equal(accepted.violations.invalidSpatialArtifact, 0);

  const rejected = await auditCompletedJobs(fixture({
    original,
    output,
    direct: true,
    directSpatialVerificationProfile: "ukendt-spatial-profil",
  }));
  assert.equal(rejected.violations.invalidSpatialArtifact, 1);
  assert.equal(rejected.documentsPassingAllChecks, 0);

  for (const completedAt of [
    "2026-09-01T12:00:00.000Z",
    "2026-09-01T13:00:00.000Z",
  ]) {
    const explicitLegacy = await auditCompletedJobs(fixture({
      original,
      output,
      direct: true,
      completedAt,
      directSpatialVerificationProfile: "dfks-spatial-verification-legacy-v1",
    }));
    assert.equal(explicitLegacy.violations.invalidSpatialArtifact, 1);
  }

  const currentBeforeCutover = await auditCompletedJobs(fixture({
    original,
    output,
    direct: true,
    completedAt: "2026-09-01T12:00:00.000Z",
  }));
  assert.equal(currentBeforeCutover.violations.invalidSpatialArtifact, 0);
});

test("audit accepterer historisk v2 og genberegner med artefaktets eksakte profil", async () => {
  const original = await pdf(1);
  const output = await pdf(1);
  const input = fixture({
    original,
    output,
    expectedPages: 1,
    direct: true,
    directSpatialVerificationProfile: V2_SPATIAL_VERIFICATION_PROFILE,
  });
  const geometryWords = [];
  const extractedWords = [];
  for (let index = 0; index < 100; index += 1) {
    const isScaled = index < 5;
    const isAnchor = index >= 5 && index < 10;
    const pairIndex = isAnchor ? index - 5 : index;
    const text = isScaled ? `x${index}` : isAnchor ? `Nabo${pairIndex}` : `Ord${index}`;
    const yMin = index < 10 ? 10 + pairIndex * 15 : 100 + index * 10;
    const xMin = isAnchor ? 40 : 20;
    const xMax = isAnchor ? 70 : 30;
    geometryWords.push({
      text,
      confidence: 0.96,
      vertices: [
        { x: xMin, y: yMin }, { x: xMax, y: yMin },
        { x: xMax, y: yMin + 8 }, { x: xMin, y: yMin + 8 },
      ],
    });
    extractedWords.push(isScaled
      ? { text, xMin: 14.25, yMin, xMax: 35.75, yMax: yMin + 8 }
      : { text, xMin, yMin, xMax, yMax: yMin + 8 });
  }
  const geometryPages = [{
    pageNumber: 1,
    sourceImageWidth: 100,
    sourceImageHeight: 1200,
    imageWidth: 100,
    imageHeight: 1200,
    orientationCorrection: 0,
    words: geometryWords,
  }];
  const extractedPages = [{ width: 100, height: 1200, words: extractedWords }];
  const storedV2Metrics = computeSpatialAccuracy(
    geometryPages,
    extractedPages,
    V2_SPATIAL_VERIFICATION_PROFILE,
  );
  assert.equal(storedV2Metrics.passed, true);
  assert.equal(storedV2Metrics.score, 0.95);

  const spatialPath = input.jobs[0].spatial_data_path;
  const originalReader = input.readStorage;
  const geometry = JSON.parse(gunzipSync(await originalReader(spatialPath)).toString("utf8"));
  geometry.pages = geometryPages;
  geometry.spatialVerification = storedV2Metrics;
  const v2Artifact = gzipSync(Buffer.from(JSON.stringify(geometry)));
  input.jobs[0].spatial_sha256 = sha256(v2Artifact);
  input.readStorage = async (path) => path === spatialPath ? v2Artifact : originalReader(path);
  input.extractBboxPages = async () => extractedPages;

  const historical = await auditCompletedJobs(input);
  assert.equal(historical.violations.invalidSpatialArtifact, 0);
  assert.equal(historical.violations.spatialMetricMismatch, 0);
  assert.equal(historical.violations.spatialIndependentVerificationFailure, 0);
  assert.equal(historical.documentsPassingAllChecks, 1);

  geometry.spatialVerificationProfile = SPATIAL_VERIFICATION_PROFILE;
  const falselyRelabelledArtifact = gzipSync(Buffer.from(JSON.stringify(geometry)));
  const relabelled = await auditCompletedJobs({
    ...input,
    jobs: [{ ...input.jobs[0], spatial_sha256: sha256(falselyRelabelledArtifact) }],
    readStorage: async (path) => path === spatialPath
      ? falselyRelabelledArtifact
      : originalReader(path),
  });
  assert.equal(relabelled.violations.invalidSpatialArtifact, 0);
  assert.equal(relabelled.violations.spatialMetricMismatch, 1);
  assert.equal(relabelled.documentsPassingAllChecks, 0);
});

test("v3 uden profil genberegnes med præcis legacy-matcher uden nye geometrigates", async () => {
  const original = await pdf(1);
  const output = await pdf(1);
  const input = fixture({
    original,
    output,
    expectedPages: 1,
    direct: true,
    directSpatialVerificationProfile: null,
    completedAt: "2026-09-01T12:00:00.000Z",
  });
  const spatialPath = input.jobs[0].spatial_data_path;
  const originalReader = input.readStorage;
  const geometry = JSON.parse(gunzipSync(await originalReader(spatialPath)).toString("utf8"));
  geometry.pages[0].words = [{
    text: "førsteanden",
    confidence: 0.99,
    vertices: [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }, { x: 10, y: 40 }],
  }];
  geometry.spatialVerification = {
    expectedWords: 1,
    matchedWords: 1,
    measurableWords: 1,
    matchCoverage: 1,
    score: 1,
    medianIou: 1,
    centerInsideRatio: 1,
    passed: true,
  };
  const legacyArtifact = gzipSync(Buffer.from(JSON.stringify(geometry)));
  input.jobs[0].spatial_sha256 = sha256(legacyArtifact);
  input.readStorage = async (path) => path === spatialPath
    ? legacyArtifact
    : originalReader(path);
  input.extractBboxPages = async () => [{
    width: 100,
    height: 100,
    words: [
      { text: "første", xMin: 10, yMin: 10, xMax: 40, yMax: 20 },
      { text: "anden", xMin: 10, yMin: 30, xMax: 40, yMax: 40 },
    ],
  }];

  const summary = await auditCompletedJobs(input);
  assert.equal(summary.violations.invalidSpatialArtifact, 0);
  assert.equal(summary.violations.spatialMetricMismatch, 0);
  assert.equal(summary.violations.spatialIndependentVerificationFailure, 0);
  assert.equal(summary.documentsPassingAllChecks, 1);

  for (const completedAt of [
    "2026-09-01T12:51:39.000Z",
    "2026-09-01T12:51:39.001Z",
    "ikke-et-tidspunkt",
    null,
  ]) {
    const afterCutover = await auditCompletedJobs({
      ...input,
      jobs: [{ ...input.jobs[0], completed_at: completedAt }],
    });
    assert.equal(afterCutover.violations.invalidSpatialArtifact, 1);
    assert.equal(afterCutover.documentsPassingAllChecks, 0);
  }

  const immediatelyBeforeCutover = await auditCompletedJobs({
    ...input,
    jobs: [{ ...input.jobs[0], completed_at: "2026-09-01T12:51:38.999Z" }],
  });
  assert.equal(immediatelyBeforeCutover.violations.invalidSpatialArtifact, 0);
  assert.equal(immediatelyBeforeCutover.documentsPassingAllChecks, 1);
});

test("direkte Vision-audit accepterer kun workerens allowlistede overlay-profiler", async () => {
  const original = await pdf(2);
  const output = await pdf(2);
  for (const directOverlayProfile of [
    undefined,
    "primary-v1",
    "font-metrics-v1",
    "axis-aligned-font-metrics-v1",
  ]) {
    const summary = await auditCompletedJobs(fixture({
      original, output, direct: true, directOverlayProfile,
    }));
    assert.equal(summary.violations.invalidSpatialArtifact, 0);
  }
  const invalid = await auditCompletedJobs(fixture({
    original, output, direct: true, directOverlayProfile: "ukendt-profil",
  }));
  assert.equal(invalid.violations.invalidSpatialArtifact, 1);
  assert.equal(invalid.documentsPassingAllChecks, 0);
});

test("replacement-audit kræver præcis to slettede DLP-artefakter og aldrig originalen", () => {
  const sourceId = "11111111-1111-4111-8111-111111111111";
  const replacementId = "22222222-2222-4222-8222-222222222222";
  const source = {
    id: sourceId,
    original_storage_path: "org/original.pdf",
    output_storage_path: "org/masked.pdf",
    spatial_data_path: "org/masked.json.gz",
    superseded_by_job_id: replacementId,
  };
  const replacementJobs = [{
    id: replacementId,
    replacement_of_job_id: sourceId,
    status: "completed",
  }];
  const validRows = [
    { source_job_id: sourceId, replacement_job_id: replacementId, artifact_kind: "masked_pdf", storage_path: source.output_storage_path, status: "deleted" },
    { source_job_id: sourceId, replacement_job_id: replacementId, artifact_kind: "masked_spatial", storage_path: source.spatial_data_path, status: "deleted" },
  ];
  const valid = auditReplacementDeletionLifecycle({
    replacementJobs,
    sourceJobsById: new Map([[sourceId, source]]),
    deletionRows: validRows,
  });
  assert.equal(valid.supersededArtifactDeletionMismatch, 0);
  assert.equal(valid.originalDeletionCandidate, 0);

  const invalid = auditReplacementDeletionLifecycle({
    replacementJobs,
    sourceJobsById: new Map([[sourceId, source]]),
    deletionRows: [{ ...validRows[0], storage_path: source.original_storage_path }],
  });
  assert.equal(invalid.supersededArtifactDeletionMismatch, 1);
  assert.equal(invalid.originalDeletionCandidate, 1);
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

test("legacy-sideantal kræver enighed mellem qpdf og Poppler", {
  skip: legacyPageCountToolsUnavailable,
}, async () => {
  assert.equal(await extractLegacyPdfPageCount(await pdf(3)), 3);
  await assert.rejects(
    extractLegacyPdfPageCount(Buffer.from("ikke en pdf token=abc")),
    (error) => error?.code === "pdf_page_count_failed"
      && !String(error?.message).includes("token=abc"),
  );
  await assert.rejects(
    extractLegacyPdfPageCount(Buffer.from("junk%PDF-1.7\n")),
    (error) => error?.code === "pdf_page_count_failed",
  );
});

test("legacy-sideantal afviser parseruenighed fail-closed", () => {
  assert.equal(requireMatchingPdfPageCounts(3, 3), 3);
  assert.throws(
    () => requireMatchingPdfPageCounts(3, 2),
    (error) => error?.code === "pdf_page_count_failed",
  );
  assert.throws(
    () => requireMatchingPdfPageCounts(0, 0),
    (error) => error?.code === "pdf_page_count_failed",
  );
});

test("kendt uparsebar original kræver samme hash og uafhængigt sideantal", async () => {
  const original = Buffer.from("%PDF-kendt-uparsebar");
  const output = await pdf(2);
  const input = fixture({ original, output, expectedPages: 2 });
  const job = input.jobs[0];
  input.baselineOriginalByJob = new Map([[
    job.id,
    knownUnparseableBaseline(job, {
      originalPageCount: 2,
      originalPageCountSource: "qpdf-poppler",
    }),
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

test("kendt uparsebar original accepterer kun den eksakte geometry-backfill-kilde", async () => {
  const original = Buffer.from("%PDF-kendt-uparsebar-backfill");
  const input = fixture({ original, output: await pdf(2), expectedPages: 2, direct: true });
  const job = input.jobs[0];
  const sourceJobId = "55555555-5555-4555-8555-555555555555";
  job.backfill_source_job_id = sourceJobId;
  input.baselineOriginalByJob = new Map([[
    job.contract_id,
    knownUnparseableBaseline(job, {
      jobId: sourceJobId,
      originalPageCount: 2,
      originalPageCountSource: "qpdf-poppler",
    }),
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

  job.backfill_source_job_id = "66666666-6666-4666-8666-666666666666";
  const rejected = await auditCompletedJobs(input);
  assert.equal(rejected.violations.invalidOriginalPdf, 1);
  assert.equal(rejected.documentsPassingAllChecks, 0);
  assert.equal(extractorCalls, 1);
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
  assert.equal(captured.baseline.records[0].originalPageCountSource, "unavailable");
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
