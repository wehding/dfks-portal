import assert from "node:assert/strict";
import test from "node:test";
import { postgrestIlikePattern, sanitizePostgrestSearchTerm } from "../lib/postgrest-search";

test("fjerner PostgREST-filtertegn fra søgetekst", () => {
  assert.equal(sanitizePostgrestSearchTerm('navn),org_id.eq.other,"x'), "navn org_id.eq.other x");
});

test("tillader almindelige danske navne og afviser tomme mønstre", () => {
  assert.equal(postgrestIlikePattern("  Søren O'Brien  "), "%Søren O'Brien%");
  assert.equal(postgrestIlikePattern("(),%*"), null);
});
