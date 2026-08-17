import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAddLabelRequest,
  buildGmailAttachmentExternalSourceId,
  buildGmailDateRangeQuery,
  encodeBase64Url,
  getGmailReconciliationRange,
  GMAIL_CONTRACT_INPUT_LABEL,
  GMAIL_CONTRACT_MAILBOX,
  parseGmailContractMessage,
  parsePubSubNotificationBody,
  processGmailMessageBatch,
} from "../lib/gmail-contract-import-core";

test("Gmail-importen overvåger Workspace-labelen kontrakter", () => {
  assert.equal(GMAIL_CONTRACT_INPUT_LABEL, "kontrakter");
});

test("Pub/Sub accepterer kun bestyrelsens faste postkasse", () => {
  const valid = Buffer.from(JSON.stringify({ emailAddress: GMAIL_CONTRACT_MAILBOX, historyId: "123" })).toString("base64");
  assert.deepEqual(parsePubSubNotificationBody({ message: { data: valid } }), {
    emailAddress: GMAIL_CONTRACT_MAILBOX,
    historyId: "123",
  });
  const other = Buffer.from(JSON.stringify({ emailAddress: "kontrakt@danskfilmklipperselskab.dk", historyId: "123" })).toString("base64");
  assert.throws(() => parsePubSubNotificationBody({ message: { data: other } }), /anden postkasse/);
});

test("labelændringen indeholder kun outputlabelen", () => {
  assert.deepEqual(buildAddLabelRequest("Label_42"), { addLabelIds: ["Label_42"] });
  assert.equal("removeLabelIds" in buildAddLabelRequest("Label_42"), false);
});

test("Gmail-genkontrollen bruger et afgrænset syvdagesvindue", () => {
  const now = new Date("2026-08-16T12:00:00.000Z");
  const range = getGmailReconciliationRange(now);
  assert.equal(range.after.toISOString(), "2026-08-09T12:00:00.000Z");
  assert.equal(range.before.toISOString(), "2026-08-16T12:01:00.000Z");
  assert.equal(
    buildGmailDateRangeQuery(range),
    `after:${Math.floor(range.after.getTime() / 1000)} before:${Math.ceil(range.before.getTime() / 1000)} has:attachment`,
  );
  assert.throws(
    () => buildGmailDateRangeQuery({ after: now, before: now }),
    /ugyldigt/,
  );
});

test("Gmail-bilag får en stabil identitet uafhængigt af attachment-id", () => {
  const hash = "a".repeat(64);
  assert.equal(
    buildGmailAttachmentExternalSourceId("gmail-message-1", hash),
    `gmail-message-1:sha256:${hash}`,
  );
  assert.throws(
    () => buildGmailAttachmentExternalSourceId("gmail-message-1", "ikke-en-hash"),
    /ugyldig/,
  );
});

test("Gmail-batchen fortsætter efter fejl og fjerner dobbelte message-id'er", async () => {
  const seen: string[] = [];
  const failures: string[] = [];
  const result = await processGmailMessageBatch(
    ["mail-1", "mail-2", "mail-2", "mail-3"],
    async messageId => {
      seen.push(messageId);
      if (messageId === "mail-2") throw new Error("fortrolig fejltekst");
      return messageId === "mail-3"
        ? { imported: 0, skipped: 0, alreadyKnown: 1 }
        : { imported: 1, skipped: 0, alreadyKnown: 0 };
    },
    messageId => failures.push(messageId),
  );
  assert.deepEqual(seen, ["mail-1", "mail-2", "mail-3"]);
  assert.deepEqual(failures, ["mail-2"]);
  assert.deepEqual(result, {
    imported: 1,
    skipped: 0,
    alreadyKnown: 1,
    messages: 3,
    failed: 1,
  });
});

test("en anden kørsel kan tælle eksisterende Gmail-sager uden dubletter", async () => {
  const result = await processGmailMessageBatch(
    ["mail-1", "mail-2", "mail-3"],
    async () => ({ imported: 0, skipped: 0, alreadyKnown: 1 }),
  );
  assert.equal(result.imported, 0);
  assert.equal(result.alreadyKnown, 3);
  assert.equal(result.failed, 0);
});

test("mailtekst og understøttede bilag udtrækkes fra MIME-træet", () => {
  const parsed = parseGmailContractMessage({
    id: "gmail-1",
    threadId: "thread-1",
    internalDate: "1785276000000",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "Subject", value: "Spørgsmål til kontrakt" },
        { name: "From", value: "Medlem <medlem@example.dk>" },
      ],
      parts: [
        { partId: "0", mimeType: "text/plain", body: { data: encodeBase64Url("Kan I se på punkt 4?") } },
        { partId: "1", mimeType: "application/pdf", filename: "aftale.pdf", body: { attachmentId: "att-1", size: 123 } },
        { partId: "2", mimeType: "image/png", filename: "logo.png", body: { attachmentId: "att-2", size: 12 } },
        { partId: "3", mimeType: "application/msword", filename: "bilag.doc", body: { attachmentId: "att-3", size: 456 } },
      ],
    },
  });
  assert.equal(parsed.bodyText, "Kan I se på punkt 4?");
  assert.equal(parsed.subject, "Spørgsmål til kontrakt");
  assert.deepEqual(parsed.attachments.map(item => item.fileName), ["aftale.pdf", "bilag.doc"]);
});
