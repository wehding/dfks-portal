export interface MimeEmailPayload {
  to: string;
  subject: string;
  html: string;
  fromName: string;
  replyTo?: string;
}

const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

function assertSafeHeader(value: string, label: string) {
  if (!value || /[\r\n\0]/.test(value)) {
    throw new Error(`${label} indeholder ugyldige tegn`);
  }
}

export function normalizeSingleEmail(value: string): string {
  const email = value.trim();
  assertSafeHeader(email, "E-mailadresse");
  if (!EMAIL_PATTERN.test(email)) throw new Error("E-mailadressen er ugyldig");
  return email;
}

function encodeHeader(value: string, label: string): string {
  const normalized = value.trim();
  assertSafeHeader(normalized, label);
  return `=?UTF-8?B?${Buffer.from(normalized, "utf8").toString("base64")}?=`;
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

export function buildMimeMessage(
  payload: MimeEmailPayload,
  sender: string,
): { mime: string; raw: string } {
  const fromEmail = normalizeSingleEmail(sender);
  const to = normalizeSingleEmail(payload.to);
  const fromName = encodeHeader(payload.fromName, "Afsendernavn");
  const subject = encodeHeader(payload.subject, "Emne");
  const html = wrapBase64(Buffer.from(payload.html, "utf8").toString("base64"));
  const headers = [
    `From: ${fromName} <${fromEmail}>`,
    `To: ${to}`,
    ...(payload.replyTo ? [`Reply-To: ${normalizeSingleEmail(payload.replyTo)}`] : []),
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  const mime = `${headers.join("\r\n")}\r\n\r\n${html}`;
  return {
    mime,
    raw: Buffer.from(mime, "utf8").toString("base64url"),
  };
}
