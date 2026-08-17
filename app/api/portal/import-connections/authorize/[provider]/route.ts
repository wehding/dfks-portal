import { NextRequest, NextResponse } from "next/server";
import { canonicalImportCallback, createImportOAuthAttempt, providerOAuthConfig, type ImportProvider } from "@/lib/server/import-connection-oauth";
import { requireMemberDriveContext } from "@/lib/server/member-drive-context";

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const member = await requireMemberDriveContext();
  if (!member) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const rawProvider = (await context.params).provider;
  if (rawProvider !== "google_drive") return NextResponse.json({ error: "Kun Google Drive er tilgængelig i denne version" }, { status: 404 });
  const provider = rawProvider as ImportProvider;
  try {
    const returnPath = request.nextUrl.searchParams.get("returnTo") === "/portal/mine-kontrakter" ? "/portal/mine-kontrakter" : "/portal/min-profil";
    const callbackUrl = canonicalImportCallback(request.nextUrl.origin, provider);
    const config = providerOAuthConfig(provider, callbackUrl, "member");
    const attempt = await createImportOAuthAttempt({ provider, connectionKind: "member", orgId: member.orgId, userId: member.userId, rightsHolderId: member.rightsHolderId, returnPath });
    const url = new URL(config.authorizeUrl);
    url.searchParams.set("client_id", config.clientId); url.searchParams.set("redirect_uri", callbackUrl);
    url.searchParams.set("response_type", "code"); url.searchParams.set("state", attempt.state);
    url.searchParams.set("scope", config.scopes.join(" ")); url.searchParams.set("code_challenge", attempt.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    for (const [key, value] of Object.entries(config.authorizeParams)) url.searchParams.set(key, value);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("[portal-import-connection] authorize failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Forbindelsen kunne ikke startes" }, { status: 503 });
  }
}
