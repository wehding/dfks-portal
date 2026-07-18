import test from "node:test";
import assert from "node:assert/strict";
import { createClientId } from "../lib/client-id";

test("uses randomUUID when the browser provides it", () => {
  assert.equal(createClientId("co-editor", () => "uuid-123"), "uuid-123");
});

test("falls back when randomUUID is unavailable on an HTTP phone connection", () => {
  const id = createClientId("co-editor", () => undefined);
  assert.match(id, /^co-editor-\d+-\d+$/);
});

test("falls back when the browser rejects randomUUID", () => {
  const id = createClientId("co-editor", () => {
    throw new Error("randomUUID is unavailable");
  });
  assert.match(id, /^co-editor-\d+-\d+$/);
});
