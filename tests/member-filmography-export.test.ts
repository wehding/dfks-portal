import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { createFilmographyCsv, createFilmographyPdf } from "../lib/member-filmography-export";

test("filmografi-csv beskytter mod regnearksformler", () => {
  const csv = createFilmographyCsv([{ title: "=HYPERLINK(\"x\")", year: 2025, type: "spillefilm", role: "Klipper", seasonNumber: null }]);
  assert.match(csv, /'=HYPERLINK/);
});

test("filmografi-pdf er en gyldig PDF", async () => {
  const bytes = await createFilmographyPdf({ memberName: "Kasper Leick", organisationName: "DFKS", rows: [{ title: "Flugt", year: 2021, type: "dokumentarfilm", role: "Klipper", seasonNumber: null }] });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
});

test("filmografieksport er medlemsafgrænset og auditeret", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "app/api/portal/filmography/export/route.ts"), "utf8");
  assert.match(source, /if \(!context\?\.userId\).*401/);
  assert.match(source, /!context\.rightsHolderId \|\| !context\.canUseMember/);
  assert.match(source, /recordSensitiveFlow/);
  assert.match(source, /targetMemberUuid: context\.rightsHolderId/);
  assert.match(source, /Cache-Control": "private, no-store"/);
});

test("Mine værker-hurtigfiltre er serverpaginerede og service-role-begrænsede", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260901143000_member_work_quick_filters.sql"), "utf8");
  assert.match(source, /p_work_type = 'film'/);
  assert.match(source, /p_work_type = 'series'/);
  assert.match(source, /p_work_type = 'documentary'/);
  assert.match(source, /p_status = 'unresolvedShares'/);
  assert.match(source, /revoke all on function public\.list_member_work_page[\s\S]*authenticated/);
  assert.match(source, /grant execute on function public\.list_member_work_page[\s\S]*to service_role/);
});

test("Mine kontrakter henter kun allongeoversigter til den aktuelle side", () => {
  const actionSource = fs.readFileSync(path.join(process.cwd(), "app/actions/member-contracts.ts"), "utf8");
  const clientSource = fs.readFileSync(path.join(process.cwd(), "app/portal/mine-kontrakter/MineKontrakterClient.tsx"), "utf8");
  assert.match(actionSource, /select\("id,contract_id,type,title,pdf_url,created_at,ai_status"\)/);
  assert.match(actionSource, /\.eq\("type", "allonge"\)/);
  assert.match(actionSource, /\.in\("contract_id", ids\)/);
  assert.match(clientSource, /Tillæg til \{title\}/);
});

test("batch-upload kan genprøve fejlede filer uden at uploade færdige filer igen", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "app/portal/mine-kontrakter/UploadDialog.tsx"), "utf8");
  assert.match(source, /stage !== "ready"/);
  assert.match(source, /batchSavedContracts/);
  assert.match(source, /status\.stage !== "ready"/);
  assert.match(source, /Upload og analysér/);
});
