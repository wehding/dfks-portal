#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

export const EXPECTED_RESCAN_COUNT = 5;
export const EXPECTED_SAFE_QUEUE_COUNT = 27;
export const RESCAN_MANIFEST_SCHEMA = "dfks-ocr-rescan-manifest-v1";
export const EXECUTE_CONFIRMATION = "RESCAN_5_QUEUE_27";

const CONTRACT_BUCKET = "kontrakter";
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CENTER_ONLY_ERROR_CODE = "ocr_spatial_quality";
const RESCAN_DISPOSITION = "rescan_requested";
const RESCAN_REQUIRED_ERROR_CODE = "ocr_rescan_required";
const RECOVERY_DISPOSITION = "retry_after_pipeline_fix";
const RECOVERY_REASON_CODE = "spatial_matcher_v2";
const MAX_QUERY_ROWS = 500;

export class OcrRecoveryError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "OcrRecoveryError";
    this.code = code;
  }
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isSha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function metric(value, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new OcrRecoveryError("invalid_manifest_metric");
  }
  return value;
}

function sameMetric(left, right) {
  if (left == null || right == null) return left == null && right == null;
  const parsedLeft = Number(left);
  const parsedRight = Number(right);
  return Number.isFinite(parsedLeft) && Number.isFinite(parsedRight) && parsedLeft === parsedRight;
}

export function validateRescanManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !["schemaVersion", "jobs"].includes(key))
    || value.schemaVersion !== RESCAN_MANIFEST_SCHEMA
    || !Array.isArray(value.jobs)
    || value.jobs.length !== EXPECTED_RESCAN_COUNT) {
    throw new OcrRecoveryError("invalid_rescan_manifest");
  }
  const seen = new Set();
  const jobs = value.jobs.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).some((key) => ![
        "jobId",
        "expectedErrorCode",
        "expectedOriginalSha256",
        "expectedSpatialAccuracyScore",
        "expectedSpatialMedianIou",
        "expectedSpatialCenterInsideRatio",
      ].includes(key))
      || !isUuid(entry.jobId)
      || typeof entry.expectedErrorCode !== "string" || !entry.expectedErrorCode.trim()
      || !isSha256(entry.expectedOriginalSha256?.toLowerCase?.())) {
      throw new OcrRecoveryError("invalid_rescan_manifest");
    }
    const jobId = entry.jobId.toLowerCase();
    if (seen.has(jobId)) throw new OcrRecoveryError("duplicate_rescan_job");
    seen.add(jobId);
    return Object.freeze({
      jobId,
      expectedErrorCode: entry.expectedErrorCode.trim(),
      expectedOriginalSha256: entry.expectedOriginalSha256.toLowerCase(),
      expectedSpatialAccuracyScore: metric(entry.expectedSpatialAccuracyScore),
      expectedSpatialMedianIou: metric(entry.expectedSpatialMedianIou),
      expectedSpatialCenterInsideRatio: metric(entry.expectedSpatialCenterInsideRatio),
    });
  });
  return Object.freeze({ schemaVersion: RESCAN_MANIFEST_SCHEMA, jobs });
}

export async function readSecureRescanManifest(path) {
  if (typeof path !== "string" || !path.trim()) throw new OcrRecoveryError("manifest_required");
  const absolutePath = resolve(path);
  if (!absolutePath.startsWith("/private/tmp/")) {
    throw new OcrRecoveryError("manifest_must_be_temporary");
  }
  let handle;
  try {
    handle = await open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    throw new OcrRecoveryError("manifest_unavailable", { cause: error });
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o777) !== 0o600
      || info.size < 2 || info.size > MAX_MANIFEST_BYTES
      || (typeof process.getuid === "function" && info.uid !== process.getuid())) {
      throw new OcrRecoveryError("manifest_permissions_invalid");
    }
    return validateRescanManifest(JSON.parse(await handle.readFile("utf8")));
  } catch (error) {
    if (error instanceof OcrRecoveryError) throw error;
    throw new OcrRecoveryError("invalid_rescan_manifest", { cause: error });
  } finally {
    await handle.close();
  }
}

