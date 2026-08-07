import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";

export async function GET() {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const db = createServiceClient();
  const { data, error } = await db.from("import_sources")
    .select("id,connection_id,import_type,provider_folder_id,display_name,recursive,auto_sync,last_synced_at,last_error,enabled,import_connections(provider,account_label,display_name)")
    .eq("org_id", caller.orgId)
    .order("display_name");
  if (error) return NextResponse.json({ error: "Importmapperne kunne ikke hentes" }, { status: 500 });
  return NextResponse.json({ sources: data ?? [] });
}

export async function POST(request: NextRequest) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as {
    connectionId?: string;
    importType?: string;
    folderId?: string;
    displayName?: string;
    recursive?: boolean;
    autoSync?: boolean;
  };
  const allowedTypes = ["contracts", "contract_reviews", "screenings", "members", "producers", "works"];
  if (!body.connectionId || !body.folderId?.trim() || !body.displayName?.trim() || !allowedTypes.includes(body.importType ?? "")) {
    return NextResponse.json({ error: "Udfyld forbindelse, importtype, mappenavn og mappe-id" }, { status: 400 });
  }
  const db = createServiceClient({ audit: {
    actorUserId: caller.userId,
    actorOrgId: caller.orgId,
    actorRole: caller.role,
    source: "admin",
    correlationId: crypto.randomUUID(),
    mode: "summary",
  } });
  const { data: connection } = await db.from("import_connections").select("id")
    .eq("id", body.connectionId).eq("org_id", caller.orgId).eq("status", "connected").maybeSingle();
  if (!connection) return NextResponse.json({ error: "Drevforbindelsen blev ikke fundet" }, { status: 404 });
  const { data, error } = await db.from("import_sources").insert({
    org_id: caller.orgId,
    connection_id: connection.id,
    import_type: body.importType,
    provider_folder_id: body.folderId.trim(),
    display_name: body.displayName.trim(),
    recursive: body.recursive !== false,
    auto_sync: body.autoSync !== false,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "Mappen er allerede oprettet" : "Importmappen kunne ikke gemmes" }, { status: 500 });
  return NextResponse.json({ source: data });
}

export async function DELETE(request: NextRequest) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Importmappe-id mangler" }, { status: 400 });
  const db = createServiceClient({ audit: { actorUserId: caller.userId, actorOrgId: caller.orgId, actorRole: caller.role, source: "admin", correlationId: crypto.randomUUID(), mode: "summary" } });
  const { error } = await db.from("import_sources").delete().eq("id", id).eq("org_id", caller.orgId);
  if (error) return NextResponse.json({ error: "Importmappen kunne ikke fjernes" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
