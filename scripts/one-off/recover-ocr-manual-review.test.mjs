import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  deriveSafeCenterOnlyCandidates,
  EXECUTE_CONFIRMATION,
  EXPECTED_RESCAN_COUNT,
  EXPECTED_SAFE_QUEUE_COUNT,
  OcrRecoveryError,
  parseRecoveryArguments,
  readSecureRescanManifest,
  RESCAN_MANIFEST_SCHEMA,
  runRecovery,
  safeRecoverySummary,
  validateRescanManifest,
  validateSupabaseConfiguration,
  writeSecureRescanManifest,
} from "./recover-ocr-manual-review.mjs";

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const pdfBytes = Buffer.from("%PDF-1.7\nsafe fixture\n");
const sourceHash = createHash("sha256").update(pdfBytes).digest("hex");

function candidate(index) {
  return {
    id: uuid(index),
    contract_id: uuid(1_000 + index),
    original_storage_path: `private/${index}.pdf`,
    original_sha256: sourceHash,
    status: "needs_review",
    error_code: "ocr_spatial_quality",
    created_at: `2026-08-31T12:${String(index).padStart(2, "0")}:00.000Z`,
    spatial_accuracy_score: 0.96,
    spatial_median_iou: 0.99,
    spatial_center_inside_ratio: 0.97,
    review_disposition: null,
  };
}

function contractFor(job) {
  return {
    id: job.contract_id,
    status: "kladde",
    pdf_url: job.original_storage_path,
    document_processing_status: "needs_review",
    document_processing_error_code: job.error_code,
  };
}

function manifestEntry(job) {
  return {
    jobId: job.id,
    expectedErrorCode: job.error_code,
    expectedOriginalSha256: job.original_sha256,
    expectedSpatialAccuracyScore: job.spatial_accuracy_score,
    expectedSpatialMedianIou: job.spatial_median_iou,
    expectedSpatialCenterInsideRatio: job.spatial_center_inside_ratio,
  };
}

function recoveryFixture() {
  const candidates = Array.from({ length: 29 }, (_, index) => candidate(index + 1));
  const rescanExtras = Array.from({ length: 3 }, (_, index) => ({
    ...candidate(100 + index),
    error_code: "ocr_unreadable_page",
    spatial_accuracy_score: 0.91,
    spatial_median_iou: 0.87,
    spatial_center_inside_ratio: 0.73,
  }));
  const rescanJobs = [candidates[0], candidates[1], ...rescanExtras];
  const manifest = validateRescanManifest({
    schemaVersion: RESCAN_MANIFEST_SCHEMA,
    jobs: rescanJobs.map(manifestEntry),
  });
  const allUniqueJobs = [...candidates, ...rescanExtras];
  return {
    candidates,
    rescanJobs,
    manifest,
    contracts: allUniqueJobs.map(contractFor),
    allJobs: allUniqueJobs.map(({ id, contract_id, created_at }) => ({ id, contract_id, created_at })),
  };
}

test("recovery er dry-run som standard og execute kræver eksakt bekræftelse", () => {
  assert.deepEqual(parseRecoveryArguments(["--manifest", "/private/tmp/rescan.json"]), {
    manifestPath: "/private/tmp/rescan.json",
    mode: "dry-run",
  });
  assert.throws(
    () => parseRecoveryArguments(["--manifest=/private/tmp/rescan.json", "--execute"]),
    (error) => error instanceof OcrRecoveryError && error.code === "execute_confirmation_required",
  );
  assert.deepEqual(parseRecoveryArguments([
    "--manifest=/private/tmp/rescan.json",
    "--execute",
    `--confirm=${EXECUTE_CONFIRMATION}`,
  ]), { manifestPath: "/private/tmp/rescan.json", mode: "execute" });
});

test("rescan-manifest kræver præcis fem unikke poster uden ekstra private felter", () => {
  const { manifest } = recoveryFixture();
  assert.equal(manifest.jobs.length, EXPECTED_RESCAN_COUNT);
  assert.throws(() => validateRescanManifest({
    schemaVersion: RESCAN_MANIFEST_SCHEMA,
    jobs: manifest.jobs.slice(1),
  }), /invalid_rescan_manifest/);
  assert.throws(() => validateRescanManifest({
    schemaVersion: RESCAN_MANIFEST_SCHEMA,
    jobs: [...manifest.jobs.slice(0, 4), manifest.jobs[0]],
  }), /duplicate_rescan_job/);
  assert.throws(() => validateRescanManifest({
    schemaVersion: RESCAN_MANIFEST_SCHEMA,
    jobs: manifest.jobs.map((entry, index) => index ? entry : { ...entry, originalStoragePath: "private.pdf" }),
  }), /invalid_rescan_manifest/);
  assert.throws(() => validateRescanManifest({
    schemaVersion: RESCAN_MANIFEST_SCHEMA,
    jobs: manifest.jobs.map((entry, index) => index ? entry : {
      ...entry,
      expectedSpatialAccuracyScore: null,
    }),
  }), /invalid_manifest_metric/);
});