export async function writeSecureRescanManifest(path, manifest) {
  const absolutePath = resolve(path);
  if (!absolutePath.startsWith("/private/tmp/")) {
    throw new OcrRecoveryError("manifest_must_be_temporary");
  }
  const validated = validateRescanManifest(manifest);
  const handle = await open(absolutePath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function parseRecoveryArguments(argv) {
  let manifestPath = null;
  let execute = false;
  let confirmation = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--execute") execute = true;
    else if (argument === "--manifest") manifestPath = argv[++index] ?? null;
    else if (argument.startsWith("--manifest=")) manifestPath = argument.slice("--manifest=".length);
    else if (argument === "--confirm") confirmation = argv[++index] ?? null;
    else if (argument.startsWith("--confirm=")) confirmation = argument.slice("--confirm=".length);
    else throw new OcrRecoveryError("invalid_argument");
  }
  if (!manifestPath) throw new OcrRecoveryError("manifest_required");
  if (execute && confirmation !== EXECUTE_CONFIRMATION) {
    throw new OcrRecoveryError("execute_confirmation_required");
  }
  if (!execute && confirmation) throw new OcrRecoveryError("confirmation_without_execute");
  return Object.freeze({ manifestPath, mode: execute ? "execute" : "dry-run" });
}

function newestJobIds(rows) {
  const newest = new Map();
  for (const row of rows) {
    const current = newest.get(row.contract_id);
    const candidateKey = `${row.created_at ?? ""}\u0000${row.id ?? ""}`;
    const currentKey = current ? `${current.created_at ?? ""}\u0000${current.id ?? ""}` : "";
    if (!current || candidateKey > currentKey) newest.set(row.contract_id, row);
  }
  return new Set([...newest.values()].map((row) => row.id));
}

export function deriveSafeCenterOnlyPlan({ candidates, allJobs, contracts, rescanJobIds }) {
  const latest = newestJobIds(allJobs);
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]));
  const excluded = new Set([...rescanJobIds].map((value) => value.toLowerCase()));
  const recoveryChildren = new Map();
  for (const job of allJobs) {
    if (!job.recovery_of_job_id) continue;
    const children = recoveryChildren.get(job.recovery_of_job_id) ?? [];
    children.push(job);
    recoveryChildren.set(job.recovery_of_job_id, children);
  }
  const pending = [];
  const alreadyQueued = [];
  for (const job of candidates) {
    const contract = contractsById.get(job.contract_id);
    const baseMatch = isUuid(job.id) && isUuid(job.contract_id)
      && !excluded.has(job.id.toLowerCase())
      && job.status === "needs_review"
      && job.error_code === CENTER_ONLY_ERROR_CODE
      && job.review_disposition !== RESCAN_DISPOSITION
      && Number(job.spatial_accuracy_score) >= 0.95
      && Number(job.spatial_median_iou) >= 0.85
      && Number(job.spatial_center_inside_ratio) < 0.98
      && contract
      && ["kladde", "valideret"].includes(contract.status)
      && contract.pdf_url === job.original_storage_path
      && isSha256(job.original_sha256);
    if (!baseMatch) continue;

    const children = recoveryChildren.get(job.id) ?? [];
    if (job.review_disposition === null
      && children.length === 0
      && latest.has(job.id)
      && contract.document_processing_status === "needs_review"
      && contract.document_processing_error_code === CENTER_ONLY_ERROR_CODE) {
      pending.push(job);
      continue;
    }

    const expectedPolicy = contract.status === "valideret" ? "preserve" : "reanalyze";
    const child = children.length === 1 ? children[0] : null;
    if (job.review_disposition === RECOVERY_DISPOSITION
      && child
      && isUuid(child.id)
      && ["queued", "processing", "completed", "failed", "needs_review", "not_required"].includes(child.status)
      && child.recovery_reason_code === RECOVERY_REASON_CODE
      && child.original_sha256 === job.original_sha256
      && child.original_storage_path === job.original_storage_path
      && child.downstream_ai_policy === expectedPolicy
      && ["pending", "processing", "ready", "needs_review", "failed", "not_required"].includes(
        contract.document_processing_status,
      )
      && latest.has(child.id)) {
      alreadyQueued.push(job);
    }
  }
  if (pending.length + alreadyQueued.length !== EXPECTED_SAFE_QUEUE_COUNT) {
    throw new OcrRecoveryError("safe_queue_count_mismatch");
  }
  return { pending, alreadyQueued, all: [...pending, ...alreadyQueued] };
}

export function deriveSafeCenterOnlyCandidates(options) {
  return deriveSafeCenterOnlyPlan(options).all;
}

