import "server-only";

import { JWT } from "google-auth-library";
import {
  GMAIL_SEND_ENDPOINT,
  GMAIL_SEND_SCOPE,
  sendGmailMessage,
  type GmailConfig,
  type GmailSendResult,
} from "@/lib/email/gmail-core";
import type { MimeEmailPayload } from "@/lib/email/mime";

async function getAuthHeaders(config: GmailConfig): Promise<HeadersInit> {
  const auth = new JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: [GMAIL_SEND_SCOPE],
    subject: config.sender,
  });
  return auth.getRequestHeaders(GMAIL_SEND_ENDPOINT);
}

export function sendGmailEmail(payload: MimeEmailPayload): Promise<GmailSendResult> {
  return sendGmailMessage(payload, {
    GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    GOOGLE_GMAIL_SENDER: process.env.GOOGLE_GMAIL_SENDER,
  }, {
    getAuthHeaders,
    fetchImpl: fetch,
    logError: message => console.error(message),
  });
}
