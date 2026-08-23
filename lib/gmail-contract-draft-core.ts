import { normalizeReviewEmailAddress, normalizeReviewEmailAddresses, normalizeReviewMailHeader } from "@/lib/contract-review-email";

export const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
export const DEFAULT_CONTRACT_REVIEW_FROM = "kontrakt@danskfilmklipperselskab.dk";

export class GmailDraftNotFoundError extends Error {}

export type GmailDraftApiResponse = { id: string; message?: { id?: string; threadId?: string } };

export type ContractReviewDraftInput = {
  to: string;
  cc?: string[];
  subject: string;
  body: string;
  from: string;
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
};

function encodeHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export function buildContractReviewDraftMime(input: ContractReviewDraftInput): { raw: string; mime: string } {
  const to = normalizeReviewEmailAddress(input.to);
  const cc = normalizeReviewEmailAddresses(input.cc ?? []);
  const from = normalizeReviewEmailAddress(input.from);
  const subject = normalizeReviewMailHeader(input.subject, 500, "Emnet");
  const inReplyTo = input.inReplyTo ? normalizeReviewMailHeader(input.inReplyTo, 998, "In-Reply-To") : null;
  const references = input.references ? normalizeReviewMailHeader(input.references, 5_000, "References") : null;
  if (typeof input.body !== "string" || input.body.length > 50_000) throw new Error("Mailteksten er ugyldig eller for lang.");
  const encodedBody = Buffer.from(input.body, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
  const headers = [
    `From: DFKS Kontraktgennemgang <${from}>`,
    `To: ${to}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    ...(references ? [`References: ${references}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  const mime = `${headers.join("\r\n")}\r\n\r\n${encodedBody}`;
  return { mime, raw: Buffer.from(mime, "utf8").toString("base64url") };
}

export function resolveContractReviewFrom(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeReviewEmailAddress(env.GOOGLE_GMAIL_CONTRACT_REVIEW_FROM?.trim() || DEFAULT_CONTRACT_REVIEW_FROM);
}

export async function upsertGmailDraft(
  request: (path: string, method: "POST" | "PUT", body: unknown) => Promise<GmailDraftApiResponse>,
  message: { raw: string; threadId?: string },
  existingDraftId?: string | null,
) {
  const save = (draftId?: string | null) => request(draftId ? `/drafts/${encodeURIComponent(draftId)}` : "/drafts", draftId ? "PUT" : "POST", { message });
  try { return await save(existingDraftId); }
  catch (error) {
    if (existingDraftId && error instanceof GmailDraftNotFoundError) return save();
    throw error;
  }
}
