import { buildMimeMessage, normalizeSingleEmail, type MimeEmailPayload } from "@/lib/email/mime";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export type GmailErrorCode =
  | "not_configured"
  | "invalid_configuration"
  | "unauthorized"
  | "rate_limited"
  | "provider_unavailable"
  | "send_failed";

export type GmailSendResult =
  | { ok: true; messageId: string }
  | { ok: false; code: GmailErrorCode; error: string };

export interface GmailConfig {
  clientEmail: string;
  privateKey: string;
  sender: string;
}

export interface GmailEnvironment {
  GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL?: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  GOOGLE_GMAIL_SENDER?: string;
}

export interface GmailDependencies {
  getAuthHeaders(config: GmailConfig): Promise<HeadersInit>;
  fetchImpl: typeof fetch;
  logError(message: string): void;
}

export function normalizePrivateKey(value: string): string {
  const normalized = value.includes("\\n") ? value.replaceAll("\\n", "\n") : value;
  return normalized.replaceAll("\r\n", "\n").trim();
}

export function readGmailConfig(env: GmailEnvironment): GmailConfig | null {
  const clientEmail = env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL?.trim();
  const privateKeyValue = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const senderValue = env.GOOGLE_GMAIL_SENDER?.trim();
  if (!clientEmail || !privateKeyValue || !senderValue) return null;
  return {
    clientEmail: normalizeSingleEmail(clientEmail),
    privateKey: normalizePrivateKey(privateKeyValue),
    sender: normalizeSingleEmail(senderValue),
  };
}

function safeFailure(code: GmailErrorCode, error: string): GmailSendResult {
  return { ok: false, code, error };
}

export async function sendGmailMessage(
  payload: MimeEmailPayload,
  env: GmailEnvironment,
  dependencies: GmailDependencies,
): Promise<GmailSendResult> {
  let config: GmailConfig | null;
  try {
    config = readGmailConfig(env);
  } catch {
    dependencies.logError("[email:gmail] Google-mailkonfigurationen indeholder en ugyldig e-mailadresse.");
    return safeFailure("invalid_configuration", "E-mail kunne ikke sendes. Kontakt administrator.");
  }
  if (!config) {
    dependencies.logError("[email:gmail] En eller flere obligatoriske Google-mailvariabler mangler.");
    return safeFailure("not_configured", "E-mail ikke konfigureret");
  }
  if (!config.privateKey.includes("-----BEGIN PRIVATE KEY-----") || !config.privateKey.includes("-----END PRIVATE KEY-----")) {
    dependencies.logError("[email:gmail] Servicekontoens private key har et ugyldigt format.");
    return safeFailure("invalid_configuration", "E-mail kunne ikke sendes. Kontakt administrator.");
  }

  let raw: string;
  try {
    raw = buildMimeMessage(payload, config.sender).raw;
  } catch {
    dependencies.logError("[email:gmail] Mailen indeholder en ugyldig adresse eller header.");
    return safeFailure("send_failed", "E-mail kunne ikke sendes.");
  }

  let authHeaders: HeadersInit;
  try {
    authHeaders = await dependencies.getAuthHeaders(config);
  } catch {
    dependencies.logError("[email:gmail] Servicekontoen kunne ikke autoriseres. Kontrollér client email, private key, domain-wide delegation, gmail.send-scope og senderkonto.");
    return safeFailure("unauthorized", "E-mail kunne ikke sendes. Kontakt administrator.");
  }

  try {
    const response = await dependencies.fetchImpl(GMAIL_SEND_ENDPOINT, {
      method: "POST",
      headers: {
        ...Object.fromEntries(new Headers(authHeaders).entries()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });

    if (response.ok) {
      const responseBody = await response.json().catch(() => null) as { id?: unknown } | null;
      if (typeof responseBody?.id === "string" && responseBody.id) {
        return { ok: true, messageId: responseBody.id };
      }
      dependencies.logError("[email:gmail] Gmail returnerede succes uden et message-id.");
      return safeFailure("send_failed", "E-mail kunne ikke sendes.");
    }

    if (response.status === 401 || response.status === 403) {
      dependencies.logError(`[email:gmail] Google afviste autorisationen (${response.status}). Kontrollér servicekonto, domain-wide delegation, gmail.send-scope og aktiv senderkonto.`);
      return safeFailure("unauthorized", "E-mail kunne ikke sendes. Kontakt administrator.");
    }
    if (response.status === 429) {
      dependencies.logError("[email:gmail] Google rate-limit blev nået (429).");
      return safeFailure("rate_limited", "E-mailtjenesten er midlertidigt belastet. Prøv igen senere.");
    }
    if (response.status >= 500) {
      dependencies.logError(`[email:gmail] Google Gmail API er midlertidigt utilgængelig (${response.status}).`);
      return safeFailure("provider_unavailable", "E-mailtjenesten er midlertidigt utilgængelig.");
    }

    dependencies.logError(`[email:gmail] Google Gmail API afviste mailen (${response.status}).`);
    return safeFailure("send_failed", "E-mail kunne ikke sendes.");
  } catch {
    dependencies.logError("[email:gmail] Netværksfejl under kald til Google Gmail API.");
    return safeFailure("provider_unavailable", "E-mailtjenesten er midlertidigt utilgængelig.");
  }
}
