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

test("kontraktoprettelse og storage-oprydning kan ikke vinde samme upload-intent", {
  skip: !RUN_LOCAL_DATABASE_TEST,
  timeout: 20_000,
}, async () => {
  const organisationId = randomUUID();
  const actorId = randomUUID();
  const firstIntentId = randomUUID();
  const secondIntentId = randomUUID();
  const firstFileId = randomUUID();
  const secondFileId = randomUUID();
  const admin = databaseClient("dfks-upload-cleanup-race-admin");
  const creator = databaseClient("dfks-upload-cleanup-race-creator");
  const cleaner = databaseClient("dfks-upload-cleanup-race-cleaner");
  let rightsHolderId;
  let createdContractId;

  await Promise.all([admin.connect(), creator.connect(), cleaner.connect()]);
  try {
    for (const client of [creator, cleaner]) {
      await client.query("set statement_timeout = '5s'");
      await client.query("select set_config('request.jwt.claim.role', 'service_role', false)");
    }
    await admin.query(
      "insert into public.organisations (id, name) values ($1, $2)",
      [organisationId, `Upload cleanup race ${organisationId}`],
    );
    await admin.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now())`,
      [actorId, `${actorId}@example.invalid`],
    );
    const holder = await admin.query(
      "select id from public.rettighedshavere where user_id = $1",
      [actorId],
    );
    rightsHolderId = holder.rows[0]?.id;
    if (!rightsHolderId) {
      const inserted = await admin.query(
        `insert into public.rettighedshavere(user_id, full_name, email)
         values ($1, $2, $3) returning id`,
        [actorId, "Upload cleanup race actor", `${actorId}@example.invalid`],
      );
      rightsHolderId = inserted.rows[0].id;
    }
    await admin.query(
      "insert into public.org_affiliations(org_id, rights_holder_id, is_member) values ($1, $2, true)",
      [organisationId, rightsHolderId],
    );

    const firstPath = `${organisationId}/${actorId}/${firstFileId}.pdf`;
    await admin.query(
      `insert into public.contract_upload_intents
         (id, owner_id, org_id, rights_holder_id, storage_path, expected_size, expires_at)
       values ($1, $2, $3, $4, $5, 1024, clock_timestamp() + interval '2 seconds')`,
      [firstIntentId, actorId, organisationId, rightsHolderId, firstPath],
    );

    // The creation transaction starts while the intent is valid and holds the
    // row beyond wall-clock expiry. SKIP LOCKED must prevent cleanup from
    // selecting and deleting its object while creation commits.
    await creator.query("begin");
    await creator.query(
      "select id from public.contract_upload_intents where id = $1 for update",
      [firstIntentId],
    );
    await new Promise(resolve => setTimeout(resolve, 2_200));
    const skipped = await cleaner.query(
      "select * from public.claim_contract_upload_intent_cleanup('expired', 1, 300)",
    );
    assert.equal(skipped.rowCount, 0, "cleanup claimed an intent locked by contract creation");
    const created = await creator.query(
      `select (public.create_member_uploaded_contract(
        $1, $2, $3, $4, $5, 1024, 'Race-safe upload', null, null, null, false
      )).id`,
      [actorId, organisationId, rightsHolderId, firstIntentId, firstPath],
    );
    createdContractId = created.rows[0].id;
    await creator.query("commit");
    assert.ok(createdContractId);

    const secondPath = `${organisationId}/${actorId}/${secondFileId}.pdf`;
    await admin.query(
      `insert into public.contract_upload_intents
         (id, owner_id, org_id, rights_holder_id, storage_path, expected_size, expires_at)
       values ($1, $2, $3, $4, $5, 1024, now() - interval '1 minute')`,
      [secondIntentId, actorId, organisationId, rightsHolderId, secondPath],
    );
    const claimed = await cleaner.query(
      "select * from public.claim_contract_upload_intent_cleanup('expired', 1, 300)",
    );
    assert.equal(claimed.rows[0]?.intent_id, secondIntentId);
    await assert.rejects(
      creator.query(
        `select (public.create_member_uploaded_contract(
          $1, $2, $3, $4, $5, 1024, 'Too-late upload', null, null, null, false
        )).id`,
        [actorId, organisationId, rightsHolderId, secondIntentId, secondPath],
      ),
      /upload intent cleanup in progress/,
    );
    const wrongToken = await cleaner.query(
      "select public.finish_contract_upload_intent_cleanup($1, $2, 'expired', false) as finished",
      [secondIntentId, randomUUID()],
    );
    assert.equal(wrongToken.rows[0].finished, false, "a stale cleanup-token was accepted");
    const released = await cleaner.query(
      "select public.finish_contract_upload_intent_cleanup($1, $2, 'expired', false) as finished",
      [secondIntentId, claimed.rows[0].cleanup_claim_token],
    );
    assert.equal(released.rows[0].finished, true);
    const pending = await admin.query(
      "select cleanup_status, cleanup_claim_token from public.contract_upload_intents where id = $1",
      [secondIntentId],
    );
    assert.equal(pending.rows[0].cleanup_status, "pending");
    assert.equal(pending.rows[0].cleanup_claim_token, null);

    const retryClaim = await cleaner.query(
      "select * from public.claim_contract_upload_intent_cleanup('expired', 1, 300)",
    );
    assert.equal(retryClaim.rows[0]?.intent_id, secondIntentId);
    const completed = await cleaner.query(
      "select public.finish_contract_upload_intent_cleanup($1, $2, 'expired', true) as finished",
      [secondIntentId, retryClaim.rows[0].cleanup_claim_token],
    );
    assert.equal(completed.rows[0].finished, true);
    const finalState = await admin.query(
      `select cleanup_status, expired_object_cleanup_at is not null as cleaned
       from public.contract_upload_intents where id = $1`,
      [secondIntentId],
    );
    assert.deepEqual(finalState.rows[0], { cleanup_status: "completed", cleaned: true });
  } finally {
    await creator.query("rollback").catch(() => undefined);
    if (createdContractId) {
      await admin.query("delete from public.contracts where id = $1", [createdContractId]).catch(() => undefined);
    }
    await admin.query(
      "delete from public.contract_upload_intents where id = any($1::uuid[])",
      [[firstIntentId, secondIntentId]],
    ).catch(() => undefined);
    if (rightsHolderId) {
      await admin.query(
        "delete from public.org_affiliations where org_id = $1 and rights_holder_id = $2",
        [organisationId, rightsHolderId],
      ).catch(() => undefined);
    }
    await admin.query("delete from auth.users where id = $1", [actorId]).catch(() => undefined);
    await admin.query("delete from public.organisations where id = $1", [organisationId]).catch(() => undefined);
    await Promise.all([admin.end(), creator.end(), cleaner.end()]);
  }
});
