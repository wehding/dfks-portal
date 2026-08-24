export const GMAIL_CONTRACT_MAILBOX = "bestyrelsen@danskfilmklipperselskab.dk";
export const GMAIL_CONTRACT_INPUT_LABEL = "kontrakter";
export const GMAIL_CONTRACT_OUTPUT_LABEL = "kontrakt gennemgang";
export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const MAX_GMAIL_CONTRACT_BYTES = 25 * 1024 * 1024;
export const GMAIL_RECONCILIATION_DAYS = 7;

export type GmailDateRange = {
  after: Date;
  before: Date;
};

export type GmailImportMessageResult = {
  imported: number;
  skipped: number;
  alreadyKnown: number;
};

export type GmailImportBatchResult = GmailImportMessageResult & {
  messages: number;
  failed: number;
};

const SUPPORTED_EXTENSIONS = new Set(["pdf", "doc", "docx"]);
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export type GmailHeader = { name?: string; value?: string };
export type GmailMessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailMessagePart[];
};

export type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailMessagePart;
};

export type GmailThread = {
  id: string;
  messages?: GmailMessage[];
};

export type GmailContractAttachment = {
  attachmentId: string;
  inlineData: string | null;
  fileName: string;
  mimeType: string;
  size: number | null;
};

export type ParsedGmailContractMessage = {
  gmailMessageId: string;
  gmailThreadId: string | null;
  internetMessageId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  subject: string | null;
  fromAddress: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  receivedAt: string | null;
  bodyText: string | null;
  attachments: GmailContractAttachment[];
};

function decodeBase64UrlBuffer(value: string): Buffer {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(`${normalized}${padding}`, "base64");
}

export function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function decodeBase64Url(value: string): Buffer {
  return decodeBase64UrlBuffer(value);
}

export function getGmailReconciliationRange(
  now = new Date(),
  days = GMAIL_RECONCILIATION_DAYS,
): GmailDateRange {
  if (Number.isNaN(now.getTime())) throw new Error("Tidspunktet for Gmail-genkontrollen er ugyldigt.");
  if (!Number.isInteger(days) || days < 1 || days > 30) {
    throw new Error("Gmail-genkontrollen skal være mellem 1 og 30 dage.");
  }
  return {
    after: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    before: new Date(now.getTime() + 60 * 1000),
  };
}

export function buildGmailDateRangeQuery(range: GmailDateRange): string {
  const after = range.after.getTime();
  const before = range.before.getTime();
  if (Number.isNaN(after) || Number.isNaN(before) || after >= before) {
    throw new Error("Datointervallet for Gmail-genkontrollen er ugyldigt.");
  }
  return `after:${Math.floor(after / 1000)} before:${Math.ceil(before / 1000)} has:attachment`;
}

export function buildGmailAttachmentExternalSourceId(messageId: string, fileHash: string): string {
  const normalizedMessageId = messageId.trim();
  const normalizedHash = fileHash.trim().toLowerCase();
  if (!normalizedMessageId || !/^[a-f0-9]{64}$/.test(normalizedHash)) {
    throw new Error("Gmail-bilagets stabile identitet er ugyldig.");
  }
  return `${normalizedMessageId}:sha256:${normalizedHash}`;
}