function validateManifestEntryAgainstJob(entry, job, contract, latestIds) {
  if (!job || !contract || !latestIds.has(job.id)
    || job.id.toLowerCase() !== entry.jobId
    || job.status !== "needs_review"
    || job.error_code !== entry.expectedErrorCode
    || job.original_sha256 !== entry.expectedOriginalSha256
    || contract.pdf_url !== job.original_storage_path
    || contract.document_processing_status !== "needs_review"
    || contract.status !== "kladde"
    || !sameMetric(job.spatial_accuracy_score, entry.expectedSpatialAccuracyScore)
    || !sameMetric(job.spatial_median_iou, entry.expectedSpatialMedianIou)
    || !sameMetric(job.spatial_center_inside_ratio, entry.expectedSpatialCenterInsideRatio)) {
    throw new OcrRecoveryError("rescan_precondition_mismatch");
  }

  if (job.review_disposition === RESCAN_DISPOSITION
    && contract.document_processing_error_code === RESCAN_REQUIRED_ERROR_CODE) {
    return "already_marked";
  }
  if (job.review_disposition === null
    && contract.document_processing_error_code === entry.expectedErrorCode) {
    return "pending";
  }
  throw new OcrRecoveryError("rescan_precondition_mismatch");
}

function assertQuery(result, code) {
  if (result?.error || !Array.isArray(result?.data)) throw new OcrRecoveryError(code);
  if (!Number.isSafeInteger(result.count) || result.count !== result.data.length) {
    throw new OcrRecoveryError("query_result_truncated");
  }
  return result.data;
}

async function fetchRowsByIds(db, table, columns, ids, code) {
  if (!ids.length) return [];
  return assertQuery(await db.from(table).select(columns, { count: "exact" }).in("id", ids)
    .limit(MAX_QUERY_ROWS), code);
}

async function fetchRecoveryState(db, manifest) {
  const manifestJobIds = manifest.jobs.map((entry) => entry.jobId);
  const manifestJobs = await fetchRowsByIds(
    db,
    "contract_document_jobs",
    "id,contract_id,original_storage_path,original_sha256,status,error_code,created_at,spatial_accuracy_score,spatial_median_iou,spatial_center_inside_ratio,review_disposition",
    manifestJobIds,
    "rescan_jobs_query_failed",
  );
  if (manifestJobs.length !== EXPECTED_RESCAN_COUNT) {
    throw new OcrRecoveryError("rescan_job_count_mismatch");
  }

  const candidateResult = await db.from("contract_document_jobs").select(
    "id,contract_id,original_storage_path,original_sha256,status,error_code,created_at,spatial_accuracy_score,spatial_median_iou,spatial_center_inside_ratio,review_disposition",
    { count: "exact" },
  ).eq("status", "needs_review")
    .eq("error_code", CENTER_ONLY_ERROR_CODE)
    .gte("spatial_accuracy_score", 0.95)
    .gte("spatial_median_iou", 0.85)
    .lt("spatial_center_inside_ratio", 0.98)
    .limit(MAX_QUERY_ROWS);
  const candidates = assertQuery(candidateResult, "center_only_query_failed");
  const contractIds = [...new Set([...manifestJobs, ...candidates].map((row) => row.contract_id))];
  const contracts = await fetchRowsByIds(
    db,
    "contracts",
    "id,status,pdf_url,document_processing_status,document_processing_error_code",
    contractIds,
    "contracts_query_failed",
  );
  const allJobsResult = await db.from("contract_document_jobs")
    .select("id,contract_id,created_at,status,recovery_of_job_id,recovery_reason_code,original_storage_path,original_sha256,downstream_ai_policy", { count: "exact" })
    .in("contract_id", contractIds)
    .limit(MAX_QUERY_ROWS);
  const allJobs = assertQuery(allJobsResult, "job_generations_query_failed");
  const latestIds = newestJobIds(allJobs);
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]));
  const manifestJobsById = new Map(manifestJobs.map((job) => [job.id.toLowerCase(), job]));
  const pendingRescanJobs = [];
  const alreadyMarkedRescanJobs = [];
  for (const entry of manifest.jobs) {
    const job = manifestJobsById.get(entry.jobId);
    const state = validateManifestEntryAgainstJob(
      entry,
      job,
      contractsById.get(job?.contract_id),
      latestIds,
    );
    if (state === "already_marked") alreadyMarkedRescanJobs.push(job);
    else pendingRescanJobs.push(job);
  }
  const safePlan = deriveSafeCenterOnlyPlan({
    candidates,
    allJobs,
    contracts,
    rescanJobIds: manifestJobIds,
  });
  return { manifestJobs, pendingRescanJobs, alreadyMarkedRescanJobs, safePlan };
}

