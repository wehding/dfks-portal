import assert from "node:assert/strict";
import test from "node:test";

import {
  appendWordRecoveryAudit,
  fetchWordRecoveryCandidates,
  WORD_RECOVERY_DISPOSITION,
} from "./recover-word-contract-jobs-lib.mjs";

function queryFixture(result) {
  const calls = [];
  const query = {
    select(value) { calls.push(["select", value]); return query; },
    eq(column, value) { calls.push(["eq", column, value]); return query; },
    or(value) { calls.push(["or", value]); return query; },
    order(column, options) { calls.push(["order", column, options]); return query; },
    limit(value) { calls.push(["limit", value]); return Promise.resolve(result); },
  };
  return {
    calls,
    db: {
      from(table) {
        calls.push(["from", table]);
        return query;
      },
    },
  };
}

test("Word-recovery udelukker allerede behandlede kilder før limit", async () => {
  const fixture = queryFixture({
    data: [{ id: "job-1", original_storage_path: "private/contract.docx" }],
    error: null,
  });

  const rows = await fetchWordRecoveryCandidates(fixture.db, 25);

  assert.equal(rows.length, 1);
  assert.deepEqual(fixture.calls, [
    ["from", "contract_document_jobs"],
    ["select", "id,contract_id,original_storage_path"],
    ["eq", "status", "needs_review"],
    ["eq", "error_code", "invalid_pdf"],
    ["or", `review_disposition.is.null,review_disposition.neq.${WORD_RECOVERY_DISPOSITION}`],
    ["order", "created_at", { ascending: true }],
    ["limit", 25],
  ]);
});

test("Word-recovery registrerer ét sikkert batch-event med alle berørte medlemmer", async () => {
  const calls = [];
  const contracts = [
    { id: "contract-1", org_id: "org-1", rights_holder_id: "member-1" },
    { id: "contract-2", org_id: "org-1", rights_holder_id: "member-2" },
  ];
  const db = {
    from(table) {
      calls.push(["from", table]);
      return {
        select(columns) {
          calls.push(["select", columns]);
          return {
            in(column, ids) {
              calls.push(["in", column, ids]);
              return Promise.resolve({ data: contracts, error: null });
            },
          };
        },
      };
    },
    rpc(name, args) {
      calls.push(["rpc", name, args]);
      return Promise.resolve({ data: "audit-event-1", error: null });
    },
  };

  const eventId = await appendWordRecoveryAudit(db, {
    contractIds: ["contract-1", "contract-2"],
    correlationId: "correlation-1",
    summary: { inspected: 2, eligible: 2, queued: 2 },
  });

  assert.equal(eventId, "audit-event-1");
  const auditCall = calls.find((call) => call[0] === "rpc");
  assert.equal(auditCall[1], "append_audit_event_v2");
  assert.deepEqual(auditCall[2].p_target_member_uuids, ["member-1", "member-2"]);
  assert.deepEqual(auditCall[2].p_org_ids, ["org-1"]);
  assert.deepEqual(auditCall[2].p_metadata, {
    counts: { inspected: 2, eligible: 2, queued: 2 },
  });
  assert.equal(JSON.stringify(auditCall[2]).includes("original_storage_path"), false);
});

test("Word-recovery fejler lukket hvis auditgrundlaget er ufuldstændigt", async () => {
  const db = {
    from() {
      return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
    },
    rpc() {
      throw new Error("må ikke kaldes");
    },
  };
  await assert.rejects(
    () => appendWordRecoveryAudit(db, {
      contractIds: ["contract-1"],
      correlationId: "correlation-1",
      summary: { queued: 1 },
    }),
    /medlemsgrundlag/,
  );
});

test("Word-recovery stopper ved databasefejl", async () => {
  const fixture = queryFixture({ data: null, error: new Error("query_failed") });
  await assert.rejects(
    () => fetchWordRecoveryCandidates(fixture.db, 25),
    /query_failed/,
  );
});
