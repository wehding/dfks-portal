import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAddLabelRequest,
  encodeBase64Url,
  GMAIL_CONTRACT_MAILBOX,
  parseGmailContractMessage,
  parsePubSubNotificationBody,
} from "../lib/gmail-contract-import-core";

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
