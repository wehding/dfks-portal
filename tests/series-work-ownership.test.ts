import assert from "node:assert/strict";
import test from "node:test";
import { MEMBER_SERIES_PARENT_SELECT, resolveSeriesWorkOwnerOrgId } from "../lib/series-work-ownership";

test("medlemsflowet henter organisation og eksterne id'er til serie-parenten", () => {
  const fields = MEMBER_SERIES_PARENT_SELECT.split(", ");
  assert.ok(fields.includes("org_id"));
  assert.ok(fields.includes("imdb_id"));
  assert.ok(fields.includes("wikidata_id"));
});

test("et afsnitsværk arver den kanoniske series organisation", () => {
  assert.deepEqual(resolveSeriesWorkOwnerOrgId("org-series-owner"), {
    success: true,
    orgId: "org-series-owner",
  });
});

test("manglende organisation afvises før databaseindsættelsen", () => {
  assert.deepEqual(resolveSeriesWorkOwnerOrgId(undefined), {
    success: false,
    error: "Serieværket mangler organisationstilknytning. Kontakt administrator.",
  });
  assert.equal(resolveSeriesWorkOwnerOrgId("   ").success, false);
});
