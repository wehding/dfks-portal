import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { insertTextAtSelection, renderOrganisationTemplate, unknownBasicPlaceholders, unknownOrganisationPlaceholders } from "../lib/organisation-text-templates";

test("dynamiske felter gengives ens i organisations- og juridiske tekster", () => {
  const rendered = renderOrganisationTemplate("Hej {navn}: {værk} / {værker} hos {organisation}", {
    name: "Anna", organisation: "DFKS", primaryWork: "Film A", worksText: "Film A, Film B",
  });
  assert.equal(rendered, "Hej Anna: Film A / Film A, Film B hos DFKS");
  assert.deepEqual(unknownBasicPlaceholders("{navn} {værker}"), []);
  assert.deepEqual(unknownBasicPlaceholders("{email}"), ["email"]);
});

test("tag indsættes præcist ved markøren", () => {
  assert.deepEqual(insertTextAtSelection("Hej !", "{navn}", 4, 4), { value: "Hej {navn}!", cursor: 10 });
  assert.deepEqual(insertTextAtSelection("Hej navn", "{navn}", 4, 8), { value: "Hej {navn}", cursor: 10 });
});

test("betateksten accepterer basisfelter og egne datofelter", () => {
  assert.deepEqual(unknownOrganisationPlaceholders("beta_invite", "{navn} {værker} {startdato} {slutdato}"), []);
  assert.deepEqual(unknownOrganisationPlaceholders("welcome", "{startdato}"), ["startdato"]);
});

test("organisationssiden henter lange tekster separat og lazy-loader editoren", async () => {
  const [page, action, onboarding] = await Promise.all([
    readFile(new URL("../app/admin/organisation/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/actions/organisation-settings.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/(member)/onboarding/page.tsx", import.meta.url), "utf8"),
  ]);
  const mainSelect = action.match(/export async function getOrganisationSettings\(\)[\s\S]*?export async function getOrganisationTextSettings/)?.[0] ?? "";
  assert.doesNotMatch(mainSelect, /invite_email_text|welcome_message_text|beta_invite_text/);
  assert.match(page, /dynamic\(\(\) => import\("@\/components\/admin\/organisation-text-editor"\)/);
  assert.match(page, /IntersectionObserver/);
  assert.match(action, /export async function getOrganisationTextSettings/);
  assert.match(onboarding, /component: "portal\.onboarding\.legal-texts"/);
  assert.match(onboarding, /targetMemberUuid: rh\.id/);
});

test("lange organisationstekster scroller inde i editoren", async () => {
  const [editor, organisationEditor, legalEditor] = await Promise.all([
    readFile(new URL("../components/ui/rich-text-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/admin/organisation-text-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/admin/legal-document-settings.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /h-80 min-h-60 max-h-\[60vh\] resize-y overflow-y-auto[\s\S]+field-sizing-fixed/);
  assert.match(editor, /role="toolbar"/);
  assert.match(organisationEditor, /max-h-80 overflow-y-auto/);
  assert.match(legalEditor, /max-h-80 overflow-y-auto/);
});
