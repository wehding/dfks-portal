import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  processClaimedContractUploadIntentCleanup,
  type ClaimedContractUploadIntentCleanup,
} from "../lib/server/contract-upload-intent-cleanup";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const FILE_ID = "33333333-3333-4333-8333-333333333333";

function claim(overrides: Partial<ClaimedContractUploadIntentCleanup> = {}): ClaimedContractUploadIntentCleanup {
  return {
    intent_id: "44444444-4444-4444-8444-444444444444",
    storage_path: `${ORG_ID}/${OWNER_ID}/${FILE_ID}.pdf`,
    contract_id: null,
    cleanup_claim_token: "55555555-5555-4555-8555-555555555555",
    cleanup_kind: "expired",
    ...overrides,
  };
}

test("et claimet udløbet objekt slettes og færdigmeldes med samme token", async () => {
  const removed: string[] = [];
  const completions: Array<{ token: string; success: boolean }> = [];
  const result = await processClaimedContractUploadIntentCleanup({
    claims: [claim()],
    removeStorageObject: async path => {
      removed.push(path);
      return { error: null };
    },
    finishClaim: async (claimedIntent, success) => {
      completions.push({ token: claimedIntent.cleanup_claim_token, success });
      return { completed: true, error: null };
    },
  });

  assert.deepEqual(removed, [`${ORG_ID}/${OWNER_ID}/${FILE_ID}.pdf`]);
  assert.deepEqual(completions, [{ token: "55555555-5555-4555-8555-555555555555", success: true }]);
  assert.equal(result.storageObjectsRemoved, 1);
  assert.equal(result.completed, 1);
});

test("en linked purge-tombstone færdigmeldes uden at slette kontraktens fil", async () => {
  let storageCalled = false;
  const result = await processClaimedContractUploadIntentCleanup({
    claims: [claim({
      contract_id: "66666666-6666-4666-8666-666666666666",
      cleanup_kind: "purge",
    })],
    removeStorageObject: async () => {
      storageCalled = true;
      return { error: null };
    },
    finishClaim: async (_claimedIntent, success) => ({ completed: success, error: null }),
  });

  assert.equal(storageCalled, false);
  assert.equal(result.storageObjectsRemoved, 0);
  assert.equal(result.completed, 1);
});

test("storagefejl frigiver claimet til sikkert retry", async () => {
  const finishedWith: boolean[] = [];
  const result = await processClaimedContractUploadIntentCleanup({
    claims: [claim()],
    removeStorageObject: async () => ({ error: new Error("storage unavailable") }),
    finishClaim: async (_claimedIntent, success) => {
      finishedWith.push(success);
      return { completed: true, error: null };
    },
  });

  assert.deepEqual(finishedWith, [false]);
  assert.equal(result.storageRemovalFailed, 1);
  assert.equal(result.completed, 0);
});

test("tabt completion-svar efter sletning bliver registreret til lease-retry", async () => {
  const result = await processClaimedContractUploadIntentCleanup({
    claims: [claim()],
    removeStorageObject: async () => ({ error: null }),
    finishClaim: async () => ({ completed: false, error: new Error("database unavailable") }),
  });

  assert.equal(result.storageObjectsRemoved, 1);
  assert.equal(result.completionFailed, 1);
  assert.equal(result.completed, 0);
});

test("en claim med ugyldig storage-sti kan aldrig udløse sletning", async () => {
  let called = false;
  const result = await processClaimedContractUploadIntentCleanup({
    claims: [claim({ storage_path: "../kontrakter/original.pdf" })],
    removeStorageObject: async () => {
      called = true;
      return { error: null };
    },
    finishClaim: async () => {
      called = true;
      return { completed: true, error: null };
    },
  });

  assert.equal(called, false);
  assert.equal(result.invalidClaims, 1);
});

test("worker-ruten sletter kun efter databaseclaim og færdigmelder tokenet", () => {
  const source = readFileSync(
    new URL("../app/api/contracts/jobs/process/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /claim_contract_upload_intent_cleanup/);
  assert.match(source, /finish_contract_upload_intent_cleanup/);
  assert.doesNotMatch(source, /\.from\(["']contract_upload_intents["']\)/);
});
