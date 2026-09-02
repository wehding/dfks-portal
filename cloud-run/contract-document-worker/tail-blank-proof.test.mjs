import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  authoriseTailBlankProof,
  createTailBlankProofManifest,
  hasTailBlankProofCandidate,
  isTailBlankProofToken,
  MAX_TAIL_BLANK_PROOF_ENTRIES,
  parseTailBlankProofManifest,
  readTailBlankProofManifestFile,
  tailBlankRecoveryMarker,
  TailBlankProofError,
} from "./tail-blank-proof.mjs";

const RUN_ID = "33333333-3333-4333-8333-333333333333";
const ORIGINAL_HASH = "1".repeat(64);
const SOURCE_BYTES = Buffer.from("synthetic-source-raster");
const RECOVERY_BYTES = Buffer.from("synthetic-recovery-raster");

function proofEntries(first = {
  originalSha256: ORIGINAL_HASH,
  pageNumber: 8,
  pageCount: 8,
  sourceRasterSha256: "2".repeat(64),
  recoveryRasterSha256: "3".repeat(64),
}) {
  return [first, ...[4, 5, 6, 7].map((digit, index) => ({
    originalSha256: String(digit).repeat(64),
    pageNumber: 9 + index,
    pageCount: 9 + index,
    sourceRasterSha256: String(digit + 1).repeat(64),
    recoveryRasterSha256: String(digit + 2).repeat(64),
  }))];
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function manifest(overrides = {}) {
  const now = Date.parse("2026-09-01T12:00:00.000Z");
  return createTailBlankProofManifest({
    runId: RUN_ID,
    expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    entries: proofEntries(),
    ...overrides,
  });
}

function parse(value, overrides = {}) {
  return parseTailBlankProofManifest(JSON.stringify(value), {
    executionMode: "backfill",
    expectedRunId: RUN_ID,
    now: Date.parse("2026-09-01T12:00:00.000Z"),
    ...overrides,
  });
}

test("proof-manifest kræver eksakt schema, run, udløb og digest", () => {
  const valid = manifest();
  assert.equal(parse(valid).manifestDigest, valid.manifestDigest);
  for (const invalid of [
    { ...valid, schemaVersion: "legacy" },
    { ...valid, runId: "44444444-4444-4444-8444-444444444444" },
    { ...valid, expiresAt: "ikke-en-dato" },
    { ...valid, manifestDigest: "0".repeat(64) },
    { ...valid, extra: true },
  ]) {
    assert.throws(() => parse(invalid), TailBlankProofError);
  }
  assert.throws(() => parse(valid, {
    now: Date.parse(valid.expiresAt),
  }), (error) => error.code === "tail_blank_proof_expired");
  assert.throws(() => parseTailBlankProofManifest(JSON.stringify(valid), {
    executionMode: "service",
    expectedRunId: RUN_ID,
  }), (error) => error.code === "tail_blank_proof_forbidden");
  assert.throws(() => parseTailBlankProofManifest(JSON.stringify(valid), {
    executionMode: "backfill",
    expectedRunId: RUN_ID,
    requireUnexpired: false,
  }), (error) => error.code === "tail_blank_proof_forbidden");
});

test("proof-manifest afviser dubletter, ikke-final sider og ubundet størrelse", () => {
  const entry = manifest().entries[0];
  assert.throws(() => parse(createTailBlankProofManifest({
    runId: RUN_ID,
    expiresAt: manifest().expiresAt,
    entries: proofEntries().slice(0, 4),
  })), (error) => error.code === "tail_blank_proof_invalid");
  assert.throws(() => parse(createTailBlankProofManifest({
    runId: RUN_ID,
    expiresAt: manifest().expiresAt,
    entries: [entry, entry, ...proofEntries().slice(2)],
  })), (error) => error.code === "tail_blank_proof_duplicate");
  assert.throws(() => parse(createTailBlankProofManifest({
    runId: RUN_ID,
    expiresAt: manifest().expiresAt,
    entries: proofEntries({ ...entry, pageNumber: 7 }),
  })), (error) => error.code === "tail_blank_proof_invalid");
  assert.throws(() => parse(createTailBlankProofManifest({
    runId: RUN_ID,
    expiresAt: manifest().expiresAt,
    entries: Array.from({ length: MAX_TAIL_BLANK_PROOF_ENTRIES + 1 }, (_, index) => ({
      ...entry,
      originalSha256: index.toString(16).padStart(64, "0"),
    })),
  })), (error) => error.code === "tail_blank_proof_invalid");
});

test("proof-token kræver alle fem eksakte bindinger og skjuler rå hashes", () => {
  const sourceHash = sha256Hex(SOURCE_BYTES);
  const recoveryHash = sha256Hex(RECOVERY_BYTES);
  const parsed = parse(createTailBlankProofManifest({
    runId: RUN_ID,
    expiresAt: manifest().expiresAt,
    entries: proofEntries({
      originalSha256: ORIGINAL_HASH,
      pageNumber: 8,
      pageCount: 8,
      sourceRasterSha256: sourceHash,
      recoveryRasterSha256: recoveryHash,
    }),
  }));
  assert.equal(hasTailBlankProofCandidate(parsed, {
    runId: RUN_ID,
    originalSha256: ORIGINAL_HASH,
    pageNumber: 8,
    pageCount: 8,
    now: Date.parse("2026-09-01T12:30:00.000Z"),
  }), true);
  assert.equal(hasTailBlankProofCandidate(parsed, {
    runId: RUN_ID,
    originalSha256: ORIGINAL_HASH,
    pageNumber: 8,
    pageCount: 8,
    now: Date.parse(manifest().expiresAt),
  }), false);
  const token = authoriseTailBlankProof(parsed, {
    runId: RUN_ID,
    originalSha256: ORIGINAL_HASH,
    pageNumber: 8,
    pageCount: 8,
    sourceRasterBytes: SOURCE_BYTES,
    recoveryRasterBytes: RECOVERY_BYTES,
    now: Date.parse("2026-09-01T12:30:00.000Z"),
  });
  assert.equal(isTailBlankProofToken(token, {
    pageNumber: 8,
    pageCount: 8,
    now: Date.parse("2026-09-01T12:30:00.000Z"),
  }), true);
  assert.equal(isTailBlankProofToken(token, { pageNumber: 7, pageCount: 8 }), false);
  assert.equal(isTailBlankProofToken(token, {
    pageNumber: 8,
    pageCount: 8,
    now: Date.parse(manifest().expiresAt),
  }), false);
  const marker = tailBlankRecoveryMarker(token, {
    now: Date.parse("2026-09-01T12:30:00.000Z"),
  });
  assert.deepEqual(Object.keys(marker).sort(), ["manifestDigest", "pageNumber", "profile"]);
  assert.equal(JSON.stringify(marker).includes(ORIGINAL_HASH), false);
  assert.equal(authoriseTailBlankProof(parsed, {
    runId: RUN_ID,
    originalSha256: ORIGINAL_HASH,
    pageNumber: 8,
    pageCount: 8,
    sourceRasterBytes: Buffer.from("wrong"),
    recoveryRasterBytes: RECOVERY_BYTES,
    now: Date.parse("2026-09-01T12:30:00.000Z"),
  }), null);
});

test("audit kan verificere et historisk proof efter udløb uden at genåbne backfill", () => {
  const sourceHash = sha256Hex(SOURCE_BYTES);
  const recoveryHash = sha256Hex(RECOVERY_BYTES);
  const value = createTailBlankProofManifest({
    runId: RUN_ID,
    expiresAt: manifest().expiresAt,
    entries: [{
      originalSha256: ORIGINAL_HASH,
      pageNumber: 8,
      pageCount: 8,
      sourceRasterSha256: sourceHash,
      recoveryRasterSha256: recoveryHash,
    }],
  });
  const parsed = parseTailBlankProofManifest(JSON.stringify(value), {
    executionMode: "audit",
    expectedRunId: RUN_ID,
    requireUnexpired: false,
  });
  const token = authoriseTailBlankProof(parsed, {
    runId: RUN_ID,
    originalSha256: ORIGINAL_HASH,
    pageNumber: 8,
    pageCount: 8,
    sourceRasterBytes: SOURCE_BYTES,
    recoveryRasterBytes: RECOVERY_BYTES,
    now: Date.parse("2030-01-01T00:00:00.000Z"),
  });
  assert.equal(isTailBlankProofToken(token, { pageNumber: 8, pageCount: 8 }), false);
  assert.deepEqual(tailBlankRecoveryMarker(token), {
    profile: "dfks-run-bound-tail-blank-v1",
    manifestDigest: value.manifestDigest,
    pageNumber: 8,
  });
});

test("privat manifestfil læses bounded uden at dens indhold logges", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dfks-tail-proof-"));
  const path = join(directory, "proof.json");
  const symlinkPath = join(directory, "proof-link.json");
  try {
    await writeFile(path, JSON.stringify(manifest()), { mode: 0o400 });
    const parsed = readTailBlankProofManifestFile(path, {
      executionMode: "audit",
      expectedRunId: RUN_ID,
      requireUnexpired: false,
    });
    assert.equal(parsed.runId, RUN_ID);
    await symlink(path, symlinkPath);
    assert.throws(() => readTailBlankProofManifestFile(symlinkPath, {
      executionMode: "audit",
      expectedRunId: RUN_ID,
      requireUnexpired: false,
    }), (error) => error.code === "tail_blank_proof_file_unavailable");
    assert.throws(() => readTailBlankProofManifestFile("relative-proof.json", {
      executionMode: "audit",
      expectedRunId: RUN_ID,
      requireUnexpired: false,
    }), (error) => error.code === "tail_blank_proof_file_invalid");
    await chmod(path, 0o600);
    assert.throws(() => readTailBlankProofManifestFile(path, {
      executionMode: "audit",
      expectedRunId: RUN_ID,
      requireUnexpired: false,
    }), (error) => error.code === "tail_blank_proof_file_invalid");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
