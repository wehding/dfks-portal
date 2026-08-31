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
