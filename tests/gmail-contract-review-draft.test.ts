import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReviewEmailAddress, normalizeReviewEmailAddresses } from "../lib/contract-review-email";
import { buildContractReviewDraftMime, DEFAULT_CONTRACT_REVIEW_FROM, GmailDraftNotFoundError, upsertGmailDraft } from "../lib/gmail-contract-draft-core";

test("kontraktgennemgangskladden gemmer Til, Cc, alias og reply-headers", () => {
  const result = buildContractReviewDraftMime({
    from: DEFAULT_CONTRACT_REVIEW_FROM,
    to: "Medlem <medlem@example.dk>",
    cc: ["jurist@example.dk", "admin@example.dk"],
    subject: "Svar på kontraktgennemgang",
    body: "Kære medlem\n\nHer er vores svar.",
    threadId: "thread-1",
    inReplyTo: "<message-1@example.dk>",
    references: "<older@example.dk> <message-1@example.dk>",
  });
  const decoded = Buffer.from(result.raw, "base64url").toString("utf8");
  assert.equal(decoded, result.mime);
  assert.match(decoded, /From: DFKS Kontraktgennemgang <kontrakt@danskfilmklipperselskab\.dk>/);
  assert.match(decoded, /To: medlem@example\.dk/);
  assert.match(decoded, /Cc: jurist@example\.dk, admin@example\.dk/);
  assert.match(decoded, /In-Reply-To: <message-1@example\.dk>/);
  assert.match(decoded, /References: <older@example\.dk> <message-1@example\.dk>/);
});

test("mailfelter afviser header injection og ugyldige adresser", () => {
  assert.throws(() => normalizeReviewEmailAddress("medlem@example.dk\r\nBcc: angriber@example.dk"), /ugyldige/);
  assert.throws(() => normalizeReviewEmailAddresses(["ikke-en-mail"]), /Ugyldig/);
  assert.throws(() => buildContractReviewDraftMime({
    from: DEFAULT_CONTRACT_REVIEW_FROM, to: "medlem@example.dk", subject: "Svar\nBcc: x@example.dk", body: "tekst",
  }), /ugyldige/);
});

test("Gmail-kladdekernen indeholder ingen send-operation", async () => {
  const source = await import("node:fs/promises").then(async fs => [
    await fs.readFile(new URL("../lib/gmail-contract-draft.ts", import.meta.url), "utf8"),
    await fs.readFile(new URL("../lib/gmail-contract-draft-core.ts", import.meta.url), "utf8"),
  ].join("\n"));
  assert.equal(source.includes("messages/send"), false);
  assert.equal(source.includes("/drafts"), true);
});

test("en eksisterende Gmail-kladde opdateres uden dublet", async () => {
  const calls: string[] = [];
  const result = await upsertGmailDraft(async (path, method) => {
    calls.push(`${method} ${path}`);
    return { id: "draft-1", message: { id: "message-2" } };
  }, { raw: "raw", threadId: "thread-1" }, "draft-1");
  assert.equal(result.id, "draft-1");
  assert.deepEqual(calls, ["PUT /drafts/draft-1"]);
});

test("en slettet eller sendt Gmail-kladde genoprettes én gang", async () => {
  const calls: string[] = [];
  const result = await upsertGmailDraft(async (path, method) => {
    calls.push(`${method} ${path}`);
    if (method === "PUT") throw new GmailDraftNotFoundError();
    return { id: "draft-ny" };
  }, { raw: "raw" }, "draft-gammel");
  assert.equal(result.id, "draft-ny");
  assert.deepEqual(calls, ["PUT /drafts/draft-gammel", "POST /drafts"]);
});
