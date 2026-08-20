import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LEGAL_DOCUMENT_COPY,
  LEGAL_DOCUMENT_AUDIENCES,
  LEGAL_DOCUMENT_TYPES,
} from "../lib/legal-documents";

test("alle juridiske dokumenttyper findes for medlemmer og ikke-medlemmer", () => {
  for (const audience of LEGAL_DOCUMENT_AUDIENCES) {
    for (const documentType of LEGAL_DOCUMENT_TYPES) {
      const copy = DEFAULT_LEGAL_DOCUMENT_COPY[audience][documentType];
      assert.equal(typeof copy.title, "string");
      assert.ok(copy.title.length > 0);
      assert.equal(typeof copy.body, "string");
      assert.ok(copy.body.length > 40);
    }
  }
});

test("ikke-medlemstekster naevner ikke KODA", () => {
  const combined = LEGAL_DOCUMENT_TYPES
    .map(documentType => DEFAULT_LEGAL_DOCUMENT_COPY.non_member[documentType].body)
    .join("\n");
  assert.equal(/\bKODA\b/i.test(combined), false);
});
