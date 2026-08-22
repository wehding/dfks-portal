import "server-only";

import { JWT } from "google-auth-library";
import { normalizePrivateKey } from "@/lib/email/gmail-core";
import { GMAIL_CONTRACT_MAILBOX } from "@/lib/gmail-contract-import-core";
import { buildContractReviewDraftMime, GmailDraftNotFoundError, GMAIL_COMPOSE_SCOPE, resolveContractReviewFrom, upsertGmailDraft, type ContractReviewDraftInput, type GmailDraftApiResponse } from "@/lib/gmail-contract-draft-core";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

function serviceAccount() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL?.trim();
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) throw new Error("Google-servicekontoen er ikke konfigureret.");
  const key = normalizePrivateKey(rawKey);
  if (!key.includes("-----BEGIN PRIVATE KEY-----") || !key.includes("-----END PRIVATE KEY-----")) {
    throw new Error("Google-servicekontoens private key er ugyldig.");
  }
  return { email, key };
}

async function composeRequest<T>(path: string, init: RequestInit): Promise<T> {
  const url = `${GMAIL_API}${path}`;
  const account = serviceAccount();
  const auth = new JWT({ email: account.email, key: account.key, scopes: [GMAIL_COMPOSE_SCOPE], subject: GMAIL_CONTRACT_MAILBOX });
  const authHeaders = await auth.getRequestHeaders(url);
  const response = await fetch(url, {
    ...init,
    headers: { ...Object.fromEntries(new Headers(authHeaders as HeadersInit).entries()), "Content-Type": "application/json" },
  });
  if (response.status === 404) throw new GmailDraftNotFoundError("Gmail-kladden findes ikke længere.");
  if (!response.ok) throw new Error(`Gmail kunne ikke gemme kladden (${response.status}).`);
  return response.json() as Promise<T>;
}

export async function saveGmailContractReviewDraft(input: Omit<ContractReviewDraftInput, "from">, existingDraftId?: string | null) {
  const { raw } = buildContractReviewDraftMime({ ...input, from: resolveContractReviewFrom() });
  return upsertGmailDraft(
    (path, method, body) => composeRequest<GmailDraftApiResponse>(path, { method, body: JSON.stringify(body) }),
    { raw, ...(input.threadId ? { threadId: input.threadId } : {}) },
    existingDraftId,
  );
}
