import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/20260902201509_admin_contract_work_queues.sql", "utf8");
const archive = fs.readFileSync("app/admin/kontrakter/ContractArchiveClient.tsx", "utf8");

test("engangskørslen kan ikke længere startes fra appen", () => {
  assert.equal(fs.existsSync("app/actions/contract-owner-backfill.ts"), false);
  assert.equal(fs.existsSync("components/admin/contract-owner-backfill-panel.tsx"), false);
  assert.doesNotMatch(archive, /ContractOwnerBackfillPanel|ejerskabskontrol/);
});

test("databasen afviser en ny engangskørsel for en organisation med historik", () => {
  assert.match(migration, /guard_single_contract_owner_backfill_run/);
  assert.match(migration, /before insert on public\.contract_owner_backfill_runs/);
  assert.match(migration, /raise exception 'contract owner backfill has already been created/);
});
