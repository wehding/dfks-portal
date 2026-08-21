import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  deliveryRequest,
  safeSecretEqual,
  sha256,
  stableStringify,
  verifyKmsSha256Signature,
  wormObjectName,
} from "./siem.mjs";

test("canonical JSON is stable across property order", () => {
  assert.equal(stableStringify({ b: 2, a: { d: 4, c: 3 } }), stableStringify({ a: { c: 3, d: 4 }, b: 2 }));
});

test("canonical delivery hash does not change when object keys are reordered", () => {
  const first = { schemaVersion: 2, events: [{ action: "read", sequence_no: 1 }] };
  const second = { events: [{ sequence_no: 1, action: "read" }], schemaVersion: 2 };
  assert.equal(sha256(stableStringify(first)), sha256(stableStringify(second)));
});

test("WORM object path is deterministic for the evidence date", () => {
  const date = new Date("2026-08-20T23:59:59Z");
  assert.equal(
    wormObjectName("events", 10, 20, "delivery-id", date),
    "v1/events/2026/08/20/10-20-delivery-id.json",
  );
});

test("hashing is deterministic and secret comparison is timing safe", () => {
  assert.equal(sha256("audit"), sha256("audit"));
  assert.equal(safeSecretEqual("same-secret", "same-secret"), true);
  assert.equal(safeSecretEqual("wrong", "same-secret"), false);
});

test("delivery uses a stable idempotency key without exposing event ids", () => {
  const request = deliveryRequest("generic", "https://siem.example.invalid/intake", "token", {
    payload: { batchId: "batch-a", deliveryId: "delivery-a", events: [{ id: "event-a" }] },
    integrity: { signature: "signature" },
  });
  assert.equal(request.headers["idempotency-key"], "delivery-a");
  assert.equal(request.headers["x-dfks-batch-id"], "batch-a");
  assert.equal(request.headers.authorization, "Bearer token");
});

test("KMS P-256 signatures are verified against canonical payload bytes", () => {
  const payload = { schemaVersion: 2, events: [{ sequence_no: 1, action: "read" }] };
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const signature = sign("sha256", Buffer.from(stableStringify(payload)), privateKey);

  assert.equal(
    verifyKmsSha256Signature(
      { events: [{ action: "read", sequence_no: 1 }], schemaVersion: 2 },
      publicKey.export({ type: "spki", format: "pem" }),
      signature,
    ),
    true,
  );
});
