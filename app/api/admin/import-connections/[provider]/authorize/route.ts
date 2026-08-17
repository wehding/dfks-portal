import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { canonicalImportCallback, createImportOAuthAttempt, providerOAuthConfig, type ImportProvider } from "@/lib/server/import-connection-oauth";

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const rawProvider = (await context.params).provider;
  if (rawProvider !== "google_drive") return NextResponse.json({ error: "Kun Google Drive er tilgængelig i denne version" }, { status: 404 });
  const provider = rawProvider as ImportProvider;
  try {
    const callbackUrl = canonicalImportCallback(request.nextUrl.origin, provider);
    const config = providerOAuthConfig(provider, callbackUrl, "organisation");
    const attempt = await createImportOAuthAttempt({ provider, connectionKind: "organisation", orgId: caller.orgId, userId: caller.userId, returnPath: "/admin/organisation" });
    const url = new URL(config.authorizeUrl);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", callbackUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", attempt.state);
    url.searchParams.set("scope", config.scopes.join(" "));
    url.searchParams.set("code_challenge", attempt.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    for (const [key, value] of Object.entries(config.authorizeParams)) url.searchParams.set(key, value);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("[admin-import-connection] authorize failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Forbindelsen kunne ikke startes" }, { status: 503 });
  }
}
