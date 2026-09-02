import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("rettighedshaverlisten søger pagineret på serveren", async () => {
  const action = await source("app/actions/rettighedshavere.ts");
  assert.match(action, /search\?: string/);
  assert.match(action, /postgrestIlikePattern\(options\.search/);
  assert.match(action, /full_name\.ilike\.\$\{pattern\},email\.ilike\.\$\{pattern\},phone\.ilike\.\$\{pattern\}/);
  assert.match(action, /\.ilike\("member_no", pattern\)/);
  assert.match(action, /count: "exact"/);
  assert.match(action, /filteredCount/);
});

test("søgefeltet debouncer og henter ikke hele registret", async () => {
  const page = await source("app/admin/rettighedshavere/page.tsx");
  const input = page.slice(page.indexOf('placeholder="Søg navn'), page.indexOf('placeholder="Søg navn') + 500);
  assert.match(page, /window\.setTimeout\(\(\) => \{\s*void load\(search\.trim\(\), false\)\s*\}, 300\)/);
  assert.match(page, /loadRequestRef/);
  assert.match(input, /onChange=\{e => setSearch\(e\.target\.value\)\}/);
  assert.doesNotMatch(input, /loadAllRightsHolders/);
});

test("følsomme søgeresultater auditeres uden rå søgetekst", async () => {
  const action = await source("app/actions/rettighedshavere.ts");
  const auditStart = action.indexOf('component: "admin.rights-holders.list-search"');
  const auditBlock = action.slice(auditStart, auditStart + 900);
  assert.ok(auditStart > 0);
  assert.match(auditBlock, /targetMemberUuids: rows\.map/);
  assert.match(auditBlock, /counts: \{ results: rows\.length, totalMatches:/);
  assert.doesNotMatch(auditBlock, /options\.search|pattern|query/);
});
