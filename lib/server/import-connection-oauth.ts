import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { googleDriveOAuthCredentials } from "@/lib/import-oauth-environment";
import { importOAuthCallbackOrigin } from "@/lib/import-oauth-callback";

export type ImportProvider = "google_drive" | "onedrive" | "dropbox";

export type ImportConnectionKind = "organisation" | "member";
export type OAuthAttempt = {
  id: string; provider: ImportProvider; connectionKind: ImportConnectionKind;
  orgId: string; userId: string; rightsHolderId: string | null; returnPath: string;
  codeVerifier: string;
};

function encryptionKey() {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!secret) throw new Error("INTEGRATION_ENCRYPTION_KEY mangler");
  return createHash("sha256").update(secret).digest();
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

const ALLOWED_RETURN_PATHS = new Set(["/admin/organisation", "/portal/min-profil", "/portal/mine-kontrakter"]);

export async function createImportOAuthAttempt(input: {
  provider: ImportProvider; connectionKind: ImportConnectionKind; orgId: string; userId: string;
  rightsHolderId?: string | null; returnPath: string;
}) {
  const returnPath = ALLOWED_RETURN_PATHS.has(input.returnPath) ? input.returnPath : input.connectionKind === "member" ? "/portal/min-profil" : "/admin/organisation";
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const db = createServiceClient();
  const { error } = await db.from("import_oauth_attempts").insert({
    state_hash: createHash("sha256").update(state).digest("hex"), provider: input.provider,
    connection_kind: input.connectionKind, org_id: input.orgId, user_id: input.userId,
    rights_holder_id: input.rightsHolderId ?? null, return_path: returnPath,
    code_verifier_encrypted: encryptIntegrationCredentials({ codeVerifier }),
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) throw new Error("OAuth-forbindelsen kunne ikke startes");
  return { state, codeChallenge };
}

export async function consumeImportOAuthAttempt(state: string, provider: ImportProvider, userId: string): Promise<OAuthAttempt | null> {
  if (!state || state.length > 256) return null;
  const db = createServiceClient();
  const stateHash = createHash("sha256").update(state).digest("hex");
  const { data } = await db.from("import_oauth_attempts").select("id,provider,connection_kind,org_id,user_id,rights_holder_id,return_path,code_verifier_encrypted,expires_at,used_at")
    .eq("state_hash", stateHash).eq("provider", provider).eq("user_id", userId).maybeSingle();
  if (!data || data.used_at || new Date(data.expires_at).getTime() < Date.now()) return null;
  const usedAt = new Date().toISOString();
  const { data: consumed } = await db.from("import_oauth_attempts").update({ used_at: usedAt }).eq("id", data.id).is("used_at", null).select("id").maybeSingle();
  if (!consumed) return null;
  const credentials = decryptIntegrationCredentials<{ codeVerifier: string }>(data.code_verifier_encrypted);
  return {
    id: data.id, provider, connectionKind: data.connection_kind as ImportConnectionKind,
    orgId: data.org_id, userId: data.user_id, rightsHolderId: data.rights_holder_id,
    returnPath: ALLOWED_RETURN_PATHS.has(data.return_path) ? data.return_path : "/portal/min-profil",
    codeVerifier: credentials.codeVerifier,
  };
}

export function providerOAuthConfig(provider: ImportProvider, callbackUrl: string, connectionKind: ImportConnectionKind = "organisation") {
  if (provider === "google_drive") {
    const { clientId, clientSecret } = googleDriveOAuthCredentials(connectionKind, process.env);
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
    const tenant = process.env.MICROSOFT_GRAPH_TENANT_ID || (connectionKind === "member" ? "common" : "organizations");
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
  const origin = importOAuthCallbackOrigin(requestOrigin, process.env);
  return `${origin}/api/admin/import-connections/${provider}/callback`;
}
