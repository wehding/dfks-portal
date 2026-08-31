import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { revokeProviderCredentials } from "@/lib/server/import-provider-files";
import type { ImportProvider } from "@/lib/server/import-connection-oauth";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

export async function GET() {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const db = createServiceClient();
  const { data, error } = await db.from("import_connections")
    .select("id,provider,display_name,account_label,status,granted_scopes,last_tested_at,last_error,created_at")
    .eq("org_id", caller.orgId).eq("connection_kind", "organisation").eq("provider", "google_drive").order("created_at");
  if (error) return NextResponse.json({ error: "Forbindelserne kunne ikke hentes" }, { status: 500 });
  await recordSensitiveFlow({ actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" }, action: "read", component: "admin.import-connections.list", entityType: "import_connections", orgIds: [caller.orgId], purposeCode: "document_import_administration", legalBasis: "GDPR Art. 6(1)(c)/(f) og 9(2)(d)", dataCategories: ["integration_metadata", "document_metadata"], counts: { results: data?.length ?? 0 } });
  return NextResponse.json({ connections: data ?? [] });
}

export async function DELETE(request: NextRequest) {
  const session = await createClient();
  const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"]);
  if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Forbindelses-id mangler" }, { status: 400 });
  const db = createServiceClient({ audit: { actorUserId: caller.userId, actorOrgId: caller.orgId, actorRole: caller.role, source: "admin", correlationId: crypto.randomUUID(), mode: "summary" } });
  const { data: connection } = await db.from("import_connections").select("provider,credentials_encrypted")
    .eq("id", id).eq("org_id", caller.orgId).eq("connection_kind", "organisation").maybeSingle();
  if (!connection) return NextResponse.json({ error: "Forbindelsen blev ikke fundet" }, { status: 404 });
  await revokeProviderCredentials(connection.provider as ImportProvider, connection.credentials_encrypted);
  const { error } = await db.from("import_connections").delete().eq("id", id).eq("org_id", caller.orgId).eq("connection_kind", "organisation");
  if (error) return NextResponse.json({ error: "Forbindelsen kunne ikke fjernes" }, { status: 500 });
  await recordSensitiveFlow({ actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" }, action: "unlink", component: "admin.import-connections.delete", entityType: "import_connections", entityId: id, orgIds: [caller.orgId], purposeCode: "document_import_administration", legalBasis: "GDPR Art. 6(1)(c)/(f) og 9(2)(d)", dataCategories: ["integration_metadata", "document_metadata"] });
  return NextResponse.json({ ok: true });
}
