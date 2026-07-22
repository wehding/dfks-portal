import assert from "node:assert/strict";
import test from "node:test";

import {
  GMAIL_SEND_ENDPOINT,
  normalizePrivateKey,
  sendGmailMessage,
  type GmailDependencies,
  type GmailEnvironment,
} from "../lib/email/gmail-core";
import { buildMimeMessage } from "../lib/email/mime";
import { inviteEmailHtml } from "../lib/email/templates";

const PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nfake-test-key\n-----END PRIVATE KEY-----";
const VALID_ENV: GmailEnvironment = {
  GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL: "mail-service@test-project.iam.gserviceaccount.com",
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: PRIVATE_KEY,
  GOOGLE_GMAIL_SENDER: "bestyrelsen@danskfilmklipperselskab.dk",
};
const PAYLOAD = {
  to: "modtager@example.com",
  subject: "2. invitation til Dansk Filmklipperselskabs portal",
  html: "<p>Hej Søren – vælg adgang</p>",
  fromName: "Dansk Filmklipperselskab",
  replyTo: "kontakt@example.com",
};

function dependenciesFor(status: number, body: object = {}): {
  dependencies: GmailDependencies;
  logs: string[];
  requests: Array<{ input: string; init?: RequestInit }>;
} {
  const logs: string[] = [];
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  return {
    logs,
    requests,
    dependencies: {
      getAuthHeaders: async () => ({ Authorization: "Bearer test-access-token" }),
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ input: String(input), init });
        return new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
      logError: message => logs.push(message),
    },
  };
}

function decodeMimeBody(mime: string): string {
  const [, encodedBody = ""] = mime.split("\r\n\r\n");
  return Buffer.from(encodedBody.replaceAll("\r\n", ""), "base64").toString("utf8");
}

test("MIME bruger UTF-8, dansk emne, Gmail-afsender, Reply-To og base64url", () => {
  const result = buildMimeMessage(PAYLOAD, "bestyrelsen@danskfilmklipperselskab.dk");
  const decodedRaw = Buffer.from(result.raw, "base64url").toString("utf8");
  assert.equal(decodedRaw, result.mime);
  assert.match(result.mime, /^From: =\?UTF-8\?B\?.+\?= <bestyrelsen@danskfilmklipperselskab\.dk>\r\n/);
  assert.match(result.mime, /Reply-To: kontakt@example\.com\r\n/);
  assert.match(result.mime, /Subject: =\?UTF-8\?B\?.+\?=\r\n/);
  assert.match(result.mime, /Content-Type: text\/html; charset=UTF-8/);
  assert.equal(decodeMimeBody(result.mime), PAYLOAD.html);
  assert.equal(/[+/=]/.test(result.raw), false);
});

test("MIME afviser CR/LF header injection", () => {
  for (const [field, value] of [
    ["to", "offer@example.com\r\nBcc: attacker@example.com"],
    ["subject", "Invitation\nBcc: attacker@example.com"],
    ["fromName", "DFKS\r\nBcc: attacker@example.com"],
    ["replyTo", "reply@example.com\nBcc: attacker@example.com"],
  ] as const) {
    assert.throws(() => buildMimeMessage({ ...PAYLOAD, [field]: value }, VALID_ENV.GOOGLE_GMAIL_SENDER!), /ugyldig/);
  }
});

test("private key accepterer både escaped og rigtige linjeskift", () => {
  assert.equal(normalizePrivateKey("line1\\nline2"), "line1\nline2");
  assert.equal(normalizePrivateKey("line1\nline2"), "line1\nline2");
});

test("manglende Google-konfiguration returnerer E-mail ikke konfigureret", async () => {
  const { dependencies, requests, logs } = dependenciesFor(200, { id: "gmail-id" });
  const result = await sendGmailMessage(PAYLOAD, {}, dependencies);
  assert.deepEqual(result, { ok: false, code: "not_configured", error: "E-mail ikke konfigureret" });
  assert.equal(requests.length, 0);
  assert.equal(logs.some(log => log.includes("variabler mangler")), true);
});

test("ugyldig private key afvises før token- og Gmail-kald", async () => {
  const { dependencies, requests, logs } = dependenciesFor(200, { id: "gmail-id" });
  const result = await sendGmailMessage(PAYLOAD, {
    ...VALID_ENV,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "ikke-en-private-key",
  }, dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.code, "invalid_configuration");
  assert.equal(requests.length, 0);
  assert.equal(logs.join(" ").includes("ikke-en-private-key"), false);
});

test("tokenfejl giver en sikker autorisationsfejl uden credentials i loggen", async () => {
  const logs: string[] = [];
  const result = await sendGmailMessage(PAYLOAD, VALID_ENV, {
    getAuthHeaders: async () => { throw new Error(`JWT signing failed: ${PRIVATE_KEY}`); },
    fetchImpl: fetch,
    logError: message => logs.push(message),
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.code, "unauthorized");
  assert.equal(logs.join(" ").includes("PRIVATE KEY"), false);
});

test("Gmail-success sender raw MIME til det låste messages.send-endpoint", async () => {
  const { dependencies, requests } = dependenciesFor(200, { id: "gmail-message-1" });
  const result = await sendGmailMessage(PAYLOAD, VALID_ENV, dependencies);
  assert.deepEqual(result, { ok: true, messageId: "gmail-message-1" });
  assert.equal(requests[0]?.input, GMAIL_SEND_ENDPOINT);
  const requestBody = JSON.parse(String(requests[0]?.init?.body)) as { raw: string };
  assert.equal(decodeMimeBody(Buffer.from(requestBody.raw, "base64url").toString("utf8")), PAYLOAD.html);
  assert.equal(String(requests[0]?.init?.body).includes("test-access-token"), false);
});

for (const [status, code, message] of [
  [401, "unauthorized", "Kontakt administrator"],
  [403, "unauthorized", "Kontakt administrator"],
  [429, "rate_limited", "midlertidigt belastet"],
  [500, "provider_unavailable", "midlertidigt utilgængelig"],
  [503, "provider_unavailable", "midlertidigt utilgængelig"],
] as const) {
  test(`Google ${status} oversættes til ${code}`, async () => {
    const { dependencies } = dependenciesFor(status, { error: { message: "må ikke vises" } });
    const result = await sendGmailMessage(PAYLOAD, VALID_ENV, dependencies);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, code);
      assert.match(result.error, new RegExp(message));
      assert.equal(result.error.includes("må ikke vises"), false);
    }
  });
}

test("invitation og rykker bruger korrekt recovery-tekst og dansk HTML", () => {
  const recovery = inviteEmailHtml({
    recipientName: "Søren",
    inviteUrl: "https://portal.example/auth/confirm",
    orgName: "Dansk Filmklipperselskab",
    accessType: "recovery",
  });
  const reminder = inviteEmailHtml({
    recipientName: "Søren",
    inviteUrl: "https://portal.example/auth/confirm",
    orgName: "Dansk Filmklipperselskab",
    variant: "reminder",
    accessType: "recovery",
  });
  assert.match(recovery, /Du har allerede en bruger/);
  assert.match(recovery, /Vælg ny adgangskode/);
  assert.match(reminder, /2\. invitation/);
});
