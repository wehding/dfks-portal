import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260831192845_audit_event_subjects_v2.sql", import.meta.url),
  "utf8",
);
const auditServer = fs.readFileSync(new URL("../lib/audit-log-server.ts", import.meta.url), "utf8");
const auditAccess = fs.readFileSync(new URL("../lib/audit-access-server.ts", import.meta.url), "utf8");

test("audit subject links are immutable and browser roles cannot append them", () => {
  assert.match(migration, /create table public\.audit_event_subjects/i);
  assert.match(migration, /audit_event_subjects_immutable/i);
  assert.match(migration, /revoke all on function public\.append_audit_event_v2[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /revoke insert, update, delete on public\.audit_event_subjects from service_role/i);
});

test("multi-member relations are cryptographically bound to the semantic event", () => {
  assert.match(migration, /audit_subject_set_hash/i);
  assert.match(migration, /verify_audit_event_subjects/i);
  assert.match(migration, /array_agg\(distinct value order by value\)/i);
});

test("server audit helpers accept all affected member UUIDs", () => {
  assert.match(auditServer, /targetMemberUuids\?: string\[\]/);
  assert.match(auditServer, /append_audit_event_v2/);
  assert.match(auditAccess, /targetMemberUuids: input\.targetMemberUuids/);
});
