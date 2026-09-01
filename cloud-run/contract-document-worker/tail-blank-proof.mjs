import { createHash, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { isAbsolute } from "node:path";

export const TAIL_BLANK_PROOF_SCHEMA_VERSION = "dfks-vision-v3-tail-blank-proof-v1";
export const TAIL_BLANK_RECOVERY_PROFILE = "dfks-run-bound-tail-blank-v1";
export const MAX_TAIL_BLANK_PROOF_ENTRIES = 8;
export const MAX_TAIL_BLANK_PROOF_BYTES = 16 * 1024;
export const EXPECTED_TAIL_BLANK_PROOF_ENTRIES = 5;

const MAX_PROOF_VALIDITY_MS = 48 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const parsedManifests = new WeakMap();
const proofTokens = new WeakMap();

export class TailBlankProofError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "TailBlankProofError";
    this.code = code;
  }
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length
    && actual.every((key, index) => key === required[index]);
}

export function timingSafeSha256Equal(left, right) {
  if (!SHA256_PATTERN.test(left ?? "") || !SHA256_PATTERN.test(right ?? "")) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function canonicalEntries(entries) {
  return [...entries].sort((left, right) => (
    left.originalSha256.localeCompare(right.originalSha256)
      || left.pageNumber - right.pageNumber
      || left.pageCount - right.pageCount
      || left.sourceRasterSha256.localeCompare(right.sourceRasterSha256)
      || left.recoveryRasterSha256.localeCompare(right.recoveryRasterSha256)
  ));
}

function canonicalManifestPayload({ schemaVersion, runId, expiresAt, entries }) {
  return JSON.stringify({
    schemaVersion,
    runId,
    expiresAt,
    entries: canonicalEntries(entries).map((entry) => ({
      originalSha256: entry.originalSha256,
      pageNumber: entry.pageNumber,
      pageCount: entry.pageCount,
      sourceRasterSha256: entry.sourceRasterSha256,
      recoveryRasterSha256: entry.recoveryRasterSha256,
    })),
  });
}

export function tailBlankProofManifestDigest(value) {
  return createHash("sha256").update(canonicalManifestPayload(value), "utf8").digest("hex");
}

export function createTailBlankProofManifest({ runId, expiresAt, entries }) {
  const unsigned = {
    schemaVersion: TAIL_BLANK_PROOF_SCHEMA_VERSION,
    runId,
    expiresAt,
    entries: canonicalEntries(entries ?? []),
  };
  return {
    ...unsigned,
    manifestDigest: tailBlankProofManifestDigest(unsigned),
  };
}

function requireValidEntry(entry) {
  if (!hasExactKeys(entry, [
    "originalSha256",
    "pageNumber",
    "pageCount",
    "sourceRasterSha256",
    "recoveryRasterSha256",
  ])
    || !SHA256_PATTERN.test(entry.originalSha256 ?? "")
    || !SHA256_PATTERN.test(entry.sourceRasterSha256 ?? "")
    || !SHA256_PATTERN.test(entry.recoveryRasterSha256 ?? "")
    || !Number.isSafeInteger(entry.pageNumber)
    || !Number.isSafeInteger(entry.pageCount)
    || entry.pageCount < 2
    || entry.pageCount > 200
    || entry.pageNumber !== entry.pageCount) {
    throw new TailBlankProofError("tail_blank_proof_invalid");
  }
  return Object.freeze({ ...entry });
}

export function parseTailBlankProofManifest(raw, {
  executionMode,
  expectedRunId,
  now = Date.now(),
  requireUnexpired = true,
} = {}) {
  if (raw == null || raw === "") return null;
  if (executionMode !== "backfill" && executionMode !== "audit") {
    throw new TailBlankProofError("tail_blank_proof_forbidden");
  }
  if (executionMode === "backfill" && requireUnexpired !== true) {
    throw new TailBlankProofError("tail_blank_proof_forbidden");
  }
  if (!UUID_PATTERN.test(expectedRunId ?? "")) {
    throw new TailBlankProofError("tail_blank_proof_run_mismatch");
  }
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_TAIL_BLANK_PROOF_BYTES) {
    throw new TailBlankProofError("tail_blank_proof_invalid");
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new TailBlankProofError("tail_blank_proof_invalid");
  }
  if (!hasExactKeys(value, [
    "schemaVersion", "runId", "expiresAt", "entries", "manifestDigest",
  ])
    || value.schemaVersion !== TAIL_BLANK_PROOF_SCHEMA_VERSION
    || value.runId !== expectedRunId
    || !UUID_PATTERN.test(value.runId ?? "")
    || !SHA256_PATTERN.test(value.manifestDigest ?? "")
    || !Array.isArray(value.entries)
    || value.entries.length < 1
    || value.entries.length > MAX_TAIL_BLANK_PROOF_ENTRIES
    || (executionMode === "backfill"
      && value.entries.length !== EXPECTED_TAIL_BLANK_PROOF_ENTRIES)) {
    throw new TailBlankProofError("tail_blank_proof_invalid");
  }
  const expiresAtMs = Date.parse(value.expiresAt);
  if (!Number.isFinite(expiresAtMs)
    || new Date(expiresAtMs).toISOString() !== value.expiresAt) {
    throw new TailBlankProofError("tail_blank_proof_invalid");
  }
  if (requireUnexpired
    && (expiresAtMs <= now || expiresAtMs > now + MAX_PROOF_VALIDITY_MS)) {
    throw new TailBlankProofError("tail_blank_proof_expired");
  }
  const entries = value.entries.map(requireValidEntry);
  const proofKeys = new Set();
  for (const entry of entries) {
    const key = `${entry.originalSha256}:${entry.pageNumber}:${entry.pageCount}`;
    if (proofKeys.has(key)) throw new TailBlankProofError("tail_blank_proof_duplicate");
    proofKeys.add(key);
  }
  const expectedDigest = tailBlankProofManifestDigest({ ...value, entries });
  if (!timingSafeSha256Equal(value.manifestDigest, expectedDigest)) {
    throw new TailBlankProofError("tail_blank_proof_digest_mismatch");
  }
  const parsed = Object.freeze({
    schemaVersion: value.schemaVersion,
    runId: value.runId,
    expiresAt: value.expiresAt,
    entries: Object.freeze(canonicalEntries(entries)),
    manifestDigest: value.manifestDigest,
  });
  parsedManifests.set(parsed, Object.freeze({ executionMode, requireUnexpired }));
  return parsed;
}

