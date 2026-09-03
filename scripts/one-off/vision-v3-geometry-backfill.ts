import { randomUUID } from "node:crypto";

import { config as loadEnv } from "dotenv";

import {
  geometryBackfillBaselineCohort,
  readBaselineFile,
} from "../audit-ocr-backfill.mjs";
import { createServiceClient } from "../../lib/supabase/service";

loadEnv({ path: ".env.local", quiet: true });

const CONFIRMATION = "QUEUE_VISION_V3_GEOMETRY_BACKFILL";
const RECOVERY_CONFIRMATION = "QUEUE_VISION_V3_GEOMETRY_RECOVERY";
const DEFAULT_EXPECTED_COUNT = 251;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CODE_PATTERN = /^[a-z0-9._-]{2,80}$/;

type BackfillTarget = {
  contractId: string;
  sourceJobId: string;
  originalSha256: string;
  originalPageCount: number;
  originalPathDigest: string;
  contractStatus: string;
  priorProcessingStatus: string;
};

type RecoveryTargetRow = {
  run_id: string;
  contract_id: string;
  source_job_id: string;
  queued_job_id: string;
  original_sha256: string;
  original_page_count: number;
  original_path_digest: string;
  contract_status: string;
  prior_processing_status: string;
  outcome: string;
  recovery_generation: number;
};

type RecoveryJobRow = {
  id: string;
  contract_id: string;
  status: string;
  error_code: string | null;
  attempts: number;
  original_sha256: string | null;
  backfill_run_id: string | null;
  backfill_source_job_id: string | null;
  processing_intent: string | null;
  downstream_ai_policy: string;
  replacement_of_job_id: string | null;
  superseded_by_job_id: string | null;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function expectedCount() {
  const raw = process.env.OCR_GEOMETRY_BACKFILL_EXPECTED_COUNT?.trim();
  if (!raw) return DEFAULT_EXPECTED_COUNT;
  if (!/^\d+$/.test(raw)) throw new Error("invalid_expected_count");
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1000) {
    throw new Error("invalid_expected_count");
  }
  return parsed;
}

async function loadCohort() {
  const expected = expectedCount();
  const baseline = await readBaselineFile(
    required("OCR_GEOMETRY_BACKFILL_BASELINE_PATH"),
  );
  const cohort = geometryBackfillBaselineCohort(baseline, { expectedCount: expected }) as {
    targets: BackfillTarget[];
    digest: string;
    contractStatuses: Record<string, number>;
    processingStatuses: Record<string, number>;
  };
  return {
    targets: cohort.targets,
    digest: cohort.digest,
    expected,
    contractStatuses: cohort.contractStatuses,
    processingStatuses: cohort.processingStatuses,
  };
}

function recoveryErrorCodes(action: string) {
  const raw = process.env.OCR_GEOMETRY_BACKFILL_RECOVERY_ERROR_CODES?.trim();
  if (!raw) {
    if (action === "recover") throw new Error("recovery_error_codes_required");
    return null;
  }
  if (raw === "*") return null;
  const values = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
  if (!values.length || values.some((value) => !SAFE_CODE_PATTERN.test(value))) {
    throw new Error("invalid_recovery_error_codes");
  }
  return new Set(values);
}

function recoveryLimit() {
  const raw = process.env.OCR_GEOMETRY_BACKFILL_RECOVERY_LIMIT?.trim();
  if (!raw) return 500;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error("invalid_recovery_limit");
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > 500) {
    throw new Error("invalid_recovery_limit");
  }
  return parsed;
}

function countBy<T>(values: T[], key: (value: T) => string) {
  return values.reduce<Record<string, number>>((counts, value) => {
    const label = key(value);
    counts[label] = (counts[label] ?? 0) + 1;
    return counts;
  }, {});
}

