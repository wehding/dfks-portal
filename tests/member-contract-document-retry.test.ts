import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const actionPath = new URL("../app/actions/member-contracts.ts", import.meta.url);
const migrationPath = new URL(
  "../supabase/migrations/20260830230354_retry_contract_document_job.sql",
  import.meta.url,
);

test("medlemmets PDF-genkø delegeres til den atomiske service-RPC", async () => {
  const source = await readFile(actionPath, "utf8");
  const start = source.indexOf("export async function queueUploadedContractAiJob");
  const end = source.indexOf("function triggerContractAiJobProcessing", start);
  assert.ok(start >= 0 && end > start, "queue action was not found");

  const body = source.slice(start, end);
  assert.match(body, /rpc\("queue_or_retry_member_contract_document_job"/);
  assert.match(body, /p_owner_id:\s*user\.id/);
  assert.match(body, /p_org_id:\s*orgId/);
  assert.match(body, /p_rights_holder_id:\s*rh\.id/);
  assert.doesNotMatch(body, /from\("contract_document_jobs"\)\s*\.insert/);
  assert.doesNotMatch(body, /from\("contracts"\)\.update\(\{\s*document_processing_status/);
});

test("genkø-RPC er service-only og låser job før kontrakt", async () => {
  const source = await readFile(migrationPath, "utf8");
  const jobLock = source.indexOf("for update of job");
  const contractLock = source.indexOf("for update of contract");

  assert.ok(jobLock >= 0 && contractLock > jobLock);
  assert.match(source, /security definer\s+set search_path = ''/);
  assert.match(source, /revoke all on function public\.queue_or_retry_member_contract_document_job[\s\S]*?from public, anon, authenticated/);
  assert.match(source, /grant execute on function public\.queue_or_retry_member_contract_document_job[\s\S]*?to service_role/);
  assert.match(source, /affiliation\.valid_from is null or affiliation\.valid_from <= current_date/);
  assert.match(source, /affiliation\.valid_to is null or affiliation\.valid_to >= current_date/);
});

test("genkø nulstiller OCR-bevis men aldrig kontraktens juridiske status", async () => {
  const source = await readFile(migrationPath, "utf8");
  const resetStart = source.indexOf("update public.contract_document_jobs as job");
  const returnStart = source.indexOf("return query select 'requeued'", resetStart);
  assert.ok(resetStart >= 0 && returnStart > resetStart);
  const reset = source.slice(resetStart, returnStart);

  for (const field of [
    "lease_token = null",
    "lease_expires_at = null",
    "spatial_data_path = null",
    "original_sha256 = null",
    "processed_sha256 = null",
    "spatial_sha256 = null",
    "document_processing_status = 'pending'",
  ]) {
    assert.match(reset, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(reset, /set\s+status\s*=\s*'valideret'/);
  assert.doesNotMatch(reset, /update public\.contracts[\s\S]*?\bstatus\s*=/);
});
