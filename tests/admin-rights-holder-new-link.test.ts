import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inviteEmailHtml } from "../lib/email/templates";

test("supabase/config.toml configures otp_expiry to 7 days (604800 seconds)", () => {
  const configPath = path.join(process.cwd(), "supabase", "config.toml");
  const content = fs.readFileSync(configPath, "utf8");
  assert.match(content, /otp_expiry\s*=\s*604800/, "otp_expiry must be set to 604800 seconds (7 days)");
});

test("inviteEmailHtml with variant 'new_link' mentions 7 days validity and custom message", () => {
  const customMessage = "Her følger et nyt link fra dansk filmportalen.";
  const html = inviteEmailHtml({
    recipientName: "Test Modtager",
    orgName: "Dansk Filmklipper Selskab",
    inviteUrl: "https://portal.dfks.dk/auth/callback?token=abc123xyz",
    variant: "new_link",
    bodyText: customMessage,
  });

  assert.ok(html.includes("Linket er gyldigt i 7 dage og kan kun bruges én gang."));
  assert.ok(html.includes(customMessage));
  assert.ok(html.includes("Åbn portalen"));
  assert.ok(html.includes("Test Modtager"));
});

test("inviteEmailHtml with variant 'new_link' and default text", () => {
  const html = inviteEmailHtml({
    recipientName: "Test Modtager",
    orgName: "Dansk Filmklipper Selskab",
    inviteUrl: "https://portal.dfks.dk/auth/callback?token=abc123xyz",
    variant: "new_link",
  });

  assert.ok(html.includes("Her følger et nyt link til Dansk Filmklipper Selskabs portal."));
  assert.ok(html.includes("Linket er gyldigt i 7 dage og kan kun bruges én gang."));
  assert.ok(html.includes("Nyt link til Dansk Filmklipper Selskab"));
});

test("admin rettighedshavere page source contains 'Send nyt link' bulk action and dialog", () => {
  const pagePath = path.join(process.cwd(), "app", "admin", "rettighedshavere", "page.tsx");
  const content = fs.readFileSync(pagePath, "utf8");

  assert.ok(content.includes("handleBulkSendNewLink"), "Must have handleBulkSendNewLink function");
  assert.ok(content.includes("confirmBulkSendNewLink"), "Must have confirmBulkSendNewLink function");
  assert.ok(content.includes("resendLinkOpen"), "Must have resendLinkOpen state");
  assert.ok(content.includes("Send nyt adgangslink"), "Must have Send nyt adgangslink dialog title");
  assert.ok(content.includes("action: \"resend_link\""), "Must call /api/admin/user with action resend_link");
});
