import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireMemberDriveContext } from "@/lib/server/member-drive-context";
import { revokeProviderCredentials } from "@/lib/server/import-provider-files";
import type { ImportProvider } from "@/lib/server/import-connection-oauth";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const member = await requireMemberDriveContext();
  if (!member) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const db = createServiceClient();
  const { data, error } = await db.from("import_connections")
    .select("id,provider,display_name,account_label,status,granted_scopes,last_tested_at,last_error,updated_at")
    .eq("connection_kind", "member").eq("owner_user_id", member.userId).eq("provider", "google_drive").order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Drevforbindelserne kunne ikke hentes" }, { status: 500 });
  await recordSensitiveFlow({ actor: { userId: member.userId, orgId: member.orgId, role: "member", source: "portal" }, action: "read", component: "portal.import-connections.list", entityType: "import_connections", targetMemberUuid: member.rightsHolderId, orgIds: [member.orgId], purposeCode: "member_contract_import", legalBasis: "GDPR Art. 6(1)(b) og 9(2)(d)", dataCategories: ["integration_metadata", "document_metadata", "union_membership_data"], counts: { results: data?.length ?? 0 } });
  return NextResponse.json({ connections: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: NextRequest) {
  const member = await requireMemberDriveContext();
  if (!member) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Forbindelse mangler" }, { status: 400 });
  const db = createServiceClient({ audit: { actorUserId: member.userId, actorOrgId: member.orgId, actorRole: "member", source: "portal", correlationId: crypto.randomUUID(), mode: "summary" } });
  const { data: connection } = await db.from("import_connections").select("provider,credentials_encrypted")
    .eq("id", id).eq("connection_kind", "member").eq("owner_user_id", member.userId).maybeSingle();
  if (!connection) return NextResponse.json({ error: "Forbindelsen blev ikke fundet" }, { status: 404 });
  await revokeProviderCredentials(connection.provider as ImportProvider, connection.credentials_encrypted);
  const { error } = await db.from("import_connections").delete()
    .eq("id", id).eq("connection_kind", "member").eq("owner_user_id", member.userId);
  if (error) return NextResponse.json({ error: "Forbindelsen kunne ikke fjernes" }, { status: 500 });
  await recordSensitiveFlow({ actor: { userId: member.userId, orgId: member.orgId, role: "member", source: "portal" }, action: "unlink", component: "portal.import-connections.delete", entityType: "import_connections", entityId: id, targetMemberUuid: member.rightsHolderId, orgIds: [member.orgId], purposeCode: "member_contract_import", legalBasis: "GDPR Art. 6(1)(b) og 9(2)(d)", dataCategories: ["integration_metadata", "document_metadata", "union_membership_data"] });
  return NextResponse.json({ success: true });
}
