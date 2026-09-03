import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { addCalendarDays, formatBetaDate, renderBetaInviteTemplate, unknownBetaPlaceholders, validateBetaPeriod } from "../lib/beta-test";

test("betaperioden foreslår ti kalenderdage og formateres på dansk", () => {
  assert.equal(addCalendarDays("2026-09-02", 10), "2026-09-12");
  assert.equal(formatBetaDate("2026-09-02"), "02.09.2026");
});

test("betaskabelonen erstatter alle understøttede pladsholdere", () => {
  assert.equal(renderBetaInviteTemplate("{navn} · {organisation} · {startdato}–{slutdato} · {invitationslink}", {
    name: "Testperson", organisation: "DFKS", startDate: "2026-09-02", endDate: "2026-09-12", invitationLink: "https://example.test/invite",
  }), "Testperson · DFKS · 02.09.2026–12.09.2026 · https://example.test/invite");
  assert.deepEqual(unknownBetaPlaceholders("{navn} {forkert}", "{ukendt}"), ["forkert", "ukendt"]);
});

test("betaperioden kræver en senere slutdato og højst 365 dage", () => {
  assert.throws(() => validateBetaPeriod("2026-09-02", "2026-09-02"));
  assert.throws(() => validateBetaPeriod("2026-09-02", "2027-09-03"));
  assert.doesNotThrow(() => validateBetaPeriod("2026-09-02", "2027-09-02"));
});

test("migrationen gør beta-status vedvarende og organisationsafgrænset", () => {
  const sql = readFileSync("supabase/migrations/20260902193555_beta_test_invitations.sql", "utf8");
  assert.match(sql, /beta_tester_since timestamptz/);
  assert.match(sql, /on public\.org_affiliations \(org_id, beta_tester_since, rights_holder_id\)/);
  assert.doesNotMatch(sql, /cron|pg_cron|valid_to\s*=|delete from public\.org_affiliations/i);
});

test("betakommunikation udleder kohorten server-side og auditlogger medlems-id'er", () => {
  const action = readFileSync("app/actions/beta-test.ts", "utf8");
  assert.match(action, /\.eq\("org_id", caller\.orgId\)\.not\("beta_tester_since", "is", null\)/);
  assert.match(action, /targetMemberUuids: eligible\.map\(holder => holder\.id\)/);
  assert.match(action, /forceEmail: true/);
  assert.doesNotMatch(action, /targetMemberUuids:.*email|counts:.*subject/);
});

test("betainvitationen validerer perioden før Auth-sideeffekter og auditerer atomisk", () => {
  const route = readFileSync("app/api/admin/user/route.ts", "utf8");
  assert.ok(route.indexOf("validateBetaPeriod(betaStartDate, effectiveBetaEndDate)") < route.indexOf("const existingAuthUser = await findAuthUserByEmail(admin, email)"));
  assert.match(route, /admin\.rpc\("set_beta_tester_status"/);
  assert.match(route, /if \(!isBetaInvitation\) await recordAuditEvent/);
  const migration = readFileSync("supabase/migrations/20260902193555_beta_test_invitations.sql", "utf8");
  assert.match(migration, /update public\.org_affiliations[\s\S]+public\.append_audit_event_v2/);
  assert.match(migration, /revoke all on function public\.set_beta_tester_status[\s\S]+from public, anon, authenticated/);
});

test("betainvitationens audit-event skelner mellem status og maillevering", () => {
  const sql = readFileSync("supabase/migrations/20260903113000_beta_invite_delivery_outcome.sql", "utf8");
  assert.match(sql, /'link_created_mail_failed'/);
  assert.match(sql, /p_outcome => case when p_enabled and not p_email_delivered then 'partial'/);
  assert.match(sql, /p_error_code => case when p_enabled and not p_email_delivered then 'email_delivery_failed'/);
  assert.doesNotMatch(sql, /email_address|invite_url|private_key|provider_error/i);
});
