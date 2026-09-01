import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const { Client } = pg;
const RUN_LOCAL_DATABASE_TEST = process.env.DFKS_LOCAL_SUPABASE_DB_TEST === "1";
const DATABASE_URL = process.env.DFKS_LOCAL_SUPABASE_DB_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function databaseClient(name) {
  return new Client({ connectionString: DATABASE_URL, application_name: name });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cohortDigest(targets) {
  return sha256(targets
    .toSorted((left, right) => left.contractId.localeCompare(right.contractId))
    .map(target => [
      target.contractId.toLowerCase(),
      target.sourceJobId.toLowerCase(),
      target.originalSha256.toLowerCase(),
      String(target.originalPageCount),
      target.originalPathDigest.toLowerCase(),
      target.contractStatus,
      target.priorProcessingStatus,
    ].join("|"))
    .join("\n"));
}

test("tre geometry-workers claimer og afslutter samme run uden dubletter eller fastlåst run", {
  skip: !RUN_LOCAL_DATABASE_TEST,
  timeout: 30_000,
}, async () => {
  const organisationId = randomUUID();
  const runId = randomUUID();
  const contendingRunId = randomUUID();
  const contractIds = [randomUUID(), randomUUID(), randomUUID()];
  const sourceJobIds = [randomUUID(), randomUUID(), randomUUID()];
  const originalHashes = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
  const originalPaths = contractIds.map(contractId => (
    `${organisationId}/${contractId}/original.pdf`
  ));
  const targets = contractIds.map((contractId, index) => ({
    contractId,
    sourceJobId: sourceJobIds[index],
    originalSha256: originalHashes[index],
    originalPageCount: 1,
    originalPathDigest: sha256(originalPaths[index]),
    contractStatus: "kladde",
    priorProcessingStatus: "not_required",
  }));
  const digest = cohortDigest(targets);
  const admin = databaseClient("dfks-geometry-backfill-concurrency-admin");
  const workers = [0, 1, 2].map(index => (
    databaseClient(`dfks-geometry-backfill-worker-${index + 1}`)
  ));
  let adminConnected = false;

  try {
    await admin.connect();
    adminConnected = true;
    await admin.query("set statement_timeout = '10s'");
    await admin.query("select set_config('request.jwt.claim.role', 'service_role', false)");
    await admin.query(
      "insert into public.organisations (id, name) values ($1, $2)",
      [organisationId, `Geometry concurrency ${organisationId}`],
    );

    for (let index = 0; index < contractIds.length; index += 1) {
      await admin.query(
        `insert into public.contracts (
           id, org_id, type, status, pdf_url, document_processing_status
         ) values ($1, $2, 'a-løn', 'kladde', $3, 'not_required')`,
        [contractIds[index], organisationId, originalPaths[index]],
      );
      await admin.query(
        `insert into public.contract_document_jobs (
           id, org_id, contract_id, original_storage_path, output_storage_path,
           status, priority, attempts, original_sha256, page_count
         ) values ($1, $2, $3, $4, $5, 'not_required', 100, 1, $6, 1)`,
        [
          sourceJobIds[index],
          organisationId,
          contractIds[index],
          originalPaths[index],
          `${organisationId}/processed/${contractIds[index]}/source.pdf`,
          originalHashes[index],
        ],
      );
    }

    const prepared = await admin.query(
      `select * from public.prepare_contract_document_geometry_backfill_run(
         $1, 3, $2, $3::jsonb, 1200, null
       )`,
      [runId, digest, JSON.stringify(targets)],
    );
    assert.deepEqual(prepared.rows[0], {
      outcome: "queued",
      run_id: runId,
      queued_count: 3,
      cohort_digest: digest,
    });

    const queued = await admin.query(
      `select id from public.contract_document_jobs
       where backfill_run_id = $1 order by id`,
      [runId],
    );
    const queuedJobIds = queued.rows.map(row => row.id);
    assert.equal(queuedJobIds.length, 3);

    await Promise.all(workers.map(async worker => {
      await worker.connect();
      await worker.query("set statement_timeout = '10s'");
      await worker.query("select set_config('request.jwt.claim.role', 'service_role', false)");
    }));

    // Separate connections and auto-commit transactions model three Cloud Run
    // tasks entering the claim RPC at the same time.
    const claimResults = await Promise.all(workers.map(worker => worker.query(
      `select (claimed).id, (claimed).lease_token, (claimed).status,
              (claimed).attempts, (claimed).original_sha256
       from (
         select public.claim_next_contract_document_geometry_backfill_job($1, 30) as claimed
       ) result`,
      [runId],
    )));
    const claims = claimResults.map(result => result.rows[0]);
    const claimedJobIds = claims.map(claim => claim.id);
    const leaseTokens = claims.map(claim => claim.lease_token);

    assert.ok(claims.every(claim => claim.status === "processing" && claim.attempts === 1));
    assert.ok(leaseTokens.every(token => typeof token === "string" && token.length > 0));
    assert.equal(new Set(claimedJobIds).size, 3, "samme geometry-job blev claimet flere gange");
    assert.equal(new Set(leaseTokens).size, 3, "samme geometry-lease blev genbrugt");
    assert.deepEqual(new Set(claimedJobIds), new Set(queuedJobIds));

    const persistedClaims = await admin.query(
      `select
         count(*) filter (where job.status = 'processing' and job.attempts = 1)::integer as processing_jobs,
         count(distinct job.lease_token)::integer as distinct_leases,
         count(*) filter (where target.outcome = 'processing')::integer as processing_targets
       from public.contract_document_jobs as job
       join public.contract_document_backfill_targets as target
         on target.queued_job_id = job.id
       where job.backfill_run_id = $1`,
      [runId],
    );
    assert.deepEqual(persistedClaims.rows[0], {
      processing_jobs: 3,
      distinct_leases: 3,
      processing_targets: 3,
    });

    const reviewDetails = JSON.stringify({
      schemaVersion: 1,
      reasons: [{ code: "ocr_spatial_quality", pageNumbers: [1] }],
    });
    const completionResults = await Promise.all(workers.map((worker, index) => {
      const claim = claims[index];
      return worker.query(
        `select (finished).id, (finished).status, (finished).lease_token
         from (
           select public.finish_contract_document_job_v8(
             $1, $2, 'needs_review', 'mixed', 'google-vision-eu-v1', '[]'::jsonb,
             false, 1, 0, 0, 1, 0, null, null, null, $3, null,
             'google-vision-direct-v1', 'google-vision-spatial-v3', null,
             'ocr_spatial_quality', 'Geometrien kræver manuel kontrol.', $4::jsonb
           ) as finished
         ) result`,
        [claim.id, claim.lease_token, claim.original_sha256, reviewDetails],
      );
    }));
    const completions = completionResults.map(result => result.rows[0]);
    assert.deepEqual(new Set(completions.map(row => row.id)), new Set(claimedJobIds));
    assert.ok(completions.every(row => row.status === "needs_review" && row.lease_token === null));

    const terminalState = await admin.query(
      `select
         run.state,
         count(*) filter (where job.status = 'needs_review')::integer as review_jobs,
         count(*) filter (where target.outcome = 'needs_review')::integer as review_targets,
         bool_and(source.superseded_by_job_id is null) as sources_unchanged,
         bool_and(contract.document_processing_status = 'not_required') as contracts_unchanged
       from public.contract_document_backfill_runs as run
       join public.contract_document_backfill_targets as target on target.run_id = run.id
       join public.contract_document_jobs as job on job.id = target.queued_job_id
       join public.contract_document_jobs as source on source.id = target.source_job_id
       join public.contracts as contract on contract.id = target.contract_id
       where run.id = $1
       group by run.state`,
      [runId],
    );
    assert.deepEqual(terminalState.rows[0], {
      state: "quality_pending",
      review_jobs: 3,
      review_targets: 3,
      sources_unchanged: true,
      contracts_unchanged: true,
    });

    const recoveries = claims.map(claim => ({
      contractId: targets.find(target => target.originalSha256 === claim.original_sha256).contractId,
      currentJobId: claim.id,
      currentGeneration: 0,
      status: "needs_review",
      errorCode: "ocr_spatial_quality",
      originalSha256: claim.original_sha256,
    }));
    const simultaneousTransactions = await Promise.allSettled([
      ...workers.slice(0, 2).map(worker => worker.query(
        `select * from public.queue_contract_document_geometry_backfill_recovery(
           $1, $2, $3::jsonb, 1250, null
         )`,
        [runId, digest, JSON.stringify(recoveries)],
      )),
      workers[2].query(
        `select * from public.prepare_contract_document_geometry_backfill_run(
           $1, 3, $2, $3::jsonb, 1200, null
         )`,
        [contendingRunId, digest, JSON.stringify(targets)],
      ),
    ]);
    const simultaneousRecovery = simultaneousTransactions.slice(0, 2)
      .map(result => {
        assert.equal(result.status, "fulfilled", "identisk recovery fejlede under contention");
        return result.value;
      });
    const contendingPrepare = simultaneousTransactions[2];
    assert.equal(contendingPrepare.status, "rejected");
    assert.equal(contendingPrepare.reason?.code, "55000");
    assert.deepEqual(
      simultaneousRecovery.map(result => result.rows[0].outcome).toSorted(),
      ["already_queued", "queued"],
      "samtidige identiske recovery-kald var ikke atomisk idempotente",
    );
    assert.ok(simultaneousRecovery.every(result => (
      result.rows[0].run_id === runId
      && result.rows[0].queued_count === 3
      && result.rows[0].minimum_generation === 1
      && result.rows[0].maximum_generation === 1
    )));
    await assert.rejects(
      workers[0].query(
        `select * from public.queue_contract_document_geometry_backfill_recovery(
           $1, $2, $3::jsonb, 1250, null
         )`,
        [runId, digest, JSON.stringify(recoveries.slice(0, 1))],
      ),
      error => error?.code === "55000",
      "et andet recovery-subset blev fejlagtigt accepteret som idempotent retry",
    );

    const recoveredTargets = await admin.query(
      `select target.contract_id, target.queued_job_id, target.recovery_generation,
              child.recovery_of_job_id, child.status,
              child.backfill_recovery_audit_event_id
       from public.contract_document_backfill_targets as target
       join public.contract_document_jobs as child on child.id = target.queued_job_id
       where target.run_id = $1
       order by target.contract_id`,
      [runId],
    );
    assert.equal(recoveredTargets.rows.length, 3);
    assert.ok(recoveredTargets.rows.every(row => (
      row.recovery_generation === 1
      && row.status === "queued"
      && typeof row.backfill_recovery_audit_event_id === "string"
      && claimedJobIds.includes(row.recovery_of_job_id)
    )));
    assert.equal(new Set(
      recoveredTargets.rows.map(row => row.backfill_recovery_audit_event_id),
    ).size, 1, "recovery-kohorten fik mere end ét semantisk audit-event");

    const recoveryClaimResults = await Promise.all(workers.map(worker => worker.query(
      `select (claimed).id, (claimed).recovery_of_job_id, (claimed).status,
              (claimed).attempts
       from (
         select public.claim_next_contract_document_geometry_backfill_job($1, 30) as claimed
       ) result`,
      [runId],
    )));
    const recoveryClaims = recoveryClaimResults.map(result => result.rows[0]);
    const recoveryJobIds = recoveryClaims.map(claim => claim.id);
    assert.ok(recoveryClaims.every(claim => (
      claim.status === "processing"
      && claim.attempts === 1
      && claimedJobIds.includes(claim.recovery_of_job_id)
    )));
    assert.equal(
      new Set(recoveryJobIds).size,
      3,
      "samme recovery-generation blev claimet af flere workers",
    );
    assert.deepEqual(
      new Set(recoveryJobIds),
      new Set(recoveredTargets.rows.map(row => row.queued_job_id)),
    );
  } finally {
    await Promise.all(workers.map(worker => worker.end().catch(() => undefined)));
    if (adminConnected) {
      await admin.query(
        "delete from public.contract_document_backfill_targets where run_id = $1",
        [contendingRunId],
      ).catch(() => undefined);
      await admin.query(
        "delete from public.contract_document_jobs where backfill_run_id = $1",
        [contendingRunId],
      ).catch(() => undefined);
      await admin.query(
        "delete from public.contract_document_backfill_runs where id = $1",
        [contendingRunId],
      ).catch(() => undefined);
      await admin.query(
        "delete from public.contract_document_backfill_targets where run_id = $1",
        [runId],
      ).catch(() => undefined);
      await admin.query(
        "delete from public.contract_document_jobs where backfill_run_id = $1",
        [runId],
      ).catch(() => undefined);
      await admin.query(
        "delete from public.contract_document_backfill_runs where id = $1",
        [runId],
      ).catch(() => undefined);
      await admin.query(
        "delete from public.contract_document_jobs where id = any($1::uuid[])",
        [sourceJobIds],
      ).catch(() => undefined);
      await admin.query(
        "delete from public.contracts where id = any($1::uuid[])",
        [contractIds],
      ).catch(() => undefined);
      await admin.query(
        "delete from public.organisations where id = $1",
        [organisationId],
      ).catch(() => undefined);
      await admin.end();
    }
  }
});