async function readAndVerifyOriginal(db, job) {
  let downloaded;
  try {
    downloaded = await db.storage.from(CONTRACT_BUCKET).download(job.original_storage_path);
  } catch (error) {
    throw new OcrRecoveryError("source_download_failed", { cause: error });
  }
  if (downloaded?.error || !downloaded?.data) throw new OcrRecoveryError("source_download_failed");
  let bytes;
  try {
    bytes = Buffer.from(await downloaded.data.arrayBuffer());
  } catch (error) {
    throw new OcrRecoveryError("source_read_failed", { cause: error });
  }
  let actualHash;
  try {
    if (bytes.length < 5 || bytes.length > MAX_SOURCE_BYTES
      || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new OcrRecoveryError("source_pdf_invalid");
    }
    actualHash = createHash("sha256").update(bytes).digest("hex");
  } finally {
    bytes.fill(0);
  }
  if (actualHash !== job.original_sha256) throw new OcrRecoveryError("source_hash_mismatch");
}

async function verifyAllOriginals(db, jobs) {
  for (const job of jobs) await readAndVerifyOriginal(db, job);
}

function requireRescanRpcOutcome(result, jobId) {
  const row = result?.data?.[0];
  if (result?.error || !Array.isArray(result?.data) || result.data.length !== 1
    || row?.outcome !== "marked" || row?.job_id !== jobId) {
    throw new OcrRecoveryError("rescan_rpc_failed");
  }
}

function requireQueueRpcOutcome(result, sourceJobId) {
  const row = result?.data?.[0];
  if (result?.error || !Array.isArray(result?.data) || result.data.length !== 1
    || row?.outcome !== "queued" || row?.source_job_id !== sourceJobId
    || !isUuid(row?.recovery_job_id)
    || !["reanalyze", "preserve"].includes(row?.downstream_ai_policy)) {
    throw new OcrRecoveryError("recovery_queue_rpc_failed");
  }
}

async function markRescanJobs(db, manifest, pendingJobs) {
  const pendingIds = new Set(pendingJobs.map((job) => job.id.toLowerCase()));
  let marked = 0;
  for (const entry of manifest.jobs) {
    if (!pendingIds.has(entry.jobId)) continue;
    const result = await db.rpc("mark_contract_document_job_for_rescan", {
      p_job_id: entry.jobId,
      p_expected_error_code: entry.expectedErrorCode,
      p_expected_original_sha256: entry.expectedOriginalSha256,
      p_expected_spatial_accuracy_score: entry.expectedSpatialAccuracyScore,
      p_expected_spatial_median_iou: entry.expectedSpatialMedianIou,
      p_expected_spatial_center_inside_ratio: entry.expectedSpatialCenterInsideRatio,
      p_actor_user_id: null,
    });
    requireRescanRpcOutcome(result, entry.jobId);
    marked += 1;
  }
  return marked;
}

async function queueRecoveryJobs(db, jobs) {
  let queued = 0;
  for (const job of jobs) {
    const result = await db.rpc("queue_contract_document_job_recovery_generation", {
      p_source_job_id: job.id,
      p_expected_error_code: job.error_code,
      p_expected_original_sha256: job.original_sha256,
      p_expected_spatial_accuracy_score: Number(job.spatial_accuracy_score),
      p_expected_spatial_median_iou: Number(job.spatial_median_iou),
      p_expected_spatial_center_inside_ratio: Number(job.spatial_center_inside_ratio),
      p_recovery_reason_code: RECOVERY_REASON_CODE,
      p_priority: 1000,
    });
    requireQueueRpcOutcome(result, job.id);
    queued += 1;
  }
  return queued;
}