export async function processGmailMessageBatch(
  messageIds: string[],
  importer: (messageId: string) => Promise<GmailImportMessageResult>,
  onFailure?: (messageId: string, error: unknown) => void,
): Promise<GmailImportBatchResult> {
  const uniqueMessageIds = [...new Set(messageIds.filter(Boolean))];
  const result: GmailImportBatchResult = {
    imported: 0,
    skipped: 0,
    alreadyKnown: 0,
    messages: uniqueMessageIds.length,
    failed: 0,
  };

  for (const messageId of uniqueMessageIds) {
    try {
      const imported = await importer(messageId);
      result.imported += imported.imported;
      result.skipped += imported.skipped;
      result.alreadyKnown += imported.alreadyKnown;
    } catch (error) {
      result.failed += 1;
      onFailure?.(messageId, error);
    }
  }
  return result;
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string | null {
  const value = headers?.find(header => header.name?.toLowerCase() === name.toLowerCase())?.value?.trim();
  return value || null;
}

function splitAddresses(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").map(address => address.trim()).filter(Boolean).slice(0, 100);
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function normalizeMailText(value: string): string {
  return value
    .replaceAll("\u0000", "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, 200_000);
}

export function isSupportedContractAttachment(fileName: string, mimeType: string): boolean {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  return SUPPORTED_EXTENSIONS.has(extension) || SUPPORTED_MIME_TYPES.has(mimeType.toLowerCase());
}

function walkParts(part: GmailMessagePart | undefined, result: GmailMessagePart[] = []): GmailMessagePart[] {
  if (!part) return result;
  result.push(part);
  for (const child of part.parts ?? []) walkParts(child, result);
  return result;
}

export function parseGmailContractMessage(message: GmailMessage): ParsedGmailContractMessage {
  const parts = walkParts(message.payload);
  const plainPart = parts.find(part => part.mimeType?.toLowerCase() === "text/plain" && part.body?.data);
  const htmlPart = parts.find(part => part.mimeType?.toLowerCase() === "text/html" && part.body?.data);
  let bodyText: string | null = null;
  if (plainPart?.body?.data) bodyText = normalizeMailText(decodeBase64UrlBuffer(plainPart.body.data).toString("utf8"));
  else if (htmlPart?.body?.data) bodyText = normalizeMailText(htmlToPlainText(decodeBase64UrlBuffer(htmlPart.body.data).toString("utf8")));

  const attachments = parts.flatMap((part): GmailContractAttachment[] => {
    const fileName = part.filename?.trim() ?? "";
    const mimeType = part.mimeType?.toLowerCase() ?? "application/octet-stream";
    if (!fileName || !isSupportedContractAttachment(fileName, mimeType)) return [];
    const attachmentId = part.body?.attachmentId || (part.body?.data && part.partId ? `inline:${part.partId}` : "");
    if (!attachmentId) return [];
    return [{
      attachmentId,
      inlineData: part.body?.data ?? null,
      fileName: fileName.slice(0, 255),
      mimeType,
      size: typeof part.body?.size === "number" ? part.body.size : null,
    }];
  });

  const headers = message.payload?.headers;
  const internalDate = message.internalDate && /^\d+$/.test(message.internalDate)
    ? new Date(Number(message.internalDate)).toISOString()
    : null;
  const dateHeader = headerValue(headers, "Date");
  const parsedDate = dateHeader && !Number.isNaN(Date.parse(dateHeader)) ? new Date(dateHeader).toISOString() : null;

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId ?? null,
    internetMessageId: headerValue(headers, "Message-ID"),
    inReplyTo: headerValue(headers, "In-Reply-To"),
    referencesHeader: headerValue(headers, "References"),
    subject: headerValue(headers, "Subject"),
    fromAddress: headerValue(headers, "From"),
    toAddresses: splitAddresses(headerValue(headers, "To")),
    ccAddresses: splitAddresses(headerValue(headers, "Cc")),
    receivedAt: internalDate ?? parsedDate,
    bodyText: bodyText || null,
    attachments,
  };
}

export function isGmailDraftMessage(message: GmailMessage): boolean {
  return message.labelIds?.includes("DRAFT") ?? false;
}

export function parsePubSubNotificationBody(body: unknown): { emailAddress: string; historyId: string } {
  const envelope = body as { message?: { data?: unknown } } | null;
  const encoded = envelope?.message?.data;
  if (typeof encoded !== "string" || !encoded) throw new Error("Pub/Sub-meddelelsen mangler data.");
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("Pub/Sub-meddelelsen indeholder ugyldig JSON.");
  }
  const notification = payload as { emailAddress?: unknown; historyId?: unknown };
  if (typeof notification.emailAddress !== "string" || notification.emailAddress.toLowerCase() !== GMAIL_CONTRACT_MAILBOX) {
    throw new Error("Pub/Sub-meddelelsen gælder en anden postkasse.");
  }
  if (typeof notification.historyId !== "string" || !/^\d+$/.test(notification.historyId)) {
    throw new Error("Pub/Sub-meddelelsen mangler et gyldigt history-id.");
  }
  return { emailAddress: GMAIL_CONTRACT_MAILBOX, historyId: notification.historyId };
}

export function buildAddLabelRequest(labelId: string): { addLabelIds: string[] } {
  if (!labelId.trim()) throw new Error("Outputlabel-id mangler.");
  return { addLabelIds: [labelId.trim()] };
}

export function safeGmailStorageName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "kontrakt";
}

export function extractEmailAddress(value: string | null): string | null {
  if (!value) return null;
  const bracket = value.match(/<([^<>\s]+@[^<>\s]+)>/);
  const direct = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return (bracket?.[1] ?? direct?.[0] ?? null)?.toLowerCase() ?? null;
}
