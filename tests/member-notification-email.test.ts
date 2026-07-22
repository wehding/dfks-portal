import test from "node:test";
import assert from "node:assert/strict";
import { memberNotificationEmailHtml } from "../lib/email/templates";

test("member notification HTML escapes every dynamic value", () => {
  const html = memberNotificationEmailHtml({ recipientName: "<Steen>", orgName: "DFKS & Co", subject: "<Status>", bodyText: "Klik <script>alert(1)</script>", link: "https://example.test/?a=1&b=2", primaryColor: "not-a-color" });
  assert.equal(html.includes("<script>"), false);
  assert.match(html, /&lt;Steen&gt;/);
  assert.match(html, /DFKS &amp; Co/);
  assert.match(html, /a=1&amp;b=2/);
  assert.match(html, /#111827/);
});
