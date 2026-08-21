import { NextRequest, NextResponse } from "next/server";
import { requireStaffModuleApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { auditRequestContext } from "@/lib/audit-access-server";
import { recordAuditEvent } from "@/lib/audit-log-server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffModuleApi("contracts", "read");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = createServiceClient();
  const { data: contract } = await db.from("contracts").select("id,rights_holder_id").eq("id", id).eq("org_id", auth.orgId).maybeSingle();
  if (!contract) return NextResponse.json({ error: "Kontrakten blev ikke fundet." }, { status: 404 });
  const { data, error } = await db
    .from("contract_employers")
    .select("employer_id,legal_entity_id,sort_order,employers(name),employer_legal_entities(legal_name,registration_number)")
    .eq("contract_id", id)
    .order("sort_order");
  if (error) {
    if (error.code === "42P01" || /schema cache/i.test(error.message)) return NextResponse.json({ data: [] });
    return NextResponse.json({ error: "Producenterne kunne ikke hentes." }, { status: 500 });
  }
  const selections = (data ?? []).map(row => {
    const employer = Array.isArray(row.employers) ? row.employers[0] : row.employers;
    const entity = Array.isArray(row.employer_legal_entities) ? row.employer_legal_entities[0] : row.employer_legal_entities;
    return {
      employerId: row.employer_id,
      legalEntityId: row.legal_entity_id ?? undefined,
      canonicalName: employer?.name ?? "Producent",
      legalName: entity?.legal_name ?? undefined,
      registrationNumber: entity?.registration_number ?? undefined,
    };
  });
  await recordAuditEvent({
    context: auditRequestContext(request, auth, "admin", "admin.contracts.producers"),
    action: "read",
    entityType: "contracts",
    entityId: id,
    entityLabel: "Kontraktproducenter",
    targetMemberUuid: contract.rights_holder_id,
    purposeCode: "contract_case_management",
    legalBasis: "GDPR Art. 6(1)(b) og 6(1)(f)",
    dataCategories: ["contract_data"],
    orgIds: [auth.orgId],
    metadata: { resultCount: selections.length },
  });
  return NextResponse.json({ data: selections });
}