export function safeRecoverySummary({
  mode,
  hashesVerified,
  rescanAlreadyMarked = 0,
  rescanNewlyMarked = 0,
  recoveryAlreadyQueued = 0,
  queued = 0,
}) {
  return {
    mode,
    expected: { rescan: EXPECTED_RESCAN_COUNT, safeQueue: EXPECTED_SAFE_QUEUE_COUNT },
    verified: { originals: hashesVerified, rescan: EXPECTED_RESCAN_COUNT, safeQueue: EXPECTED_SAFE_QUEUE_COUNT },
    plan: {
      rescanAlreadyMarked,
      rescanToMark: EXPECTED_RESCAN_COUNT - rescanAlreadyMarked,
      recoveryAlreadyQueued,
      recoveryToQueue: EXPECTED_SAFE_QUEUE_COUNT - recoveryAlreadyQueued,
    },
    mutations: { rescanNewlyMarked, recoveryQueued: queued },
  };
}

export async function runRecovery({ db, manifest, mode }) {
  if (!db || !["dry-run", "execute"].includes(mode)) throw new OcrRecoveryError("invalid_runtime");
  const initialState = await fetchRecoveryState(db, manifest);
  await verifyAllOriginals(db, [...initialState.manifestJobs, ...initialState.safePlan.all]);
  if (mode === "dry-run") {
    return safeRecoverySummary({
      mode,
      hashesVerified: EXPECTED_RESCAN_COUNT + EXPECTED_SAFE_QUEUE_COUNT,
      rescanAlreadyMarked: initialState.alreadyMarkedRescanJobs.length,
      recoveryAlreadyQueued: initialState.safePlan.alreadyQueued.length,
    });
  }

  const newlyMarked = await markRescanJobs(db, manifest, initialState.pendingRescanJobs);
  // Re-read after the first guarded mutation. The five reviewed jobs must now
  // be excluded by review_disposition, and the exact 27-job plan must remain
  // identical before any recovery generation is created.
  const postMarkState = await fetchRecoveryState(db, manifest);
  if (postMarkState.alreadyMarkedRescanJobs.length !== EXPECTED_RESCAN_COUNT
    || postMarkState.pendingRescanJobs.length !== 0) {
    throw new OcrRecoveryError("rescan_mark_verification_failed");
  }
  const initialSafeIds = initialState.safePlan.all.map((job) => job.id).sort();
  const postMarkSafeIds = postMarkState.safePlan.all.map((job) => job.id).sort();
  if (JSON.stringify(initialSafeIds) !== JSON.stringify(postMarkSafeIds)) {
    throw new OcrRecoveryError("safe_queue_changed_after_rescan_mark");
  }
  const newlyQueued = await queueRecoveryJobs(db, postMarkState.safePlan.pending);
  return safeRecoverySummary({
    mode,
    hashesVerified: EXPECTED_RESCAN_COUNT + EXPECTED_SAFE_QUEUE_COUNT,
    rescanAlreadyMarked: initialState.alreadyMarkedRescanJobs.length,
    rescanNewlyMarked: newlyMarked,
    recoveryAlreadyQueued: initialState.safePlan.alreadyQueued.length,
    queued: newlyQueued,
  });
}

export function validateSupabaseConfiguration(url, serviceRoleKey) {
  if (typeof url !== "string" || typeof serviceRoleKey !== "string"
    || !url.trim() || !serviceRoleKey.trim()) {
    throw new OcrRecoveryError("missing_supabase_configuration");
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new OcrRecoveryError("invalid_supabase_url", { cause: error });
  }
  if (parsed.protocol !== "https:"
    || !/^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname)
    || parsed.username || parsed.password || parsed.port
    || (parsed.pathname !== "/" && parsed.pathname !== "")
    || parsed.search || parsed.hash) {
    throw new OcrRecoveryError("invalid_supabase_url");
  }
  return Object.freeze({ url: parsed.origin, serviceRoleKey: serviceRoleKey.trim() });
}

function createServiceClient(url, serviceRoleKey) {
  const configuration = validateSupabaseConfiguration(url, serviceRoleKey);
  return createClient(configuration.url, configuration.serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { "X-Client-Info": "dfks-ocr-recovery-operator" } },
  });
}

async function main() {
  const options = parseRecoveryArguments(process.argv.slice(2));
  loadEnv({ path: ".env.local", quiet: true });
  const manifest = await readSecureRescanManifest(options.manifestPath);
  const db = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const summary = await runRecovery({ db, manifest, mode: options.mode });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    const code = error instanceof OcrRecoveryError ? error.code : "ocr_recovery_failed";
    process.stderr.write(`${JSON.stringify({ error: code })}\n`);
    process.exitCode = 2;
  });
}
