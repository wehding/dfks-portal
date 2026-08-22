import "server-only";

import { JWT, OAuth2Client } from "google-auth-library";
import { normalizePrivateKey } from "@/lib/email/gmail-core";
import {
  buildGmailDateRangeQuery,
  buildAddLabelRequest,
  GMAIL_CONTRACT_MAILBOX,
  GMAIL_MODIFY_SCOPE,
  type GmailDateRange,
  type GmailMessage,
  type GmailThread,
} from "@/lib/gmail-contract-import-core";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

type GmailLabel = { id: string; name: string; type?: string };
type GmailHistory = {
  history?: Array<{
    messagesAdded?: Array<{ message?: { id?: string; labelIds?: string[] } }>;
    labelsAdded?: Array<{ message?: { id?: string; labelIds?: string[] }; labelIds?: string[] }>;
  }>;
  nextPageToken?: string;
  historyId?: string;
};

export class GmailHistoryExpiredError extends Error {}

function readServiceAccount() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL?.trim();
  const keyValue = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !keyValue) throw new Error("Google-servicekontoen er ikke konfigureret.");
  const key = normalizePrivateKey(keyValue);
  if (!key.includes("-----BEGIN PRIVATE KEY-----") || !key.includes("-----END PRIVATE KEY-----")) {
    throw new Error("Google-servicekontoens private key er ugyldig.");
  }
  return { email, key };
}

async function getAuthHeaders(url: string): Promise<Record<string, string>> {
  const account = readServiceAccount();
  const auth = new JWT({
    email: account.email,
    key: account.key,
    scopes: [GMAIL_MODIFY_SCOPE],
    subject: GMAIL_CONTRACT_MAILBOX,
  });
  const headers = await auth.getRequestHeaders(url);
  return Object.fromEntries(new Headers(headers as HeadersInit).entries());
}

async function gmailRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${GMAIL_API}${path}`;
  const authHeaders = await getAuthHeaders(url);
  const response = await fetch(url, {
    ...init,
    headers: {
      ...authHeaders,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
  });
  if (response.status === 404 && path.startsWith("/history")) {
    throw new GmailHistoryExpiredError("Gmail history-id'et er udløbet.");
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Gmail API afviste kaldet (${response.status})${body ? `: ${body.slice(0, 500)}` : ""}`);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export async function listGmailLabels(): Promise<GmailLabel[]> {
  const result = await gmailRequest<{ labels?: GmailLabel[] }>("/labels");
  return result.labels ?? [];
}

export async function createGmailLabel(name: string): Promise<GmailLabel> {
  return gmailRequest<GmailLabel>("/labels", {
    method: "POST",
    body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }),
  });
}

export async function watchGmailContractLabel(topicName: string, inputLabelId: string) {
  return gmailRequest<{ historyId: string; expiration: string }>("/watch", {
    method: "POST",
    body: JSON.stringify({
      topicName,
      labelIds: [inputLabelId],
      labelFilterBehavior: "INCLUDE",
    }),
  });
}

export async function listGmailHistory(startHistoryId: string, inputLabelId: string) {
  const messageIds = new Set<string>();
  let pageToken: string | undefined;
  let latestHistoryId = startHistoryId;
  do {
    const params = new URLSearchParams({
      startHistoryId,
      labelId: inputLabelId,
      maxResults: "500",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const result = await gmailRequest<GmailHistory>(`/history?${params}`);
    for (const history of result.history ?? []) {
      for (const added of history.messagesAdded ?? []) if (added.message?.id) messageIds.add(added.message.id);
      for (const added of history.labelsAdded ?? []) {
        if (added.message?.id && added.labelIds?.includes(inputLabelId)) messageIds.add(added.message.id);
      }
    }
    if (result.historyId) latestHistoryId = result.historyId;
    pageToken = result.nextPageToken;
  } while (pageToken);
  return { messageIds: [...messageIds], historyId: latestHistoryId };
}

export async function listMessagesForLabel(inputLabelId: string, range: GmailDateRange): Promise<string[]> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      labelIds: inputLabelId,
      maxResults: "500",
      q: buildGmailDateRangeQuery(range),
    });
    if (pageToken) params.set("pageToken", pageToken);
    const result = await gmailRequest<{ messages?: Array<{ id?: string }>; nextPageToken?: string }>(`/messages?${params}`);
    for (const message of result.messages ?? []) if (message.id) ids.add(message.id);
    pageToken = result.nextPageToken;
  } while (pageToken);
  return [...ids];
}

export function getGmailMessage(messageId: string): Promise<GmailMessage> {
  return gmailRequest<GmailMessage>(`/messages/${encodeURIComponent(messageId)}?format=full`);
}

export function getGmailThread(threadId: string): Promise<GmailThread> {
  return gmailRequest<GmailThread>(`/threads/${encodeURIComponent(threadId)}?format=full`);
}

export async function getGmailAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
  const result = await gmailRequest<{ data?: string }>(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
  if (!result.data) throw new Error("Gmail-bilaget indeholder ingen data.");
  return Buffer.from(result.data.replaceAll("-", "+").replaceAll("_", "/"), "base64");
}

export async function addGmailOutputLabel(messageId: string, outputLabelId: string): Promise<void> {
  await gmailRequest(`/messages/${encodeURIComponent(messageId)}/modify`, {
    method: "POST",
    body: JSON.stringify(buildAddLabelRequest(outputLabelId)),
  });
}

export async function verifyPubSubPushToken(authorization: string | null): Promise<void> {
  const audience = process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE?.trim();
  const expectedEmail = process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL?.trim().toLowerCase();
  if (!audience || !expectedEmail) throw new Error("Pub/Sub push-verifikation er ikke konfigureret.");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("Pub/Sub-kaldet mangler bearer-token.");
  const ticket = await new OAuth2Client().verifyIdToken({ idToken: token, audience });
  const payload = ticket.getPayload();
  if (!payload || payload.email?.toLowerCase() !== expectedEmail || payload.email_verified !== true) {
    throw new Error("Pub/Sub-tokenet tilhører ikke den forventede servicekonto.");
  }
}
