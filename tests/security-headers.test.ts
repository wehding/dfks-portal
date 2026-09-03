import assert from "node:assert/strict";
import test from "node:test";
import { buildConnectSources } from "../next.config";

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
