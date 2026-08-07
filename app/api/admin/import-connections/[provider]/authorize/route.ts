import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { canonicalImportCallback, createImportOAuthState, providerOAuthConfig, type ImportProvider } from "@/lib/server/import-connection-oauth";

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const rawProvider = (await context.params).provider;
  if (!["google_drive", "onedrive", "dropbox"].includes(rawProvider)) return NextResponse.json({ error: "Ukendt provider" }, { status: 404 });
  const provider = rawProvider as ImportProvider;
  try {
    const callbackUrl = canonicalImportCallback(request.nextUrl.origin, provider);
    const config = providerOAuthConfig(provider, callbackUrl);
    const state = createImportOAuthState({ provider, orgId: caller.orgId, userId: caller.userId });
    const url = new URL(config.authorizeUrl);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", callbackUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("scope", config.scopes.join(" "));
    for (const [key, value] of Object.entries(config.authorizeParams)) url.searchParams.set(key, value);
    return NextResponse.redirect(url);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Forbindelsen kunne ikke startes" }, { status: 503 });
  }
}