test("manifest skrives og accepteres kun som privat 0600-fil i /private/tmp", async (t) => {
  const directory = await mkdtemp("/private/tmp/dfks-ocr-recovery-test-");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "manifest.json");
  const { manifest } = recoveryFixture();
  await writeSecureRescanManifest(path, manifest);
  assert.deepEqual(await readSecureRescanManifest(path), manifest);
  await chmod(path, 0o640);
  await assert.rejects(() => readSecureRescanManifest(path), /manifest_permissions_invalid/);

  const insecurePath = join(directory, "insecure.json");
  await writeFile(insecurePath, JSON.stringify(manifest), { mode: 0o644 });
  await assert.rejects(() => readSecureRescanManifest(insecurePath), /manifest_permissions_invalid/);
});

test("kun 27 center-only jobs udledes efter de fem visuelt valgte er ekskluderet", () => {
  const fixture = recoveryFixture();
  const safe = deriveSafeCenterOnlyCandidates({
    candidates: fixture.candidates,
    allJobs: fixture.allJobs,
    contracts: fixture.contracts,
    rescanJobIds: fixture.manifest.jobs.map((entry) => entry.jobId),
  });
  assert.equal(safe.length, EXPECTED_SAFE_QUEUE_COUNT);
  assert.equal(safe.some((job) => fixture.rescanJobs.some((rescan) => rescan.id === job.id)), false);

  const newer = { id: uuid(900), contract_id: safe[0].contract_id, created_at: "2026-09-01T00:00:00.000Z" };
  assert.throws(() => deriveSafeCenterOnlyCandidates({
    candidates: fixture.candidates,
    allJobs: [...fixture.allJobs, newer],
    contracts: fixture.contracts,
    rescanJobIds: fixture.manifest.jobs.map((entry) => entry.jobId),
  }), /safe_queue_count_mismatch/);
});

function queryBuilder(result) {
  let columns = null;
  const builder = {
    select(selection) {
      columns = selection.split(",").map((column) => column.trim());
      return builder;
    },
    in() { return builder; },
    eq() { return builder; },
    gte() { return builder; },
    lt() { return builder; },
    limit() {
      const data = result.map((row) => Object.fromEntries(
        columns.map((column) => [column, row[column]]),
      ));
      return Promise.resolve({ data, count: data.length, error: null });
    },
  };
  return builder;
}

function markFixtureRescans(fixture, count) {
  for (const job of fixture.rescanJobs.slice(0, count)) {
    job.review_disposition = "rescan_requested";
    const contract = fixture.contracts.find((row) => row.id === job.contract_id);
    contract.document_processing_error_code = "ocr_rescan_required";
  }
}

function mockDatabase(fixture, { downloadBytes = pdfBytes } = {}) {
  let documentJobQuery = 0;
  const rpcCalls = [];
  return {
    rpcCalls,
    from(table) {
      if (table === "contracts") return queryBuilder(fixture.contracts);
      if (table !== "contract_document_jobs") throw new Error("unexpected_table");
      documentJobQuery += 1;
      const phase = (documentJobQuery - 1) % 3;
      if (phase === 0) return queryBuilder(fixture.rescanJobs);
      if (phase === 1) return queryBuilder(fixture.candidates);
      return queryBuilder(fixture.allJobs);
    },
    storage: {
      from() {
        return {
          async download() {
            return { data: new Blob([downloadBytes]), error: null };
          },
        };
      },
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === "mark_contract_document_job_for_rescan") {
        const job = fixture.rescanJobs.find((row) => row.id === args.p_job_id);
        const contract = fixture.contracts.find((row) => row.id === job?.contract_id);
        if (!job || !contract) throw new Error("unexpected_rescan_job");
        job.review_disposition = "rescan_requested";
        contract.document_processing_error_code = "ocr_rescan_required";
        return { data: [{ outcome: "marked", job_id: args.p_job_id }], error: null };
      }
      if (name === "queue_contract_document_job_recovery_generation") {
        const source = fixture.candidates.find((row) => row.id === args.p_source_job_id);
        const contract = fixture.contracts.find((row) => row.id === source?.contract_id);
        if (!source || !contract) throw new Error("unexpected_recovery_source");
        const recoveryId = uuid(8_000 + rpcCalls.length);
        source.review_disposition = "retry_after_pipeline_fix";
        contract.document_processing_status = "pending";
        contract.document_processing_error_code = null;
        fixture.allJobs.push({
          id: recoveryId,
          contract_id: source.contract_id,
          created_at: `2026-09-01T00:${String(rpcCalls.length).padStart(2, "0")}:00.000Z`,
          status: "queued",
          recovery_of_job_id: source.id,
          recovery_reason_code: "spatial_matcher_v2",
          original_storage_path: source.original_storage_path,
          original_sha256: source.original_sha256,
          downstream_ai_policy: contract.status === "valideret" ? "preserve" : "reanalyze",
        });
        return { data: [{
          outcome: "queued",
          source_job_id: args.p_source_job_id,
          recovery_job_id: recoveryId,
          downstream_ai_policy: contract.status === "valideret" ? "preserve" : "reanalyze",
        }], error: null };
      }
      throw new Error("unexpected_rpc");
    },
  };
}

