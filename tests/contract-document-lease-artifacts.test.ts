import assert from "node:assert/strict";
import test from "node:test";

import {
  getRemovableLeaseArtifactPaths,
  parseContractDocumentLeaseArtifactPath,
} from "../lib/server/contract-document-lease-artifacts";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONTRACT_ID = "22222222-2222-4222-8222-222222222222";
const LEASE_ID = "33333333-3333-4333-8333-333333333333";
const OUTPUT = `${ORG_ID}/processed/${CONTRACT_ID}/leases/${LEASE_ID}/normalised.pdf`;
const SPATIAL = `${ORG_ID}/processed/${CONTRACT_ID}/leases/${LEASE_ID}/vision-layout.json.gz`;

test("selects only strict, unpromoted lease artifacts", () => {
  assert.deepEqual(getRemovableLeaseArtifactPaths({
    orgId: ORG_ID,
    contractId: CONTRACT_ID,
    leaseToken: LEASE_ID,
    outputStoragePath: OUTPUT,
    spatialDataPath: SPATIAL,
  }), [OUTPUT, SPATIAL]);
});

test("parses only the two strict lease artifact names", () => {
  assert.deepEqual(parseContractDocumentLeaseArtifactPath(OUTPUT), {
    orgId: ORG_ID,
    contractId: CONTRACT_ID,
    leaseToken: LEASE_ID,
    filename: "normalised.pdf",
  });
  assert.equal(parseContractDocumentLeaseArtifactPath(`${ORG_ID}/processed/${CONTRACT_ID}/leases/${LEASE_ID}/original.pdf`), null);
  assert.equal(parseContractDocumentLeaseArtifactPath(`${ORG_ID}/${CONTRACT_ID}/original.pdf`), null);
});

test("rejects an artifact from another lease", () => {
  assert.deepEqual(getRemovableLeaseArtifactPaths({
    orgId: ORG_ID,
    contractId: CONTRACT_ID,
    leaseToken: "66666666-6666-4666-8666-666666666666",
    outputStoragePath: OUTPUT,
    spatialDataPath: SPATIAL,
  }), []);
});

test("never selects the original, another contract or promoted derivatives", () => {
  assert.deepEqual(getRemovableLeaseArtifactPaths({
    orgId: ORG_ID,
    contractId: CONTRACT_ID,
    outputStoragePath: `${ORG_ID}/${CONTRACT_ID}/original.pdf`,
    spatialDataPath: SPATIAL,
    promotedSpatialPath: SPATIAL,
  }), []);
  assert.deepEqual(getRemovableLeaseArtifactPaths({
    orgId: ORG_ID,
    contractId: CONTRACT_ID,
    outputStoragePath: OUTPUT.replace(CONTRACT_ID, "44444444-4444-4444-8444-444444444444"),
    spatialDataPath: SPATIAL.replace(ORG_ID, "55555555-5555-4555-8555-555555555555"),
  }), []);
});
