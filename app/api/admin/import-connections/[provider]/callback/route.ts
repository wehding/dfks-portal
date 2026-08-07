import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { canonicalImportCallback, encryptIntegrationCredentials, providerOAuthConfig, verifyImportOAuthState, type ImportProvider } from "@/lib/server/import-connection-oauth";

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; account_id?: string; error?: string };

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const rawProvider = (await context.params).provider;
  const state = verifyImportOAuthState(request.nextUrl.searchParams.get("state") ?? "");
  const code = request.nextUrl.searchParams.get("code");
  const redirect = new URL("/admin/organisation", request.nextUrl.origin);
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!state || !caller || state.userId !== caller.userId || state.orgId !== caller.orgId || state.provider !== rawProvider || !code) {
    redirect.searchParams.set("import_connection", "invalid");
    return NextResponse.redirect(redirect);
  }
  const provider = rawProvider as ImportProvider;
  try {
    const callbackUrl = canonicalImportCallback(request.nextUrl.origin, provider);
    const config = providerOAuthConfig(provider, callbackUrl);
    const body = new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: callbackUrl, grant_type: "authorization_code" });
    const response = await fetch(config.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
    const tokens = await response.json() as TokenResponse;
    if (!response.ok || !tokens.access_token || !tokens.refresh_token) throw new Error("OAuth-token blev afvist");
    let accountId = tokens.account_id ?? `${provider}:${state.userId}`;
    let accountLabel = provider === "google_drive" ? "Google Drive" : provider === "onedrive" ? "Microsoft OneDrive" : "Dropbox";
    if (provider === "google_drive") {
      const about = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId)", { headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: "no-store" });
      if (about.ok) {
        const data = await about.json() as { user?: { displayName?: string; emailAddress?: string; permissionId?: string } };
        accountId = data.user?.permissionId ?? accountId;
        accountLabel = data.user?.emailAddress ?? data.user?.displayName ?? accountLabel;
      }
    } else if (provider === "onedrive") {
      const profile = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName", { headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: "no-store" });
      if (profile.ok) {
        const data = await profile.json() as { id?: string; displayName?: string; userPrincipalName?: string };
        accountId = data.id ?? accountId;
        accountLabel = data.userPrincipalName ?? data.displayName ?? accountLabel;
      }
    }
    const db = createServiceClient({ audit: { actorUserId: state.userId, actorOrgId: state.orgId, source: "admin", correlationId: crypto.randomUUID(), mode: "summary" } });
    const { error } = await db.from("import_connections").upsert({
      org_id: state.orgId, provider, display_name: accountLabel, account_label: accountLabel,
      provider_account_id: accountId,
      credentials_encrypted: encryptIntegrationCredentials({ refreshToken: tokens.refresh_token }),
      granted_scopes: (tokens.scope ?? config.scopes.join(" ")).split(/[ ,]+/).filter(Boolean),
      status: "connected", token_expires_at: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
      last_tested_at: new Date().toISOString(), last_error: null, created_by: state.userId, updated_at: new Date().toISOString(),
    }, { onConflict: "org_id,provider,provider_account_id" });
    if (error) throw new Error(error.message);
    redirect.searchParams.set("import_connection", "connected");
  } catch {
    redirect.searchParams.set("import_connection", "error");
  }
  return NextResponse.redirect(redirect);
}