test("dry-run hashverificerer alle 32 originaler uden RPC-kald eller private outputfelter", async () => {
  const fixture = recoveryFixture();
  const db = mockDatabase(fixture);
  const summary = await runRecovery({ db, manifest: fixture.manifest, mode: "dry-run" });
  assert.deepEqual(summary, safeRecoverySummary({ mode: "dry-run", hashesVerified: 32 }));
  assert.equal(db.rpcCalls.length, 0);
  const output = JSON.stringify(summary);
  assert.equal(output.includes("private/"), false);
  assert.equal(output.includes(fixture.rescanJobs[0].id), false);
  assert.equal(output.includes(sourceHash), false);
});

test("execute markerer fem og opretter præcis 27 nye recovery-generationer", async () => {
  const fixture = recoveryFixture();
  const db = mockDatabase(fixture);
  const summary = await runRecovery({ db, manifest: fixture.manifest, mode: "execute" });
  assert.equal(summary.mutations.rescanNewlyMarked, EXPECTED_RESCAN_COUNT);
  assert.equal(summary.mutations.recoveryQueued, EXPECTED_SAFE_QUEUE_COUNT);
  assert.equal(db.rpcCalls.filter((call) => call.name === "mark_contract_document_job_for_rescan").length, 5);
  const queued = db.rpcCalls.filter((call) => call.name === "queue_contract_document_job_recovery_generation");
  assert.equal(queued.length, 27);
  assert.equal(queued.every((call) => call.args.p_recovery_reason_code === "spatial_matcher_v2"), true);
  assert.equal(queued.every((call) => call.args.p_priority === 1000), true);
});

test("execute genoptager delvist markerede rescan-sager uden at markere dem igen", async () => {
  const fixture = recoveryFixture();
  markFixtureRescans(fixture, 2);
  const db = mockDatabase(fixture);
  const summary = await runRecovery({ db, manifest: fixture.manifest, mode: "execute" });
  assert.equal(summary.plan.rescanAlreadyMarked, 2);
  assert.equal(summary.mutations.rescanNewlyMarked, 3);
  const markedIds = db.rpcCalls
    .filter((call) => call.name === "mark_contract_document_job_for_rescan")
    .map((call) => call.args.p_job_id);
  assert.deepEqual(markedIds, fixture.rescanJobs.slice(2).map((job) => job.id));
});

test("execute er idempotent efter rescan-markering og oprettede recovery-generationer", async () => {
  const fixture = recoveryFixture();
  const db = mockDatabase(fixture);
  await runRecovery({ db, manifest: fixture.manifest, mode: "execute" });
  const callsAfterFirstRun = db.rpcCalls.length;
  const summary = await runRecovery({ db, manifest: fixture.manifest, mode: "execute" });
  assert.equal(db.rpcCalls.length, callsAfterFirstRun);
  assert.equal(summary.plan.rescanAlreadyMarked, 5);
  assert.equal(summary.plan.recoveryAlreadyQueued, 27);
  assert.deepEqual(summary.mutations, { rescanNewlyMarked: 0, recoveryQueued: 0 });
});

test("hashafvigelse stopper hele kørslen før første RPC", async () => {
  const fixture = recoveryFixture();
  const db = mockDatabase(fixture, { downloadBytes: Buffer.from("%PDF-1.7\nchanged\n") });
  await assert.rejects(
    () => runRecovery({ db, manifest: fixture.manifest, mode: "execute" }),
    (error) => error instanceof OcrRecoveryError && error.code === "source_hash_mismatch",
  );
  assert.equal(db.rpcCalls.length, 0);
});

test("sikker opsummering indeholder kun aggregater", () => {
  const fixture = recoveryFixture();
  const summary = safeRecoverySummary({
    mode: "execute",
    hashesVerified: 32,
    rescanAlreadyMarked: 2,
    rescanNewlyMarked: 3,
    queued: 27,
  });
  const output = JSON.stringify(summary);
  for (const privateValue of [
    fixture.rescanJobs[0].id,
    fixture.rescanJobs[0].original_storage_path,
    fixture.rescanJobs[0].original_sha256,
  ]) assert.equal(output.includes(privateValue), false);
  assert.deepEqual(summary.mutations, { rescanNewlyMarked: 3, recoveryQueued: 27 });
});

test("service-role klienten accepterer kun et HTTPS Supabase-projektorigin", () => {
  assert.deepEqual(
    validateSupabaseConfiguration("https://project-ref.supabase.co", " secret "),
    { url: "https://project-ref.supabase.co", serviceRoleKey: "secret" },
  );
  for (const unsafeUrl of [
    "http://project-ref.supabase.co",
    "https://project-ref.supabase.co.attacker.example",
    "https://project-ref.supabase.co/rest/v1",
    "https://user:pass@project-ref.supabase.co",
  ]) assert.throws(() => validateSupabaseConfiguration(unsafeUrl, "secret"), /invalid_supabase_url/);
});
