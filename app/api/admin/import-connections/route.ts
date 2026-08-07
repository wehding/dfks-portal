import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";

export async function GET() {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const db = createServiceClient();
  const { data, error } = await db.from("import_connections")
    .select("id,provider,display_name,account_label,status,granted_scopes,last_tested_at,last_error,created_at")
    .eq("org_id", caller.orgId).eq("connection_kind", "organisation").order("created_at");
  if (error) return NextResponse.json({ error: "Forbindelserne kunne ikke hentes" }, { status: 500 });
  return NextResponse.json({ connections: data ?? [] });
}

export async function DELETE(request: NextRequest) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Forbindelses-id mangler" }, { status: 400 });
  const db = createServiceClient({ audit: { actorUserId: caller.userId, actorOrgId: caller.orgId, actorRole: caller.role, source: "admin", correlationId: crypto.randomUUID(), mode: "summary" } });
  const { error } = await db.from("import_connections").delete().eq("id", id).eq("org_id", caller.orgId).eq("connection_kind", "organisation");
  if (error) return NextResponse.json({ error: "Forbindelsen kunne ikke fjernes" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
