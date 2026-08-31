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

test("kun én samtidig request kan færdiggøre samme medlemsupload", {
  skip: !RUN_LOCAL_DATABASE_TEST,
  timeout: 20_000,
}, async () => {
  const organisationId = randomUUID();
  const actorId = randomUUID();
  const intentId = randomUUID();
  const fileId = randomUUID();
  const firstToken = randomUUID();
  const secondToken = randomUUID();
  const reclaimToken = randomUUID();
  const requestHash = "a".repeat(64);
  const admin = databaseClient("dfks-upload-finalization-admin");
  const first = databaseClient("dfks-upload-finalization-first");
  const second = databaseClient("dfks-upload-finalization-second");
  let rightsHolderId;
  let contractId;

  await Promise.all([admin.connect(), first.connect(), second.connect()]);
  try {
    for (const client of [first, second]) {
      await client.query("set statement_timeout = '5s'");
      await client.query("select set_config('request.jwt.claim.role', 'service_role', false)");
    }
    await admin.query("insert into public.organisations (id, name) values ($1, $2)", [
      organisationId,
      `Upload finalization race ${organisationId}`,
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
        [actorId, `Upload finalization race actor ${actorId}`, `${actorId}@example.invalid`],
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
    const created = await first.query(
      `select (public.create_member_uploaded_contract(
        $1, $2, $3, $4, $5, 1024, 'Finalization race', null, null, null, false
      )).id`,
      [actorId, organisationId, rightsHolderId, intentId, storagePath],
    );
    contractId = created.rows[0].id;
    await admin.query(
      "update public.contract_document_jobs set next_attempt_at = now() where contract_id = $1",
      [contractId],
    );

    const claimSql = `select * from public.claim_member_uploaded_contract_finalization(
      $1, $2, $3, $4, $5, $6, $7, $8
    )`;
    const [firstClaim, secondClaim] = await Promise.all([
      first.query(claimSql, [actorId, organisationId, rightsHolderId, intentId, contractId, storagePath, requestHash, firstToken]),
      second.query(claimSql, [actorId, organisationId, rightsHolderId, intentId, contractId, storagePath, requestHash, secondToken]),
    ]);
    const claims = [firstClaim.rows[0], secondClaim.rows[0]];
    assert.deepEqual(claims.map(row => row.outcome).sort(), ["claimed", "in_progress"]);
    const winner = claims.find(row => row.outcome === "claimed");
    const loserToken = winner.finalization_token === firstToken ? secondToken : firstToken;
    const parked = await admin.query(
      "select next_attempt_at > now() + interval '9 minutes' as protected from public.contract_document_jobs where contract_id = $1",
      [contractId],
    );
    assert.equal(parked.rows[0].protected, true);

    const losingRollback = await second.query(
      "select public.rollback_member_uploaded_contract($1,$2,$3,$4,$5,$6,$7) as rolled_back",
      [actorId, organisationId, rightsHolderId, intentId, contractId, storagePath, loserToken],
    );
    assert.equal(losingRollback.rows[0].rolled_back, false);

    // Simulate a server crash after claim. The exact same request may safely
    // take over after expiry while the parked worker job is still untouched.
    await admin.query(
      "update public.contract_upload_intents set finalization_claimed_at = now() - interval '11 minutes' where id = $1",
      [intentId],
    );
    const reclaimed = await second.query(claimSql, [
      actorId, organisationId, rightsHolderId, intentId, contractId, storagePath,
      requestHash, reclaimToken,
    ]);
    assert.equal(reclaimed.rows[0].outcome, "claimed");
    assert.equal(reclaimed.rows[0].finalization_token, reclaimToken);
    await assert.rejects(
      first.query(
        `select (public.finish_member_uploaded_contract_finalization(
          $1,$2,$3,$4,$5,$6,$7,$8,null,'{}'::jsonb,
          null,null,null,null,false
        )).id as id`,
        [actorId, organisationId, rightsHolderId, intentId, contractId, storagePath,
          winner.finalization_token, requestHash],
      ),
      /upload finalization lease lost/,
    );

    const completed = await first.query(
      `select (public.finish_member_uploaded_contract_finalization(
        $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'{}'::jsonb,
        null,null,null,null,false
      )).id as id`,
      [actorId, organisationId, rightsHolderId, intentId, contractId, storagePath,
        reclaimToken, requestHash, JSON.stringify({ submittedByMember: true })],
    );
    assert.equal(completed.rows[0].id, contractId);

    const retry = await second.query(claimSql, [
      actorId, organisationId, rightsHolderId, intentId, contractId, storagePath,
      requestHash, randomUUID(),
    ]);
    assert.equal(retry.rows[0].outcome, "already_finalized");
    const state = await admin.query(
      `select intent.finalization_status,
              count(validation.id)::integer as validation_count,
              bool_and(job.next_attempt_at <= now()) as processing_released
       from public.contract_upload_intents intent
       left join public.contract_validations validation on validation.contract_id = intent.contract_id
       left join public.contract_document_jobs job on job.contract_id = intent.contract_id
       where intent.id = $1
       group by intent.finalization_status`,
      [intentId],
    );
    assert.deepEqual(state.rows[0], {
      finalization_status: "finalized",
      validation_count: 1,
      processing_released: true,
    });
  } finally {
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
    await Promise.all([admin.end(), first.end(), second.end()]);
  }
});
