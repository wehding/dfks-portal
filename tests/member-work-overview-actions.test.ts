import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pageSource = fs.readFileSync("app/portal/mine-vaerker/page.tsx", "utf8");
const clientSource = fs.readFileSync("app/portal/mine-vaerker/MineVaerkerClient.tsx", "utf8");
const uploadSource = fs.readFileSync("app/portal/mine-kontrakter/UploadDialog.tsx", "utf8");

test("Mine værker bruger totaler for hele medlemslisten", () => {
  assert.match(pageSource, /totalWorks: overview\.totalCount/);
  assert.match(pageSource, /p_status: "hasContract"/);
  assert.match(pageSource, /get_member_dashboard_overview_v2/);
  assert.match(pageSource, /contract_required_work_count/);
  assert.doesNotMatch(clientSource, /const totalWorks = assignments\.reduce/);
});

test("hurtigfiltre er fjernet og arbejdsandel findes i statusmenuen", () => {
  assert.doesNotMatch(clientSource, /works\.quickFilm/);
  assert.doesNotMatch(clientSource, /works\.quickSeries/);
  assert.doesNotMatch(clientSource, /works\.quickDocumentaries/);
  assert.doesNotMatch(clientSource, /works\.quickMissingContract/);
  assert.match(clientSource, /SelectItem value="unresolvedShares"/);
});

test("afsnitsgennemgang og arbejdsandele vises som særskilte handlinger", () => {
  assert.match(clientSource, /works\.review\.taskTitle/);
  assert.match(clientSource, /summaryCounts\.reviewWorks/);
  assert.match(clientSource, /works\.unresolvedShares/);
  assert.match(clientSource, /shareTask=\$\{nextUnresolvedShareTaskId\}/);
});

test("Google Drive er skjult i medlemsuploaden, mens integrationskoden bevares", () => {
  assert.doesNotMatch(uploadSource, /MemberDriveConnections/);
  assert.doesNotMatch(uploadSource, /online-drev/);
  assert.ok(fs.existsSync("components/portal/member-drive-connections.tsx"));
  assert.ok(fs.existsSync("app/api/portal/import-connections/route.ts"));
});