async function loadRecoveryJobs(
  db: ReturnType<typeof createServiceClient>,
  jobIds: string[],
) {
  const rows: RecoveryJobRow[] = [];
  for (let offset = 0; offset < jobIds.length; offset += 100) {
    const { data, error } = await db
      .from("contract_document_jobs")
      .select("id,contract_id,status,error_code,attempts,original_sha256,backfill_run_id,backfill_source_job_id,processing_intent,downstream_ai_policy,replacement_of_job_id,superseded_by_job_id")
      .in("id", jobIds.slice(offset, offset + 100));
    if (error) throw new Error("geometry_recovery_jobs_load_failed");
    rows.push(...((data ?? []) as RecoveryJobRow[]));
  }
  return new Map(rows.map((row) => [row.id, row]));
}

async function recoverGeometryBackfill(action: string, cohort: Awaited<ReturnType<typeof loadCohort>>) {
  const runId = required("OCR_GEOMETRY_BACKFILL_RUN_ID");
  if (!UUID_PATTERN.test(runId)) throw new Error("invalid_run_id");
  const db = createServiceClient({
    audit: { source: "cron", mode: "summary", correlationId: runId },
  });
  const [{ data: run, error: runError }, { data: targetData, error: targetError }] =
    await Promise.all([
      db.from("contract_document_backfill_runs")
        .select("id,state,expected_count,cohort_digest")
        .eq("id", runId)
        .maybeSingle(),
      db.from("contract_document_backfill_targets")
        .select("run_id,contract_id,source_job_id,queued_job_id,original_sha256,original_page_count,original_path_digest,contract_status,prior_processing_status,outcome,recovery_generation")
        .eq("run_id", runId)
        .order("contract_id", { ascending: true }),
    ]);
  if (runError || targetError || !run) throw new Error("geometry_recovery_snapshot_failed");
  const targets = (targetData ?? []) as RecoveryTargetRow[];
  if (run.state !== "quality_pending"
    || run.expected_count !== cohort.expected
    || run.cohort_digest !== cohort.digest
    || targets.length !== cohort.expected) {
    throw new Error("geometry_recovery_run_drift");
  }
  const baselineByContract = new Map(cohort.targets.map((target) => [target.contractId, target]));
  const jobsById = await loadRecoveryJobs(db, targets.map((target) => target.queued_job_id));
  const allowedCodes = recoveryErrorCodes(action);
  const candidates = targets.flatMap((target) => {
    const baseline = baselineByContract.get(target.contract_id);
    const job = jobsById.get(target.queued_job_id);
    if (!baseline
      || target.source_job_id !== baseline.sourceJobId
      || target.original_sha256 !== baseline.originalSha256
      || target.original_page_count !== baseline.originalPageCount
      || target.original_path_digest !== baseline.originalPathDigest
      || target.contract_status !== baseline.contractStatus
      || target.prior_processing_status !== baseline.priorProcessingStatus
      || !job
      || job.contract_id !== target.contract_id
      || job.status !== target.outcome
      || job.original_sha256 !== target.original_sha256
      || job.backfill_run_id !== runId
      || job.backfill_source_job_id !== target.source_job_id
      || job.processing_intent !== "direct_vision_geometry_backfill_v1"
      || job.downstream_ai_policy !== "preserve"
      || job.replacement_of_job_id !== null
      || job.superseded_by_job_id !== null
      || !Number.isInteger(target.recovery_generation)
      || target.recovery_generation < 0
      || target.recovery_generation > 19) {
      throw new Error("geometry_recovery_target_drift");
    }
    const terminal = job.status === "needs_review"
      || (job.status === "failed" && job.attempts >= 5);
    const selectedByCode = allowedCodes === null
      || (job.error_code !== null && allowedCodes.has(job.error_code));
    if (!terminal || !selectedByCode) return [];
    return [{
      contractId: target.contract_id,
      currentJobId: job.id,
      currentGeneration: target.recovery_generation,
      status: job.status,
      errorCode: job.error_code,
      originalSha256: target.original_sha256,
    }];
  }).slice(0, recoveryLimit());

  const safeSummary = {
    action,
    selected: candidates.length,
    runState: run.state,
    cohortDigest: cohort.digest,
    statuses: countBy(candidates, (candidate) => candidate.status),
    errorCodes: countBy(candidates, (candidate) => candidate.errorCode ?? "none"),
    generations: countBy(candidates, (candidate) => String(candidate.currentGeneration)),
  };
  if (action === "recover-preview") {
    process.stdout.write(`${JSON.stringify(safeSummary)}\n`);
    return;
  }
  if (!candidates.length) throw new Error("no_recovery_candidates");
  if (process.env.OCR_GEOMETRY_BACKFILL_RECOVERY_CONFIRM !== RECOVERY_CONFIRMATION) {
    throw new Error("explicit_recovery_confirmation_required");
  }
  const { data, error } = await db.rpc(
    "queue_contract_document_geometry_backfill_recovery",
    {
      p_run_id: runId,
      p_cohort_digest: cohort.digest,
      p_recoveries: candidates,
      p_priority: 1250,
      p_created_by: null,
    },
  );
  if (error) throw new Error("geometry_recovery_queue_failed");
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || !["queued", "already_queued"].includes(result.outcome)
    || result.queued_count !== candidates.length) {
    throw new Error("geometry_recovery_queue_mismatch");
  }
  process.stdout.write(`${JSON.stringify({
    ...safeSummary,
    outcome: result.outcome,
    queued: result.queued_count,
    minimumGeneration: result.minimum_generation,
    maximumGeneration: result.maximum_generation,
  })}\n`);
}

