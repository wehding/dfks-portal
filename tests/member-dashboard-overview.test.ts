import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("rettighedstjek markeres kun efter audit og med egen organisationsrelation", async () => {
  const action = await source("app/actions/member-rights.ts");
  const migration = await source("supabase/migrations/20260902211659_member_dashboard_and_work_overview.sql");
  const auditPosition = action.indexOf("await recordSensitiveFlow");
  const markerPosition = action.indexOf('db.rpc("mark_member_economy_overview_viewed"');
  assert.ok(auditPosition > 0 && markerPosition > auditPosition);
  assert.match(migration, /holder\.user_id = p_user_id/);
  assert.match(migration, /affiliation\.org_id = p_org_id/);
  assert.match(migration, /coalesce\(affiliation\.economy_overview_viewed_at, now\(\)\)/);
  assert.match(migration, /revoke all on function public\.mark_member_economy_overview_viewed[\s\S]*authenticated/);
  assert.match(migration, /grant execute[\s\S]*mark_member_economy_overview_viewed[\s\S]*service_role/);
});

test("tidligere vellykkede økonomilæsninger backfilles uden at blande organisationer", async () => {
  const migration = await source("supabase/migrations/20260902211659_member_dashboard_and_work_overview.sql");
  assert.match(migration, /event\.system_component = 'portal\.rights\.allocations'/);
  assert.match(migration, /event\.outcome = 'success'/);
  assert.match(migration, /affiliation\.org_id = prior_views\.org_id/);
  assert.match(migration, /affiliation\.rights_holder_id = prior_views\.rights_holder_id/);
});

test("Mine værker RPC er server-only og returnerer kun sideoversigt", async () => {
  const migration = await source("supabase/migrations/20260902211659_member_dashboard_and_work_overview.sql");
  assert.match(migration, /create or replace function public\.list_member_work_overview_page/);
  assert.match(migration, /legacy_required_work_ids uuid\[\]/);
  assert.match(migration, /legacy_declared_work_ids uuid\[\]/);
  assert.match(migration, /revoke all on function public\.list_member_work_overview_page[\s\S]*authenticated/);
  assert.match(migration, /grant execute[\s\S]*list_member_work_overview_page[\s\S]*service_role/);
  assert.doesNotMatch(migration.slice(migration.indexOf("create or replace function public.list_member_work_overview_page")), /work_change_request_comments[^;]*message/);
});
