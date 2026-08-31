import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { canonicalImportCallback, consumeImportOAuthAttempt, encryptIntegrationCredentials, providerOAuthConfig, type ImportProvider } from "@/lib/server/import-connection-oauth";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; account_id?: string };

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const rawProvider = (await context.params).provider;
  if (rawProvider !== "google_drive") {
    return NextResponse.redirect(new URL("/portal/min-profil", request.nextUrl.origin));
  }
  const provider = rawProvider as ImportProvider;
  const callbackUrl = canonicalImportCallback(request.nextUrl.origin, provider);
  const redirectOrigin = new URL(callbackUrl).origin;
  const fallback = new URL("/portal/min-profil", redirectOrigin);
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) { fallback.searchParams.set("import_connection", "invalid"); return NextResponse.redirect(fallback); }
  const attempt = await consumeImportOAuthAttempt(request.nextUrl.searchParams.get("state") ?? "", provider, user.id);
  const redirect = new URL(attempt?.returnPath ?? "/portal/min-profil", redirectOrigin);
  const code = request.nextUrl.searchParams.get("code");
  if (!attempt || !code) { redirect.searchParams.set("import_connection", "invalid"); return NextResponse.redirect(redirect); }

  if (attempt.connectionKind === "organisation") {
    const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
    if (!caller || caller.userId !== attempt.userId || caller.orgId !== attempt.orgId) {
      redirect.searchParams.set("import_connection", "invalid"); return NextResponse.redirect(redirect);
    }
  }

  try {
    const config = providerOAuthConfig(provider, callbackUrl, attempt.connectionKind);
    const body = new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: callbackUrl, grant_type: "authorization_code", code_verifier: attempt.codeVerifier });
    const response = await fetch(config.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
    const tokens = await response.json() as TokenResponse;
    if (!response.ok || !tokens.access_token || !tokens.refresh_token) throw new Error("OAuth-token blev afvist");
    let accountId = tokens.account_id ?? `${provider}:${attempt.userId}`;
    let accountLabel = provider === "google_drive" ? "Google Drive" : provider === "onedrive" ? "Microsoft OneDrive" : "Dropbox";
    if (provider === "google_drive") {
      const about = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId)", { headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: "no-store" });
      if (about.ok) { const data = await about.json() as { user?: { displayName?: string; emailAddress?: string; permissionId?: string } }; accountId = data.user?.permissionId ?? accountId; accountLabel = data.user?.emailAddress ?? data.user?.displayName ?? accountLabel; }
    } else if (provider === "onedrive") {
      const profile = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName", { headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: "no-store" });
      if (profile.ok) { const data = await profile.json() as { id?: string; displayName?: string; userPrincipalName?: string }; accountId = data.id ?? accountId; accountLabel = data.userPrincipalName ?? data.displayName ?? accountLabel; }
    } else {
      const profile = await fetch("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: "no-store" });
      if (profile.ok) { const data = await profile.json() as { account_id?: string; email?: string; name?: { display_name?: string } }; accountId = data.account_id ?? accountId; accountLabel = data.email ?? data.name?.display_name ?? accountLabel; }
    }
    const db = createServiceClient({ audit: { actorUserId: attempt.userId, actorOrgId: attempt.orgId, actorRole: attempt.connectionKind === "member" ? "member" : "admin", source: attempt.connectionKind === "member" ? "portal" : "admin", correlationId: crypto.randomUUID(), mode: "summary" } });
    const query = db.from("import_connections").select("id").eq("provider", provider).eq("provider_account_id", accountId).eq("connection_kind", attempt.connectionKind);
    const existing = attempt.connectionKind === "member"
      ? await query.eq("owner_user_id", attempt.userId).maybeSingle()
      : await query.eq("org_id", attempt.orgId).maybeSingle();
    const values = {
      org_id: attempt.orgId, provider, connection_kind: attempt.connectionKind,
      owner_user_id: attempt.connectionKind === "member" ? attempt.userId : null,
      rights_holder_id: attempt.connectionKind === "member" ? attempt.rightsHolderId : null,
      display_name: accountLabel, account_label: accountLabel, provider_account_id: accountId,
      credentials_encrypted: encryptIntegrationCredentials({ refreshToken: tokens.refresh_token }),
      granted_scopes: (tokens.scope ?? config.scopes.join(" ")).split(/[ ,]+/).filter(Boolean),
      status: "connected", token_expires_at: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
      last_tested_at: new Date().toISOString(), last_error: null, created_by: attempt.userId, updated_at: new Date().toISOString(),
    };
    const result = existing.data?.id ? await db.from("import_connections").update(values).eq("id", existing.data.id) : await db.from("import_connections").insert(values);
    if (result.error) throw new Error(result.error.message);
    await recordSensitiveFlow({ actor: { userId: attempt.userId, orgId: attempt.orgId, role: attempt.connectionKind === "member" ? "member" : "admin", source: attempt.connectionKind === "member" ? "portal" : "admin" }, action: "link", component: "import-connections.oauth-callback", entityType: "import_connections", entityId: existing.data?.id ?? null, targetMemberUuid: attempt.rightsHolderId, orgIds: attempt.orgId ? [attempt.orgId] : [], purposeCode: "document_import_connection", legalBasis: "GDPR Art. 6(1)(b)/(f) og 9(2)(d)", dataCategories: ["integration_metadata", "document_metadata", "union_membership_data"] });
    redirect.searchParams.set("import_connection", "connected");
  } catch (error) {
    console.error("[import-oauth] Callback fejlede", error instanceof Error ? error.message : "Ukendt fejl");
    redirect.searchParams.set("import_connection", "error");
  }
  return NextResponse.redirect(redirect);
}
