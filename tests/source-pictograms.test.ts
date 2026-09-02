import assert from "node:assert/strict";
import test from "node:test";
import { dataSourceLabel, normalizeDataSource } from "../lib/source-pictograms";

test("fælles kildepiktogrammer bruger de aftalte betegnelser", () => {
  assert.equal(dataSourceLabel("local"), "DB");
  assert.equal(dataSourceLabel("portal"), "DB");
  assert.equal(dataSourceLabel("dfi"), "DFI");
  assert.equal(dataSourceLabel("tmdb"), "TMDB");
  assert.equal(dataSourceLabel("imdb"), "IMDb");
});

test("ukendte kilder bevares uden at blive forklædt som databasen", () => {
  assert.equal(normalizeDataSource("festival"), "unknown");
  assert.equal(dataSourceLabel("festival"), "festival");
});
