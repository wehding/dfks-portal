import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

type Candidate = {
  path: string;
  disposition: "instrument" | "delegate" | "exclude";
  status: "pending" | "implemented" | "activated" | "verified";
  rationale: string;
  owner: string;
  test: string;
  auditImplementation?: string;
};

const root = process.cwd();
const registry = JSON.parse(fs.readFileSync(path.join(root, "config/audit-coverage.json"), "utf8")) as {
  classificationGroups?: Array<Omit<Candidate, "path"> & { paths: Array<string | Pick<Candidate, "path" | "auditImplementation">> }>;
};

const candidates: Candidate[] = (registry.classificationGroups ?? []).flatMap(group =>
  group.paths.map(item => ({
    ...group,
    paths: undefined,
    ...(typeof item === "string" ? { path: item } : item),
  } as Candidate)),
);

test("alle 81 scannerfund har en entydig disposition", () => {
  assert.equal(candidates.length, 81);
  assert.equal(new Set(candidates.map(candidate => candidate.path)).size, 81);
  assert.deepEqual(
    Object.fromEntries(["instrument", "delegate", "exclude"].map(disposition => [
      disposition,
      candidates.filter(candidate => candidate.disposition === disposition).length,
    ])),
    { instrument: 68, delegate: 11, exclude: 2 },
  );
});

test("klassifikationer har ejer, begrundelse og en eksisterende testreference", () => {
  for (const candidate of candidates) {
    assert.ok(candidate.owner.trim(), `${candidate.path}: ejer mangler`);
    assert.ok(candidate.rationale.trim(), `${candidate.path}: begrundelse mangler`);
    assert.ok(fs.existsSync(path.join(root, candidate.path)), `${candidate.path}: kildefil mangler`);
    assert.ok(fs.existsSync(path.join(root, candidate.test)), `${candidate.path}: test mangler`);
  }
});

test("delegationer peger på en eksisterende semantisk auditimplementation", () => {
  for (const candidate of candidates.filter(item => item.disposition === "delegate")) {
    assert.ok(candidate.auditImplementation, `${candidate.path}: auditImplementation mangler`);
    const implementation = fs.readFileSync(path.join(root, candidate.auditImplementation!), "utf8");
    assert.match(implementation, /recordAuditEvent\(|withMemberDataAudit\(|recordSensitiveFlow\(/, `${candidate.path}: semantisk audit kan ikke findes`);
  }
});

test("instrumenterede kandidater har en semantisk auditgrænse", () => {
  for (const candidate of candidates.filter(item => item.disposition === "instrument")) {
    const source = fs.readFileSync(path.join(root, candidate.path), "utf8");
    assert.match(source, /(?:recordAuditEvent|withMemberDataAudit|recordSensitiveFlow)\s*\(/, `${candidate.path}: semantisk auditgrænse mangler`);
  }
});

test("kun tekniske OCR-undertrin er udeladt", () => {
  assert.deepEqual(
    candidates.filter(candidate => candidate.disposition === "exclude").map(candidate => candidate.path).sort(),
    [
      "app/api/internal/document-processing/heartbeat/route.ts",
      "app/api/internal/document-processing/upload-authorisation/route.ts",
    ],
  );
  for (const candidate of candidates.filter(item => item.disposition === "exclude")) {
    const source = fs.readFileSync(path.join(root, candidate.path), "utf8");
    assert.match(source, /verifyOcrCloudRunRequest/, `${candidate.path}: intern worker-godkendelse mangler`);
    assert.doesNotMatch(source, /(?:recordAuditEvent|withMemberDataAudit|recordSensitiveFlow)\s*\(/);
  }
});
