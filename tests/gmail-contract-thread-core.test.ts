import assert from "node:assert/strict";
import test from "node:test";
import { buildMaskedReviewMailContext, latestThreadMessageId } from "../lib/contract-review-mail-context";
import { isGmailDraftMessage } from "../lib/gmail-contract-import-core";
import { mapWithConcurrency } from "../lib/gmail-contract-thread-core";

test("Gmail-kladder udelades fra trådsynkronisering", () => {
  assert.equal(isGmailDraftMessage({ id: "1", labelIds: ["DRAFT"] }), true);
  assert.equal(isGmailDraftMessage({ id: "2", labelIds: ["INBOX"] }), false);
});

test("cronarbejde overskrider aldrig fem samtidige Gmail-kald", async () => {
  let active = 0;
  let maximum = 0;
  const results = await mapWithConcurrency(Array.from({ length: 20 }, (_, index) => index), 5, async value => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active -= 1;
    if (value === 7) throw new Error("kontrolleret Gmail-fejl");
    return value;
  });
  assert.equal(maximum, 5);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 19);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
});

test("AI-konteksten maskerer persondata og bevarer første og nyeste besked", () => {
  const messages = Array.from({ length: 8 }, (_, index) => ({
    id: String(index), gmailMessageId: `gmail-${index}`, internetMessageId: null,
    subject: `Emne ${index}`, from: `person${index}@example.dk`, to: ["kontrakt@example.dk"], cc: [],
    receivedAt: new Date(2026, 7, index + 1).toISOString(), direction: "incoming" as const,
    body: `${index === 0 ? "FØRSTE" : index === 7 ? "NYESTE" : "MELLEM"} ${"tekst ".repeat(2_000)}`,
  }));
  const context = buildMaskedReviewMailContext(messages, 5_000);
  assert.ok(context.length <= 5_000);
  assert.match(context, /FØRSTE/);
  assert.match(context, /NYESTE/);
  assert.doesNotMatch(context, /person0@example\.dk/);
  assert.equal(latestThreadMessageId(messages), "gmail-7");
});
