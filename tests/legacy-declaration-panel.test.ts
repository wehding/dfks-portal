import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync("app/portal/mine-vaerker/LegacyDeclarationPanel.tsx", "utf8");
const translations = readFileSync("lib/i18n.tsx", "utf8");

test("legacy declaration dialog keeps desktop width and prevents horizontal overflow", () => {
  assert.match(panel, /overflow-x-hidden/);
  assert.match(panel, /sm:max-w-3xl/);
  assert.doesNotMatch(panel, /className="max-h-\[90dvh\] max-w-3xl/);
});

test("legacy declaration rows state the positive declaration without changing reject semantics", () => {
  assert.match(panel, /works\.legacy\.attestWork/);
  assert.match(translations, /"works\.legacy\.attestWork": "Jeg har arbejdet som klipper på værket"/);
  assert.match(translations, /"works\.legacy\.dispute": "Afvis værk"/);
  assert.match(panel, /onClick=\{\(\) => dispute\(task\)\}/);
});

test("stored escaped line breaks render as paragraphs", () => {
  assert.match(panel, /\.replaceAll\("\\\\n", "\\n"\)/);
  assert.match(panel, /whitespace-pre-line/);
});
