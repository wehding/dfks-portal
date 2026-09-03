import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const { Client } = pg;
const RUN_LOCAL_DATABASE_TEST = process.env.DFKS_LOCAL_SUPABASE_DB_TEST === "1";
const DATABASE_URL = process.env.DFKS_LOCAL_SUPABASE_DB_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function client(name) {
  return new Client({ connectionString: DATABASE_URL, application_name: name });
}

test("concurrent AI apply and OCR completion linearize without deadlock", {
  skip: !RUN_LOCAL_DATABASE_TEST,
  timeout: 20_000,
}, async () => {
  const orgId = randomUUID();
  const contractId = randomUUID();
  const aiJobId = randomUUID();
  const documentJobId = randomUUID();
  const aiLease = randomUUID();
  const documentLease = randomUUID();
  const originalPath = `${orgId}/original.pdf`;
  const outputPath = `${orgId}/processed/${contractId}/leases/${documentLease}/normalised.pdf`;
  const spatialPath = `${orgId}/processed/${contractId}/leases/${documentLease}/vision-layout.json.gz`;
  const admin = client("ai-generation-fence-admin");
  const aiWorker = client("ai-generation-fence-ai-worker");
  const ocrWorker = client("ai-generation-fence-ocr-worker");

  await Promise.all([admin.connect(), aiWorker.connect(), ocrWorker.connect()]);
  try {
    await admin.query(
      "insert into public.organisations (id, name) values ($1, $2)",
      [orgId, `Concurrent AI/OCR fence ${orgId}`],
    );
    await admin.query("select set_config('app.explicit_contract_validation', 'on', false)");
    await admin.query(
      `insert into public.contracts (id, org_id, type, status, pdf_url, document_processing_status)
       values ($1, $2, 'A-løn', 'valideret', $3, 'processing')`,
      [contractId, orgId, originalPath],
    );
    await admin.query("select set_config('app.explicit_contract_validation', 'off', false)");
    await admin.query(
      `insert into public.contract_ai_jobs (
         id, contract_id, org_id, status, stage, attempts, lease_token,
         input_storage_path, lease_expires_at, next_attempt_at
       ) values ($1, $2, $3, 'processing', 'matching', 1, $4, $5, now() + interval '15 minutes', now())`,
      [aiJobId, contractId, orgId, aiLease, originalPath],
    );
    await admin.query(
      `insert into public.contract_document_jobs (
         id, contract_id, org_id, status, attempts, lease_token, lease_expires_at,
         original_storage_path, output_storage_path, spatial_data_path, next_attempt_at
       ) values (
         $1, $2, $3, 'processing', 1, $4, now() + interval '30 minutes', $5, $6, $7, now()
       )`,
      [documentJobId, contractId, orgId, documentLease, originalPath, outputPath, spatialPath],
    );

    for (const worker of [aiWorker, ocrWorker]) {
      await worker.query("set statement_timeout = '5s'");
      await worker.query("select set_config('request.jwt.claim.role', 'service_role', false)");
    }

    await aiWorker.query("begin");
    await aiWorker.query(
      "select public.lock_current_contract_ai_job($1, $2, $3)",
      [aiJobId, aiLease, originalPath],
    );

    const ocrCompletion = ocrWorker.query(
      `select (public.finish_contract_document_job_v5(
        $1, $2, 'completed', 'image_only', 'google-vision-eu-v1', '[]'::jsonb,
        true, 1, 100, 0, 1, 0, '{}'::jsonb, 0.99, 0.95, 0.99,
        $3, $4, 'dfks-contract-redaction-v1', 'google-vision-spatial-v2', $5, null, null
      )).id`,
      [documentJobId, documentLease, "1".repeat(64), "2".repeat(64), "3".repeat(64)],
    );

    // The OCR transaction now waits on the shared advisory lock. The active
    // AI transaction can complete its already-current generation and commit;
    // no contract<->AI row-lock cycle exists.
    await new Promise(resolve => setTimeout(resolve, 100));
    await aiWorker.query(
      `select public.apply_contract_ai_extraction_v2($1, $2, $3, $4::jsonb)`,
      [aiJobId, aiLease, originalPath, JSON.stringify({
        extractedData: { workTitle: "Original generation before OCR commit" },
        validation: {
          hasCreditClause: false,
          hasTerminationClause: false,
          hasIndemnification: false,
          hasOverenskomstIncorporation: false,
        },
        contract: {
          applyType: false,
          applyOverenskomst: false,
          applyWorkingTitle: true,
          workingTitle: "Original generation before OCR commit",
          applyContractDate: false,
          applyStartDate: false,
          applyEndDate: false,
        },
        employerIds: [],
        series: null,
        import: { status: "ready_for_review" },
      })],
    );
    await aiWorker.query("commit");
    await ocrCompletion;

    const state = await admin.query(
      `select c.status as contract_status, c.processed_pdf_url,
              stale.status as stale_status, stale.lease_token,
              count(fresh.id)::integer as fresh_jobs
       from public.contracts c
       join public.contract_ai_jobs stale on stale.id = $2
       left join public.contract_ai_jobs fresh
         on fresh.contract_id = c.id and fresh.id <> stale.id and fresh.status = 'queued'
       where c.id = $1
       group by c.status, c.processed_pdf_url, stale.status, stale.lease_token`,
      [contractId, aiJobId],
    );
    assert.equal(state.rows[0].contract_status, "valideret");
    assert.equal(state.rows[0].processed_pdf_url, outputPath);
    assert.equal(state.rows[0].stale_status, "dead");
    assert.equal(state.rows[0].lease_token, null);
    assert.equal(state.rows[0].fresh_jobs, 1);
  } finally {
    await aiWorker.query("rollback").catch(() => undefined);
    await admin.query("delete from public.contracts where id = $1", [contractId]).catch(() => undefined);
    await admin.query("delete from public.organisations where id = $1", [orgId]).catch(() => undefined);
    await Promise.all([admin.end(), aiWorker.end(), ocrWorker.end()]);
  }
});

