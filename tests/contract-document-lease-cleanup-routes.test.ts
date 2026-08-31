import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function routeSource(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("completion promoverer før den service-role-afgrænsede artefaktsletning", () => {
  const source = routeSource("app/api/internal/document-processing/complete/route.ts");
  assert.match(source, /finish_contract_document_job_v6/);
  assert.match(source, /p_spatial_sha256:\s*safeHash\(body\.spatialSha256\)/);
  assert.doesNotMatch(source, /\.storage\.from\(["']kontrakter["']\)\.remove\(/);
  assert.ok(source.indexOf("finish_contract_document_job_v6")
    < source.lastIndexOf("processContractDocumentArtifactDeletions"));
  const deletionHelper = routeSource("lib/server/contract-document-artifact-deletions.ts");
  assert.match(deletionHelper, /parseContractDocumentLeaseArtifactPath/);
  assert.match(deletionHelper, /\.storage\.from\(["']kontrakter["']\)\.remove\(\[storagePath\]\)/);
  assert.match(deletionHelper, /finish_contract_document_artifact_deletion/);
});

test("uploadautorisation registreres atomisk og sletter aldrig et aktivt lease-artefakt", () => {
  const source = routeSource("app/api/internal/document-processing/upload-authorisation/route.ts");
  assert.match(source, /authorise_contract_document_job_upload/);
  assert.doesNotMatch(source, /\.storage\.from\(["']kontrakter["']\)\.remove\(/);
});

test("claim bruger kun den databasegodkendte karantæne-GC til storage-oprydning", () => {
  const source = routeSource("app/api/internal/document-processing/claim/route.ts");
  const gcIndex = source.indexOf("list_abandoned_contract_document_lease_artifacts");
  const claimIndex = source.indexOf("claim_next_contract_document_job");
  assert.ok(gcIndex >= 0 && claimIndex > gcIndex);
  assert.equal(source.match(/\.storage\.from\(["']kontrakter["']\)\.remove\(/g)?.length, 1);
  assert.doesNotMatch(source, /remove\(\[outputUploadPath, spatialUploadPath\]\)/);
});

test("karantæne-GC er parallel, tidsbegrænset og afbryder hængende Supabase-kald", () => {
  const route = routeSource("app/api/internal/document-processing/claim/route.ts");
  const serviceClient = routeSource("lib/supabase/service.ts");
  assert.match(route, /const CLEANUP_TIMEOUT_MS = 2_000/);
  assert.match(route, /cleanupAbortController\.abort\(\)/);
  assert.match(route, /AbortSignal\.any\(\[signal, init\.signal\]\)/);
  assert.match(route, /Promise\.all\(\[claim, cleanup\]\)/);
  assert.doesNotMatch(route, /await cleanupAbandonedLeaseArtifacts\(db\)/);
  assert.match(serviceClient, /fetch\?: typeof globalThis\.fetch/);
  assert.match(serviceClient, /global: globalOptions/);
});
