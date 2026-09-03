import assert from "node:assert/strict";
import test from "node:test";
import { buildConnectSources, buildFrameSources } from "../next.config";

test("CSP tillader kun lokal HTTP-Supabase på loopback-adresser", () => {
  assert.deepEqual(buildConnectSources(undefined), ["'self'", "https:"]);
  assert.deepEqual(buildConnectSources("https://example.supabase.co"), ["'self'", "https:"]);
  assert.deepEqual(buildConnectSources("http://supabase.internal:54321"), ["'self'", "https:"]);
  assert.deepEqual(buildConnectSources("ikke-en-url"), ["'self'", "https:"]);
  assert.deepEqual(buildConnectSources("http://127.0.0.1:54321"), [
    "'self'",
    "https:",
    "http://127.0.0.1:54321",
    "ws://127.0.0.1:54321",
  ]);
  assert.deepEqual(buildConnectSources("http://localhost:54321"), [
    "'self'",
    "https:",
    "http://localhost:54321",
    "ws://localhost:54321",
  ]);
});

test("frame-src tillader blob-preview og Supabase Storage signed URLs", () => {
  assert.deepEqual(buildFrameSources(undefined), ["'self'", "blob:"]);
  assert.deepEqual(buildFrameSources("ikke-en-url"), ["'self'", "blob:"]);
  assert.deepEqual(buildFrameSources("https://icxywdymyaxluaxxcpye.supabase.co"), [
    "'self'",
    "blob:",
    "https://icxywdymyaxluaxxcpye.supabase.co",
  ]);
  assert.deepEqual(buildFrameSources("http://localhost:54321"), [
    "'self'",
    "blob:",
    "http://localhost:54321",
  ]);
});
