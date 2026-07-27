import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssociationPreview,
  extractAssociationScriptUrl,
  groupAssociationRows,
  parseAssociationTableScript,
} from "../lib/producer-association";

const documentary = { code: "documentary" as const, label: "Dokumentarfilm", url: "https://pro-f.dk/dokumentarfilm" };
const table = '<table><thead><tr><th>Virksomhedsnavn</th><th>Adresse</th><th>Post nr. &amp; By</th><th>Ejere / CEO</th><th>Website</th></tr></thead><tr><td>A Film ApS</td><td>Testvej 1</td><td>1000 København K</td><td>Ada &amp; Bo</td><td><a href="https://afilm.dk">https://afilm.dk</a></td></tr></table>';
const script = `document.write(${JSON.stringify(table)});`;

test("finder kun den tilladte offentlige medlemsdatakilde", () => {
  const page = '<script src="https://example.com/no.js"></script><script src="https://cms.workflow-automation.podio.com/list.js"></script>';
  assert.equal(extractAssociationScriptUrl(page), "https://cms.workflow-automation.podio.com/list.js");
  assert.throws(() => extractAssociationScriptUrl('<script src="https://example.com/list.js"></script>'));
});

test("parser medlemskolonner efter navn og bevarer Ejere / CEO samlet", () => {
  const rows = parseAssociationTableScript(script, documentary);
  assert.deepEqual(rows, [{
    groupCode: "documentary",
    groupLabel: "Dokumentarfilm",
    sourceUrl: documentary.url,
    sourceName: "A Film ApS",
    address: "Testvej 1",
    postalCity: "1000 København K",
    ownerCeoText: "Ada & Bo",
    website: "https://afilm.dk",
    membershipType: "unknown",
  }]);
});

test("afviser tomme og strukturelt ændrede medlemslister", () => {
  assert.throws(() => parseAssociationTableScript('document.write("<table></table>");', documentary), /mangler forventede kolonner/);
  const empty = '<table><thead><tr><th>Virksomhedsnavn</th><th>Ejere / CEO</th><th>Website</th></tr></thead></table>';
  assert.throws(() => parseAssociationTableScript(`document.write(${JSON.stringify(empty)});`, documentary), /er tom/);
});

test("samler samme producent i flere medlemsgrupper", () => {
  const first = parseAssociationTableScript(script, documentary)[0];
  const grouped = groupAssociationRows([first, { ...first, groupCode: "tv", groupLabel: "TV", sourceUrl: "https://pro-f.dk/tv", membershipType: "ordinary" }]);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].groups.map(group => group.groupCode), ["documentary", "tv"]);
});

test("matcher sikkert på basisnavn eller website og sender tvivl til kontrol", () => {
  const source = parseAssociationTableScript(script, documentary);
  const preview = buildAssociationPreview(source, [{
    employerId: "existing",
    canonicalName: "A Film",
    aliases: [],
    legalEntities: [],
    websites: ["https://www.afilm.dk/om"],
    isVerified: true,
  }]);
  assert.equal(preview[0].recommendation, "match");
  assert.equal(preview[0].suggestedEmployerId, "existing");

  const newPreview = buildAssociationPreview([{ ...source[0], sourceName: "Helt Nyt Selskab", website: null }], []);
  assert.equal(newPreview[0].recommendation, "create");
});
