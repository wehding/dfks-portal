import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/api-auth";
import { browseGoogleDrive } from "@/lib/server/import-provider-files";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const caller = await requireAdminApi(["superadmin", "admin", "org-admin"]);
  if (!caller.ok) return caller.response;
  const connectionId = (await context.params).provider;
  const db = createServiceClient();
  const { data: connection } = await db.from("import_connections")
    .select("id,provider,credentials_encrypted,status")
    .eq("id", connectionId).eq("org_id", caller.orgId).eq("connection_kind", "organisation").maybeSingle();
  if (!connection || connection.provider !== "google_drive" || connection.status !== "connected") {
    return NextResponse.json({ error: "Google Drive-forbindelsen blev ikke fundet" }, { status: 404 });
  }
  try {
    const result = await browseGoogleDrive({
      encryptedCredentials: connection.credentials_encrypted,
      connectionKind: "organisation",
      folderId: request.nextUrl.searchParams.get("folderId") || "root",
      pageToken: request.nextUrl.searchParams.get("cursor") || undefined,
      sharedWithMe: request.nextUrl.searchParams.get("view") === "shared",
      pageSize: 100,
    });
    return NextResponse.json({
      folders: result.entries.filter(entry => entry.kind === "folder"),
      nextCursor: result.nextPageToken,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Drive-mappen kunne ikke læses";
    if (message.includes("godkendes igen")) {
      await db.from("import_connections").update({ status: "reauthorization_required", last_error: message }).eq("id", connection.id);
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