export function readTailBlankProofManifestFile(path, options = {}) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) {
    throw new TailBlankProofError("tail_blank_proof_file_invalid");
  }
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    throw new TailBlankProofError("tail_blank_proof_file_unavailable", { cause: error });
  }
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size < 1 || info.size > MAX_TAIL_BLANK_PROOF_BYTES
      || (info.mode & 0o222) !== 0) {
      throw new TailBlankProofError("tail_blank_proof_file_invalid");
    }
    const raw = readFileSync(descriptor, "utf8");
    return parseTailBlankProofManifest(raw, options);
  } catch (error) {
    if (error instanceof TailBlankProofError) throw error;
    throw new TailBlankProofError("tail_blank_proof_file_unavailable", { cause: error });
  } finally {
    closeSync(descriptor);
  }
}

export function hasTailBlankProofCandidate(manifest, {
  runId,
  originalSha256,
  pageNumber,
  pageCount,
  now = Date.now(),
} = {}) {
  const manifestMetadata = parsedManifests.get(manifest);
  if (!manifestMetadata
    || manifest.runId !== runId
    || !SHA256_PATTERN.test(originalSha256 ?? "")
    || !Number.isSafeInteger(pageNumber)
    || !Number.isSafeInteger(pageCount)
    || !Number.isFinite(now)
    || (manifestMetadata.executionMode === "backfill"
      && manifestMetadata.requireUnexpired
      && Date.parse(manifest.expiresAt) <= now)) return false;
  return manifest.entries.some((entry) => (
    entry.pageNumber === pageNumber
      && entry.pageCount === pageCount
      && timingSafeSha256Equal(entry.originalSha256, originalSha256)
  ));
}

export function authoriseTailBlankProof(manifest, {
  runId,
  originalSha256,
  pageNumber,
  pageCount,
  sourceRasterBytes,
  recoveryRasterBytes,
  now = Date.now(),
} = {}) {
  if (!hasTailBlankProofCandidate(manifest, {
    runId, originalSha256, pageNumber, pageCount, now,
  })
    || !(sourceRasterBytes instanceof Uint8Array)
    || sourceRasterBytes.byteLength < 1
    || !(recoveryRasterBytes instanceof Uint8Array)
    || recoveryRasterBytes.byteLength < 1) return null;
  const sourceRasterSha256 = createHash("sha256").update(sourceRasterBytes).digest("hex");
  const recoveryRasterSha256 = createHash("sha256").update(recoveryRasterBytes).digest("hex");
  const entry = manifest.entries.find((candidate) => (
    candidate.pageNumber === pageNumber
      && candidate.pageCount === pageCount
      && timingSafeSha256Equal(candidate.originalSha256, originalSha256)
      && timingSafeSha256Equal(candidate.sourceRasterSha256, sourceRasterSha256)
      && timingSafeSha256Equal(candidate.recoveryRasterSha256, recoveryRasterSha256)
  ));
  if (!entry) return null;
  const token = Object.freeze(Object.create(null));
  proofTokens.set(token, Object.freeze({
    pageNumber,
    pageCount,
    profile: TAIL_BLANK_RECOVERY_PROFILE,
    manifestDigest: manifest.manifestDigest,
    executionMode: parsedManifests.get(manifest).executionMode,
    expiresAt: manifest.expiresAt,
  }));
  return token;
}

export function isTailBlankProofToken(token, {
  pageNumber,
  pageCount,
  now = Date.now(),
} = {}) {
  const metadata = proofTokens.get(token);
  return metadata?.executionMode === "backfill"
    && metadata.pageNumber === pageNumber
    && metadata.pageCount === pageCount
    && Number.isFinite(now)
    && Date.parse(metadata.expiresAt) > now;
}

export function tailBlankRecoveryMarker(token, { now = Date.now() } = {}) {
  const metadata = proofTokens.get(token);
  if (!metadata
    || !Number.isFinite(now)
    || (metadata.executionMode === "backfill"
      && Date.parse(metadata.expiresAt) <= now)) return null;
  return Object.freeze({
    profile: metadata.profile,
    manifestDigest: metadata.manifestDigest,
    pageNumber: metadata.pageNumber,
  });
}
