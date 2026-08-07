import "server-only";

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type ImportProvider = "google_drive" | "onedrive" | "dropbox";

type OAuthState = { provider: ImportProvider; orgId: string; userId: string; expiresAt: number };

function encryptionKey() {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!secret) throw new Error("INTEGRATION_ENCRYPTION_KEY mangler");
  return createHash("sha256").update(secret).digest();
}

function stateSecret() {
  const secret = process.env.IMPORT_OAUTH_STATE_SECRET ?? process.env.INTERNAL_API_SECRET;
  if (!secret) throw new Error("IMPORT_OAUTH_STATE_SECRET mangler");
  return secret;
}

export function encryptIntegrationCredentials(value: Record<string, unknown>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
}

export function decryptIntegrationCredentials<T extends Record<string, unknown>>(value: string): T {
  if (!value.startsWith("v1.")) throw new Error("Ukendt credentialformat");
  const payload = Buffer.from(value.slice(3), "base64url");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8")) as T;
}

export function createImportOAuthState(input: Omit<OAuthState, "expiresAt">) {
  const payload = Buffer.from(JSON.stringify({ ...input, expiresAt: Date.now() + 10 * 60_000 })).toString("base64url");
  const signature = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyImportOAuthState(value: string): OAuthState | null {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", stateSecret()).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (!state.orgId || !state.userId || !["google_drive", "onedrive", "dropbox"].includes(state.provider) || state.expiresAt < Date.now()) return null;
    return state;
  } catch {
    return null;
  }
}

export function providerOAuthConfig(provider: ImportProvider, callbackUrl: string) {
  if (provider === "google_drive") {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Google Drive er ikke konfigureret");
    return {
      clientId, clientSecret,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      authorizeParams: { access_type: "offline", prompt: "consent" }, callbackUrl,
    };
  }
  if (provider === "onedrive") {
    const clientId = process.env.MICROSOFT_GRAPH_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_GRAPH_CLIENT_SECRET;
    const tenant = process.env.MICROSOFT_GRAPH_TENANT_ID || "organizations";
    if (!clientId || !clientSecret) throw new Error("Microsoft OneDrive er ikke konfigureret");
    return {
      clientId, clientSecret,
      authorizeUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
      scopes: ["offline_access", "Files.Read", "User.Read"], authorizeParams: {}, callbackUrl,
    };
  }
  const clientId = process.env.DROPBOX_APP_KEY;
  const clientSecret = process.env.DROPBOX_APP_SECRET;
  if (!clientId || !clientSecret) throw new Error("Dropbox er ikke konfigureret");
  return {
    clientId, clientSecret,
    authorizeUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    scopes: ["account_info.read", "files.metadata.read", "files.content.read"],
    authorizeParams: { token_access_type: "offline" }, callbackUrl,
  };
}

export function canonicalImportCallback(requestOrigin: string, provider: ImportProvider) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  const useRequestOrigin = requestOrigin.startsWith("http://localhost:") || process.env.VERCEL_ENV === "preview";
  const origin = useRequestOrigin ? requestOrigin : configured ?? requestOrigin;
  return `${origin}/api/admin/import-connections/${provider}/callback`;
}
