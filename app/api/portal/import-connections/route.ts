import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireMemberDriveContext } from "@/lib/server/member-drive-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const member = await requireMemberDriveContext();
  if (!member) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const db = createServiceClient();
  const { data, error } = await db.from("import_connections")
    .select("id,provider,display_name,account_label,status,granted_scopes,last_tested_at,last_error,updated_at")
    .eq("connection_kind", "member").eq("owner_user_id", member.userId).order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Drevforbindelserne kunne ikke hentes" }, { status: 500 });
  return NextResponse.json({ connections: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: NextRequest) {
  const member = await requireMemberDriveContext();
  if (!member) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Forbindelse mangler" }, { status: 400 });
  const db = createServiceClient({ audit: { actorUserId: member.userId, actorOrgId: member.orgId, actorRole: "member", source: "portal", correlationId: crypto.randomUUID(), mode: "summary" } });
  const { error } = await db.from("import_connections").delete()
    .eq("id", id).eq("connection_kind", "member").eq("owner_user_id", member.userId);
  if (error) return NextResponse.json({ error: "Forbindelsen kunne ikke fjernes" }, { status: 500 });
  return NextResponse.json({ success: true });
}
