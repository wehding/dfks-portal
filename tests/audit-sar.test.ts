import assert from "node:assert/strict";
import test from "node:test";
import { buildStaffPseudonyms, subjectAccessEvents } from "../lib/audit-sar";
import type { AuditEvent } from "../lib/audit-log";

function event(actorId: string, name: string): AuditEvent {
  return {
    id: crypto.randomUUID(), occurredAt: "2026-08-20T10:00:00.000Z", action: "read",
    entityType: "contracts", entityId: crypto.randomUUID(), entityLabel: "Kontrakt",
    actorUserId: actorId, actorDisplayName: name, actorEmail: `${name}@example.invalid`, actorRole: "admin",
    actorType: "user", actorOrgId: crypto.randomUUID(), source: "admin", correlationId: null, requestId: null,
    targetMemberUuid: crypto.randomUUID(), purposeCode: "contract_case_management", legalBasis: "GDPR Art. 6",
    dataCategories: ["contract_data"], ipAddress: "192.0.2.1", systemComponent: "admin.contracts.detail",
    outcome: "success", errorCode: null, schemaVersion: 1, sequenceNo: 1, payloadHash: "a", chainHash: "b",
    integrityValid: true, changes: [], missingActorContext: false, organisations: [],
  };
}

test("staff aliases are stable within one export and vary between requests", () => {
  const actorA = crypto.randomUUID();
  const actorB = crypto.randomUUID();
  const events = [event(actorA, "Anna"), event(actorB, "Bent"), event(actorA, "Anna")];
  const first = buildStaffPseudonyms(events, "request-a");
  const again = buildStaffPseudonyms(events, "request-a");
  assert.deepEqual([...first], [...again]);
  assert.equal(first.get(actorA), again.get(actorA));
  const hasDifferentAssignment = Array.from({ length: 50 }, (_, index) => `request-${index}`)
    .some(requestId => first.get(actorA) !== buildStaffPseudonyms(events, requestId).get(actorA));
  assert.equal(hasDifferentAssignment, true);
});

test("subject export omits names, email, ids and IP addresses", () => {
  const source = event(crypto.randomUUID(), "Følsomt navn");
  const exported = subjectAccessEvents([source], "request-a", true);
  const json = JSON.stringify(exported);
  assert.match(exported[0].actor, /^\[SAGSBEHANDLER_[A-Z]+\]$/);
  assert.doesNotMatch(json, /Følsomt navn|example\.invalid|192\.0\.2\.1/);
  assert.doesNotMatch(json, new RegExp(source.actorUserId!));
});
