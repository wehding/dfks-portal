import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { providerAccessToken } from "@/lib/server/import-provider-files";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ connectionId: string }> }) {
  const caller = await requireAdminApi(["superadmin", "admin", "org-admin"]);
  if (!caller.ok) return caller.response;
  const { connectionId } = await context.params;
  const db = createServiceClient();
  const { data: connection } = await db.from("import_connections")
    .select("id,provider,status,credentials_encrypted,connection_kind")
    .eq("id", connectionId).eq("org_id", caller.orgId).eq("connection_kind", "organisation").maybeSingle();
  if (!connection || connection.provider !== "google_drive" || connection.status !== "connected") {
    return NextResponse.json({ error: "Google Drive-forbindelsen blev ikke fundet" }, { status: 404 });
  }
  const developerKey = process.env.GOOGLE_PICKER_API_KEY;
  const appId = process.env.GOOGLE_CLOUD_PROJECT_NUMBER;
  if (!developerKey || !appId) {
    return NextResponse.json({ error: "Google Picker er ikke konfigureret. Tilføj GOOGLE_PICKER_API_KEY og GOOGLE_CLOUD_PROJECT_NUMBER." }, { status: 503 });
  }
  try {
    const accessToken = await providerAccessToken("google_drive", connection.credentials_encrypted, "organisation");
    return NextResponse.json({ accessToken, developerKey, appId }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[drive-picker] token failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Google Drive skal godkendes igen" }, { status: 502 });
  }
}