async function main() {
  const action = process.argv[2] ?? "preview";
  if (!new Set(["preview", "queue", "recover-preview", "recover"]).has(action)) {
    throw new Error("invalid_action");
  }
  const cohort = await loadCohort();
  if (action === "recover-preview" || action === "recover") {
    await recoverGeometryBackfill(action, cohort);
    return;
  }
  const safeSummary = {
    action,
    selected: cohort.targets.length,
    expected: cohort.expected,
    cohortDigest: cohort.digest,
    contractStatuses: cohort.contractStatuses,
    processingStatuses: cohort.processingStatuses,
  };
  if (action === "preview") {
    process.stdout.write(`${JSON.stringify(safeSummary)}\n`);
    return;
  }
  if (process.env.OCR_GEOMETRY_BACKFILL_CONFIRM !== CONFIRMATION) {
    throw new Error("explicit_confirmation_required");
  }
  const configuredRunId = process.env.OCR_GEOMETRY_BACKFILL_RUN_ID?.trim();
  const runId = configuredRunId || randomUUID();
  if (!UUID_PATTERN.test(runId)) throw new Error("invalid_run_id");
  const db = createServiceClient({
    audit: { source: "cron", mode: "summary", correlationId: runId },
  });
  const { data, error } = await db.rpc("prepare_contract_document_geometry_backfill_run", {
    p_run_id: runId,
    p_expected_count: cohort.expected,
    p_cohort_digest: cohort.digest,
    p_targets: cohort.targets,
    p_priority: 1200,
    p_created_by: null,
  });
  if (error) throw new Error("geometry_backfill_prepare_failed");
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || !["queued", "already_prepared"].includes(result.outcome)
    || result.queued_count !== cohort.expected
    || result.cohort_digest !== cohort.digest) {
    throw new Error("geometry_backfill_prepare_mismatch");
  }
  process.stdout.write(`${JSON.stringify({
    ...safeSummary,
    outcome: result.outcome,
    runPrepared: true,
  })}\n`);
}

main().catch((error) => {
  const code = error instanceof Error ? error.message : "geometry_backfill_failed";
  process.stderr.write(`${JSON.stringify({ error: code })}\n`);
  process.exitCode = 1;
});
