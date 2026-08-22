import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { applyAuthResponse, PRIVATE_AUTH_RESPONSE_HEADERS } from "../lib/supabase/auth-response";
import { classifyRequestAuthFailure, verifyRequestUser } from "../lib/supabase/request-auth";
import type { SupabaseClient } from "@supabase/supabase-js";

test("manglende eller ugyldig session klassificeres som 401", () => {
  assert.equal(classifyRequestAuthFailure(null), 401);
  assert.equal(classifyRequestAuthFailure({ status: 401 }), 401);
  assert.equal(classifyRequestAuthFailure({ status: 400 }), 401);
});

test("midlertidige auth-fejl klassificeres som 503", () => {
  assert.equal(classifyRequestAuthFailure({ status: 0 }), 503);
  assert.equal(classifyRequestAuthFailure({ status: 429 }), 503);
  assert.equal(classifyRequestAuthFailure({ status: 500 }), 503);
  assert.equal(classifyRequestAuthFailure({}), 503);
});

test("verificeret bruger returneres uden at skjule identiteten i resolveren", async () => {
  const db = {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    },
  } as unknown as SupabaseClient;

  assert.deepEqual(await verifyRequestUser(db), { ok: true, userId: "user-1" });
});

test("manglende session og midlertidig auth-fejl får forskellige svar", async () => {
  const unauthenticated = {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  } as unknown as SupabaseClient;
  const unavailable = {
    auth: {
      getUser: async () => ({ data: { user: null }, error: { status: 503 } }),
    },
  } as unknown as SupabaseClient;

  assert.deepEqual(await verifyRequestUser(unauthenticated), {
    ok: false,
    status: 401,
    error: "Du er ikke logget ind",
  });
  assert.deepEqual(await verifyRequestUser(unavailable), {
    ok: false,
    status: 503,
    error: "Login kunne ikke bekræftes. Prøv igen.",
  });
});

test("auth-cookies ledsages altid af private no-cache headers", () => {
  const response = applyAuthResponse(
    NextResponse.json({ ok: true }),
    [{ name: "sb-test-auth-token", value: "token", options: { httpOnly: true, path: "/" } }],
  );

  assert.equal(response.cookies.get("sb-test-auth-token")?.value, "token");
  for (const [name, value] of Object.entries(PRIVATE_AUTH_RESPONSE_HEADERS)) {
    assert.equal(response.headers.get(name), value);
  }
});

test("Supabase-responsens obligatoriske headers bevares", () => {
  const response = applyAuthResponse(
    NextResponse.json({ ok: true }),
    [],
    { ...PRIVATE_AUTH_RESPONSE_HEADERS, "X-Auth-Test": "bevaret" },
  );

  assert.equal(response.headers.get("X-Auth-Test"), "bevaret");
  assert.equal(response.headers.get("Cache-Control"), PRIVATE_AUTH_RESPONSE_HEADERS["Cache-Control"]);
});
