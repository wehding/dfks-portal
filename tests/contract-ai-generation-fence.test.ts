import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const processor = fs.readFileSync(
  new URL("../lib/server/contract-import-processor.ts", import.meta.url),
  "utf8",
);
const completionRoute = fs.readFileSync(
  new URL("../app/api/internal/document-processing/complete/route.ts", import.meta.url),
  "utf8",
);
const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260830230930_contract_ai_job_generation_fence.sql", import.meta.url),
  "utf8",
);
const directVisionMigration = fs.readFileSync(
  new URL("../supabase/migrations/20260831224204_direct_vision_ocr_without_dlp.sql", import.meta.url),
  "utf8",
);

test("contract extraction uses only lease/input-generation fenced worker RPCs", () => {
  for (const rpc of [
    "set_contract_ai_job_runtime_v2",
    "set_contract_ai_import_item_stage_v2",
    "save_contract_ai_extraction_v2",
    "renew_contract_ai_job_lease_v2",
    "apply_contract_ai_extraction_v2",
    "apply_contract_attachment_extraction_v2",
    "finalize_contract_ai_job_v2",
    "fail_contract_ai_job_v2",
  ]) assert.match(processor, new RegExp(`\\b${rpc}\\b`));

  assert.doesNotMatch(processor, /\.from\("contract_validations"\)\.upsert/);
  assert.doesNotMatch(processor, /\.from\("contracts"\)\.update\(/);
  assert.doesNotMatch(processor, /rpc\("(?:save|renew|advance|finalize|fail)_contract_ai_(?:extraction|job|job_lease)"/);
  assert.doesNotMatch(processor, /id:\s*"__direct__"/);
});

test("OCR completion and AI apply share one advisory generation lock", () => {
  assert.match(completionRoute, /finish_contract_document_job_v6/);
  assert.match(migration, /create or replace function public\.finish_contract_document_job_v5/);
  assert.match(directVisionMigration, /create or replace function public\.finish_contract_document_job_v6/);
  const helper = migration.slice(
    migration.indexOf("create or replace function public.lock_current_contract_ai_job"),
    migration.indexOf("create or replace function public.set_contract_ai_job_runtime_v2"),
  );
  const completion = migration.slice(
    migration.indexOf("create or replace function public.finish_contract_document_job_v5"),
  );
  assert.match(helper, /pg_advisory_xact_lock/);
  assert.match(completion, /pg_advisory_xact_lock/);
  assert.match(directVisionMigration, /pg_advisory_xact_lock/);
  assert.match(directVisionMigration, /artifact_kind in \('masked_pdf', 'masked_spatial'\)/);
  assert.match(directVisionMigration, /source_job\.output_storage_path = source_job\.original_storage_path/);
  assert.doesNotMatch(directVisionMigration, /artifact_kind[^\n]*original/);
  assert.ok(helper.indexOf("pg_advisory_xact_lock") < helper.indexOf("for update"));
  assert.ok(completion.indexOf("pg_advisory_xact_lock") < completion.indexOf("finish_contract_document_job_v4"));
});

test("AI/OCR reanalysis never changes the contract's legal status", () => {
  const applyFunction = migration.slice(
    migration.indexOf("create or replace function public.apply_contract_ai_extraction_v2"),
    migration.indexOf("create or replace function public.apply_contract_attachment_extraction_v2"),
  );
  assert.doesNotMatch(applyFunction, /\bstatus\s*=\s*'kladde'/);
  assert.match(applyFunction, /update public\.contracts/);
});

test("legacy unfenced service-role entry points are revoked", () => {
  for (const signature of [
    "save_contract_ai_extraction(uuid, jsonb, text)",
    "renew_contract_ai_job_lease(uuid)",
    "advance_contract_ai_job(uuid, text)",
    "finalize_contract_ai_job(uuid)",
    "fail_contract_ai_job(uuid, text, text, text, text, timestamptz, boolean)",
  ]) {
    assert.match(migration, new RegExp(`revoke execute on function public\\.${signature.replace(/[()]/g, "\\$&")} from service_role`));
  }
});
