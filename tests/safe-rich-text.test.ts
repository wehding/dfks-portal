import assert from "node:assert/strict";
import test from "node:test";
import { safeRichTextToHtml } from "@/lib/safe-rich-text";

test("renders the supported organisation text formatting", () => {
  const html = safeRichTextToHtml("[heading]Velkommen[/heading]\n**Fed** og *kursiv* og [u]understreget[/u]\n[size=large]Stor[/size]");
  assert.match(html, /font-size:1.25em/);
  assert.match(html, /<strong>Fed<\/strong>/);
  assert.match(html, /<em>kursiv<\/em>/);
  assert.match(html, /<u>understreget<\/u>/);
  assert.match(html, /font-size:1.125em/);
});

test("escapes arbitrary HTML before applying formatting", () => {
  const html = safeRichTextToHtml('<img src=x onerror="alert(1)"> **ok**');
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;img/);
  assert.match(html, /<strong>ok<\/strong>/);
});
