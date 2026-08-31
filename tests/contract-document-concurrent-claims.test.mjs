import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const { Client } = pg;

const RUN_LOCAL_DATABASE_TEST = process.env.DFKS_LOCAL_SUPABASE_DB_TEST === "1";
const DATABASE_URL = process.env.DFKS_LOCAL_SUPABASE_DB_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function databaseClient() {
  return new Client({
    connectionString: DATABASE_URL,
    application_name: "dfks-concurrent-document-claim-test",
  });
}

test("tre samtidige forbindelser claimer hvert sit dokumentjob og lease-token", {
  skip: !RUN_LOCAL_DATABASE_TEST,
  timeout: 20_000,
}, async () => {
  const organisationId = randomUUID();
  const workId = randomUUID();
  const contractIds = [randomUUID(), randomUUID(), randomUUID()];
  const jobIds = [randomUUID(), randomUUID(), randomUUID()];
  const admin = databaseClient();
  const workers = [databaseClient(), databaseClient(), databaseClient()];
  let setupCommitted = false;

  await admin.connect();

  try {
    await admin.query("begin");
    await admin.query(
      "insert into public.organisations (id, name) values ($1, $2)",
      [organisationId, `Concurrent document claim test ${organisationId}`],
    );
    await admin.query(
      "insert into public.works (id, org_id, title, type) values ($1, $2, $3, $4)",
      [workId, organisationId, "Concurrent claim test work", "fiktion"],
    );

    for (let index = 0; index < contractIds.length; index += 1) {
      await admin.query(
        `insert into public.contracts (id, org_id, work_id, type, status, pdf_url)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          contractIds[index],
          organisationId,
          workId,
          "A-løn",
          "kladde",
          `${organisationId}/concurrent-${index + 1}.pdf`,
        ],
      );
      await admin.query(
        `insert into public.contract_document_jobs
           (id, org_id, contract_id, original_storage_path, output_storage_path, priority)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          jobIds[index],
          organisationId,
          contractIds[index],
          `${organisationId}/concurrent-${index + 1}.pdf`,
          `${organisationId}/processed/concurrent-${index + 1}.pdf`,
          2_147_483_647,
        ],
      );
    }

    await admin.query("commit");
    setupCommitted = true;

    await Promise.all(workers.map(async worker => {
      await worker.connect();
      await worker.query("set statement_timeout = '5s'");
      await worker.query("select set_config('request.jwt.claim.role', 'service_role', false)");
    }));

    // All three RPC calls are launched before awaiting any result and use
    // separate PostgreSQL connections. Each call remains its own database
    // transaction, just as three parallel Cloud Run tasks do in production.
    const claimResults = await Promise.all(workers.map(worker => worker.query(
      `select (claimed).id, (claimed).lease_token, (claimed).status
       from (select public.claim_next_contract_document_job(30) as claimed) result`,
    )));

    const claims = claimResults.map(result => result.rows[0]);
    const claimedJobIds = claims.map(claim => claim.id);
    const leaseTokens = claims.map(claim => claim.lease_token);

    assert.equal(claims.length, 3);
    assert.ok(claims.every(claim => claim.status === "processing"));
    assert.ok(leaseTokens.every(token => typeof token === "string" && token.length > 0));
    assert.equal(new Set(claimedJobIds).size, 3, "samme job blev claimet mere end én gang");
    assert.equal(new Set(leaseTokens).size, 3, "samme lease-token blev genbrugt");
    assert.deepEqual(new Set(claimedJobIds), new Set(jobIds));

    const persisted = await admin.query(
      `select id, status, attempts, lease_token
       from public.contract_document_jobs
       where id = any($1::uuid[])`,
      [jobIds],
    );
    assert.equal(persisted.rowCount, 3);
    assert.ok(persisted.rows.every(row => (
      row.status === "processing"
      && row.attempts === 1
      && typeof row.lease_token === "string"
    )));
  } finally {
    await Promise.all(workers.map(async worker => {
      await worker.end().catch(() => undefined);
    }));

    if (!setupCommitted) {
      await admin.query("rollback").catch(() => undefined);
    }

    await admin.query("delete from public.contract_document_jobs where id = any($1::uuid[])", [jobIds]);
    await admin.query("delete from public.contracts where id = any($1::uuid[])", [contractIds]);
    await admin.query("delete from public.works where id = $1", [workId]);
    await admin.query("delete from public.organisations where id = $1", [organisationId]);
    await admin.end();
  }
});
