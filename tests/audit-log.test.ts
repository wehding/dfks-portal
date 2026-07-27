import assert from "node:assert/strict";
import test from "node:test";
import {
  auditEntityHref,
  csvAuditCell,
  decodeAuditCursor,
  encodeAuditCursor,
  sanitizeAuditSearch,
} from "../lib/audit-log";

test("audit cursor round-trips and rejects malformed values", () => {
  const cursor = { occurredAt: "2026-07-27T10:15:00.000Z", id: "7b01802c-0747-4dbc-aa7f-8797b65029f2" };
  assert.deepEqual(decodeAuditCursor(encodeAuditCursor(cursor)), cursor);
  assert.equal(decodeAuditCursor("ikke-en-cursor"), null);
});

test("audit search removes PostgREST control characters", () => {
  assert.equal(sanitizeAuditSearch("  Steen,_%()   kontrakt  "), "Steen kontrakt");
  assert.equal(sanitizeAuditSearch("a".repeat(120)).length, 100);
});

test("CSV cells protect spreadsheet formulas and escape quotes", () => {
  assert.equal(csvAuditCell("=HYPERLINK(\"https://example.com\")"), '"\'=HYPERLINK(""https://example.com"")"');
  assert.equal(csvAuditCell("normal"), '"normal"');
});

test("audit links only target supported admin editors", () => {
  assert.equal(auditEntityHref({ entityType: "contracts", entityId: "abc/123" }), "/admin/kontrakter?edit=abc%2F123");
  assert.equal(auditEntityHref({ entityType: "member_messages", entityId: "abc" }), null);
  assert.equal(auditEntityHref({ entityType: "works", entityId: null }), null);
});
