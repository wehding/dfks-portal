import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatUserActionDescription } from "../lib/admin-dashboard";
import { resolvePostLoginDestination } from "../lib/auth/post-login";

test("formaterer brugerhandlinger korrekt til aktivitetsfeed", () => {
  assert.equal(
    formatUserActionDescription("complete_onboarding", "rettighedshavere", null),
    "Gennemførte onboarding i portalen"
  );
  assert.equal(
    formatUserActionDescription("create", "contracts", "Spillefilm 2026"),
    "Uploadede kontrakt: Spillefilm 2026"
  );
  assert.equal(
    formatUserActionDescription("link", "works", "Borgen S4"),
    "Forbandt værk til kontrakt: Borgen S4"
  );
  assert.equal(
    formatUserActionDescription("update", "member_profile", null),
    "Opdaterede sin medlemsprofil"
  );
});

test("sender superadmin direkte til /admin/insights efter login", async () => {
  const fakeSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            limit: async () => ({ data: [{ role: "superadmin" }] }),
          }),
          limit: () => ({
            maybeSingle: async () => ({ data: null }),
          }),
        }),
      }),
    }),
    auth: {
      getUser: async () => ({ data: { user: null } }),
    },
  };

  const dest = await resolvePostLoginDestination(fakeSupabase as unknown as SupabaseClient, "user-123", null);
  assert.equal(dest, "/admin/insights");
});

test("sender almindelig admin til /admin efter login", async () => {
  const fakeSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            limit: async () => ({ data: [{ role: "admin" }] }),
          }),
          limit: () => ({
            maybeSingle: async () => ({ data: null }),
          }),
        }),
      }),
    }),
    auth: {
      getUser: async () => ({ data: { user: null } }),
    },
  };

  const dest = await resolvePostLoginDestination(fakeSupabase as unknown as SupabaseClient, "user-456", null);
  assert.equal(dest, "/admin");
});

test("beregner nøglesiders loadhastighed og opdaterer ved nye målinger", async () => {
  const { getKeyPageTimingStats, recordPageTiming } = await import("../lib/server/key-page-timing-stats");
  const initial = getKeyPageTimingStats();
  assert.equal(initial.length, 4);
  assert(initial.some(p => p.key === "admin-contracts"));
  assert(initial.some(p => p.key === "admin-works"));
  assert(initial.some(p => p.key === "member-contracts"));
  assert(initial.some(p => p.key === "member-works"));

  recordPageTiming("admin-contracts", 120);
  recordPageTiming("admin-contracts", 180);

  const updated = getKeyPageTimingStats();
  const contracts = updated.find(p => p.key === "admin-contracts");
  assert.ok(contracts);
  assert.equal(contracts?.sampleCount, 2);
  assert.equal(contracts?.averageMs, 150);
  assert.equal(contracts?.status, "fast");
});
