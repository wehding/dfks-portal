import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const { Client } = pg;
const RUN_LOCAL_DATABASE_TEST = process.env.DFKS_LOCAL_SUPABASE_DB_TEST === "1";
const DATABASE_URL = process.env.DFKS_LOCAL_SUPABASE_DB_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function databaseClient(name) {
  return new Client({ connectionString: DATABASE_URL, application_name: name });
}

test("et claimet OCR-job vinder over samtidig upload-rollback", {
  skip: !RUN_LOCAL_DATABASE_TEST,
  timeout: 20_000,
}, async () => {
  const organisationId = randomUUID();
  const actorId = randomUUID();
  const intentId = randomUUID();
  const fileId = randomUUID();
  const admin = databaseClient("dfks-upload-rollback-admin");
  const worker = databaseClient("dfks-upload-rollback-worker");
  const rollback = databaseClient("dfks-upload-rollback-request");
  let rightsHolderId;
  let contractId;
  const finalizationToken = randomUUID();
  const requestHash = "1".repeat(64);

  await Promise.all([admin.connect(), worker.connect(), rollback.connect()]);
  try {
    for (const client of [worker, rollback]) {
      await client.query("set statement_timeout = '5s'");
      await client.query("select set_config('request.jwt.claim.role', 'service_role', false)");
    }
    await admin.query("insert into public.organisations (id, name) values ($1, $2)", [
      organisationId,
      `Upload rollback race ${organisationId}`,
    ]);
    await admin.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now())`,
      [actorId, `${actorId}@example.invalid`],
    );
    const holder = await admin.query("select id from public.rettighedshavere where user_id = $1", [actorId]);
    rightsHolderId = holder.rows[0]?.id;
    if (!rightsHolderId) {
      const inserted = await admin.query(
        `insert into public.rettighedshavere(user_id, full_name, email)
         values ($1, $2, $3) returning id`,
        [actorId, `Upload rollback race actor ${actorId}`, `${actorId}@example.invalid`],
      );
      rightsHolderId = inserted.rows[0].id;
    }
    await admin.query(
      "insert into public.org_affiliations(org_id, rights_holder_id, is_member) values ($1, $2, true)",
      [organisationId, rightsHolderId],
    );
    const storagePath = `${organisationId}/${actorId}/${fileId}.pdf`;
    await admin.query(
      `insert into public.contract_upload_intents
         (id, owner_id, org_id, rights_holder_id, storage_path, expected_size)
       values ($1, $2, $3, $4, $5, 1024)`,
      [intentId, actorId, organisationId, rightsHolderId, storagePath],
    );
    const created = await rollback.query(
      `select (public.create_member_uploaded_contract(
        $1, $2, $3, $4, $5, 1024, 'Rollback race', null, null, null, false
      )).id`,
      [actorId, organisationId, rightsHolderId, intentId, storagePath],
    );
    contractId = created.rows[0].id;
    const finalizationClaim = await rollback.query(
      `select * from public.claim_member_uploaded_contract_finalization(
        $1, $2, $3, $4, $5, $6, $7, $8
      )`,
      [actorId, organisationId, rightsHolderId, intentId, contractId, storagePath, requestHash, finalizationToken],
    );
    assert.equal(finalizationClaim.rows[0]?.outcome, "claimed");

    await worker.query("begin");
    const job = await worker.query(
      "select id from public.contract_document_jobs where contract_id = $1 for update",
      [contractId],
    );
    await worker.query(
      `update public.contract_document_jobs
       set status = 'processing', attempts = 1, lease_token = $2,
           lease_expires_at = now() + interval '30 minutes'
       where id = $1`,
      [job.rows[0].id, randomUUID()],
    );

    let rollbackSettled = false;
    const rollbackAttempt = rollback.query(
      "select public.rollback_member_uploaded_contract($1, $2, $3, $4, $5, $6, $7) as rolled_back",
      [actorId, organisationId, rightsHolderId, intentId, contractId, storagePath, finalizationToken],
    ).finally(() => {
      rollbackSettled = true;
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(rollbackSettled, false, "rollback did not wait for the worker-owned job lock");
    await worker.query("commit");

    const result = await rollbackAttempt;
    assert.equal(result.rows[0].rolled_back, false);
    const preserved = await admin.query(
      `select c.status, j.status as job_status, j.attempts
       from public.contracts c
       join public.contract_document_jobs j on j.contract_id = c.id
       where c.id = $1`,
      [contractId],
    );
    assert.deepEqual(preserved.rows[0], { status: "kladde", job_status: "processing", attempts: 1 });
  } finally {
    await worker.query("rollback").catch(() => undefined);
    if (contractId) await admin.query("delete from public.contracts where id = $1", [contractId]).catch(() => undefined);
    await admin.query("delete from public.contract_upload_intents where id = $1", [intentId]).catch(() => undefined);
    if (rightsHolderId) {
      await admin.query(
        "delete from public.org_affiliations where org_id = $1 and rights_holder_id = $2",
        [organisationId, rightsHolderId],
      ).catch(() => undefined);
    }
    await admin.query("delete from auth.users where id = $1", [actorId]).catch(() => undefined);
    await admin.query("delete from public.organisations where id = $1", [organisationId]).catch(() => undefined);
    await Promise.all([admin.end(), worker.end(), rollback.end()]);
  }
});