test("manual owner correction wins over an already-started AI apply", {
  skip: !RUN_LOCAL_DATABASE_TEST,
  timeout: 20_000,
}, async () => {
  const orgId = randomUUID();
  const adminUserId = randomUUID();
  const originalHolderId = randomUUID();
  const correctedHolderId = randomUUID();
  const aiSeriesWorkId = randomUUID();
  const manualWorkId = randomUUID();
  const importBatchId = randomUUID();
  const importItemId = randomUUID();
  const contractId = randomUUID();
  const aiJobId = randomUUID();
  const aiLease = randomUUID();
  const inputPath = `${orgId}/owner-race.pdf`;
  const admin = client("owner-race-admin");
  const aiWorker = client("owner-race-ai-worker");

  await Promise.all([admin.connect(), aiWorker.connect()]);
  try {
    await admin.query(
      "insert into public.organisations (id, name) values ($1, $2)",
      [orgId, `Owner race ${orgId}`],
    );
    await admin.query(
      `insert into auth.users (
         id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
       ) values (
         $1, '00000000-0000-0000-0000-000000000000', 'authenticated',
         'authenticated', $2, '', now(), now()
       )`,
      [adminUserId, `${adminUserId}@example.invalid`],
    );
    await admin.query(
      "insert into public.user_org_roles (user_id, org_id, role) values ($1, $2, 'admin')",
      [adminUserId, orgId],
    );
    await admin.query(
      `insert into public.rettighedshavere (id, full_name, email) values
       ($1, $2, $3), ($4, $5, $6)`,
      [
        originalHolderId,
        `Original owner ${originalHolderId}`,
        `${originalHolderId}@example.invalid`,
        correctedHolderId,
        `Corrected owner ${correctedHolderId}`,
        `${correctedHolderId}@example.invalid`,
      ],
    );
    await admin.query(
      `insert into public.org_affiliations (org_id, rights_holder_id, is_member, valid_from)
       values ($1, $2, true, current_date), ($1, $3, true, current_date)`,
      [orgId, originalHolderId, correctedHolderId],
    );
    await admin.query(
      `insert into public.works (id, org_id, title, type, status)
       values
         ($1, $3, $4, 'tv-serie', 'godkendt'),
         ($2, $3, $5, 'spillefilm', 'godkendt')`,
      [
        aiSeriesWorkId,
        manualWorkId,
        orgId,
        `Stale AI series ${aiSeriesWorkId}`,
        `Manual work ${manualWorkId}`,
      ],
    );
    await admin.query(
      `insert into public.contracts (
         id, org_id, rights_holder_id, type, status, working_title, pdf_url
       ) values ($1, $2, null, 'a-løn', 'kladde', 'Owner race', $3)`,
      [contractId, orgId, inputPath],
    );
    await admin.query(
      `insert into public.contract_ai_jobs (
         id, contract_id, org_id, status, stage, attempts, lease_token,
         input_storage_path, lease_expires_at, next_attempt_at
       ) values (
         $1, $2, $3, 'processing', 'matching', 1, $4, $5,
         now() + interval '15 minutes', now()
       )`,
      [aiJobId, contractId, orgId, aiLease, inputPath],
    );
    await admin.query(
      `insert into public.contract_import_batches (
         id, org_id, created_by, source, status
       ) values ($1, $2, $3, 'computer', 'processing')`,
      [importBatchId, orgId, adminUserId],
    );
    await admin.query(
      `insert into public.contract_import_items (
         id, batch_id, org_id, original_file_name, file_size_bytes,
         contract_id, ai_job_id, status
       ) values ($1, $2, $3, 'owner-race.pdf', 100, $4, $5, 'matching')`,
      [importItemId, importBatchId, orgId, contractId, aiJobId],
    );

    await aiWorker.query("set statement_timeout = '5s'");
    await aiWorker.query("select set_config('request.jwt.claim.role', 'service_role', false)");
    await admin.query("begin");
    await admin.query("select id from public.contracts where id = $1 for update", [contractId]);
    const revision = await admin.query(
      "select revision from public.contract_owner_verifications where contract_id = $1",
      [contractId],
    );

    const applyPromise = aiWorker.query(
      "select public.apply_contract_ai_extraction_v2($1, $2, $3, $4::jsonb)",
      [aiJobId, aiLease, inputPath, JSON.stringify({
        extractedData: {},
        validation: {},
        contract: { ownerSuggestionId: originalHolderId, workId: aiSeriesWorkId },
        series: { seriesWorkId: aiSeriesWorkId, seasonNumber: 1 },
        // This value was computed before the contract lock, while the contract
        // still had no owner. SQL must derive the post-lock status again.
        import: { status: "missing_owner", matchVersion: "owner-race-v1" },
      })],
    );

    // The AI function has fenced its generation but must wait for the contract
    // lock before deriving the authoritative owner.
    await new Promise(resolve => setTimeout(resolve, 100));
    await admin.query(
      "update public.contracts set work_id = $2 where id = $1",
      [contractId, manualWorkId],
    );
    const decision = await admin.query(
      `select public.review_contract_owner(
         $1, $2, $3, 'reassign', $4, 'wrong_owner', $5, $6, 'admin'
       ) as result`,
      [
        contractId,
        null,
        revision.rows[0].revision,
        correctedHolderId,
        adminUserId,
        orgId,
      ],
    );
    const reviewedRevision = Number(decision.rows[0].result.revision);
    await admin.query("commit");
    await applyPromise;

    const state = await admin.query(
      `select c.rights_holder_id, c.work_id, c.episode_scope_id,
              v.status, v.reason_code, v.reviewed_by,
              v.revision, v.proposed_rights_holder_id, v.evidence_ai_job_id,
              i.status as import_status
       from public.contracts c
       join public.contract_owner_verifications v on v.contract_id = c.id
       join public.contract_import_items i on i.id = $2
       where c.id = $1`,
      [contractId, importItemId],
    );
    assert.equal(state.rows[0].rights_holder_id, correctedHolderId);
    assert.equal(state.rows[0].work_id, manualWorkId);
    assert.equal(state.rows[0].episode_scope_id, null);
    assert.equal(state.rows[0].status, "corrected");
    assert.equal(state.rows[0].reason_code, "wrong_owner");
    assert.equal(state.rows[0].reviewed_by, adminUserId);
    assert.equal(Number(state.rows[0].revision), reviewedRevision);
    assert.equal(state.rows[0].proposed_rights_holder_id, null);
    assert.equal(state.rows[0].evidence_ai_job_id, null);
    assert.equal(state.rows[0].import_status, "ready_for_review");
    const staleScopes = await admin.query(
      `select count(*)::integer as count
       from public.member_series_episode_scopes
       where org_id = $1 and rights_holder_id = $2 and series_work_id = $3`,
      [orgId, correctedHolderId, aiSeriesWorkId],
    );
    assert.equal(staleScopes.rows[0].count, 0);
  } finally {
    await admin.query("rollback").catch(() => undefined);
    await admin.query("delete from public.contract_import_items where id = $1", [importItemId]).catch(() => undefined);
    await admin.query("delete from public.contract_import_batches where id = $1", [importBatchId]).catch(() => undefined);
    await admin.query("delete from public.contracts where id = $1", [contractId]).catch(() => undefined);
    await admin.query(
      "delete from public.member_series_episode_scopes where org_id = $1 and series_work_id = $2",
      [orgId, aiSeriesWorkId],
    ).catch(() => undefined);
    await admin.query(
      "delete from public.works where id = any($1::uuid[])",
      [[aiSeriesWorkId, manualWorkId]],
    ).catch(() => undefined);
    await admin.query(
      "delete from public.org_affiliations where org_id = $1 and rights_holder_id = any($2::uuid[])",
      [orgId, [originalHolderId, correctedHolderId]],
    ).catch(() => undefined);
    await admin.query(
      "delete from public.user_org_roles where user_id = $1 and org_id = $2",
      [adminUserId, orgId],
    ).catch(() => undefined);
    await admin.query(
      "delete from public.rettighedshavere where id = any($1::uuid[])",
      [[originalHolderId, correctedHolderId]],
    ).catch(() => undefined);
    await admin.query("delete from public.organisations where id = $1", [orgId]).catch(() => undefined);
    await admin.query("delete from auth.users where id = $1", [adminUserId]).catch(() => undefined);
    await Promise.all([admin.end(), aiWorker.end()]);
  }
});
