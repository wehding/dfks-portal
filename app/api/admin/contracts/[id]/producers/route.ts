import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = createServiceClient();
  const { data: contract } = await db.from("contracts").select("id").eq("id", id).eq("org_id", auth.orgId).maybeSingle();
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
  return NextResponse.json({ data: selections });
}

