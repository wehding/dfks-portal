import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const actionSource = fs.readFileSync("app/actions/work-share-cases.ts", "utf8");
const clientSource = fs.readFileSync("app/portal/mine-vaerker/MineVaerkerClient.tsx", "utf8");

test("arbejdsandelsdyblinket validerer medlem og organisation", () => {
  const targetAction = actionSource.slice(
    actionSource.indexOf("export async function fetchMemberShareTaskTarget"),
    actionSource.indexOf("export async function respondToWorkShareTask"),
  );

  assert.match(targetAction, /ownContext\(params\.rightsHolderId\)/);
  assert.match(targetAction, /\.eq\("org_id", orgId\)/);
  assert.match(targetAction, /\.eq\("rights_holder_id", holder\.id\)/);
  assert.match(targetAction, /recordSensitiveFlow\(/);
  assert.match(targetAction, /targetMemberUuid: holder\.id/);
});

test("dyblinket åbner opgaven uden at afhænge af den aktuelle listeside", () => {
  const deepLinkEffect = clientSource.slice(
    clientSource.indexOf('const caseId = searchParams?.get("shareTask")'),
    clientSource.indexOf("const closeLinkedShareTask"),
  );

  assert.match(deepLinkEffect, /setLinkedShareTask\(result\.target/);
  assert.doesNotMatch(deepLinkEffect, /assignments\.find/);
  assert.doesNotMatch(deepLinkEffect, /Værket til procentopgaven kunne ikke findes/);
});

test("medlemmet kan svare eller afvise direkte fra opgavedialogen", () => {
  assert.match(clientSource, /respondToWorkShareTask\(/);
  assert.match(clientSource, /works\.shareTask\.save/);
  assert.match(clientSource, /works\.shareTask\.decline/);
  assert.match(clientSource, /responseScope: linkedShareTask\.episodeNumber/);
});
