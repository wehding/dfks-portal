import { randomUUID } from "node:crypto";

import { config as loadEnv } from "dotenv";

import {
  geometryBackfillBaselineCohort,
  readBaselineFile,
} from "../audit-ocr-backfill.mjs";
import { createServiceClient } from "../../lib/supabase/service";

loadEnv({ path: ".env.local", quiet: true });

const CONFIRMATION = "QUEUE_VISION_V3_GEOMETRY_BACKFILL";
const DEFAULT_EXPECTED_COUNT = 251;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BackfillTarget = {
  contractId: string;
  sourceJobId: string;
  originalSha256: string;
  originalPageCount: number;
  originalPathDigest: string;
  contractStatus: string;
  priorProcessingStatus: string;
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

async function main() {
  const action = process.argv[2] ?? "preview";
  if (!new Set(["preview", "queue"]).has(action)) throw new Error("invalid_action");
  const cohort = await loadCohort();
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
