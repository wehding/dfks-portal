import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("arbejdsandelsopslaget bruger works-tabellens eksisterende originaltitelfelt", () => {
  const source = readFileSync("lib/server/work-credit-evidence.ts", "utf8");

  assert.match(source, /select\("id,title,dfi_original_title,year,type,dfi_id,tmdb_id,dfi_metadata"\)/);
  assert.match(source, /work\.dfi_original_title/);
  assert.doesNotMatch(source, /work\.original_title/);
  assert.doesNotMatch(source, /title,original_title,year/);
});
