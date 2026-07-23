import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const type = new URL(req.url).searchParams.get("type");
  if (type !== "works" && type !== "contracts" && type !== "legal_entities") return NextResponse.json({ error: "Ugyldig detaljetype" }, { status: 400 });
  const db = createServiceClient();
  const { data: producer } = await db.from("employers").select("id").eq("id", id).maybeSingle();
  if (!producer) return NextResponse.json({ error: "Producent ikke fundet" }, { status: 404 });
  if (type === "legal_entities") {
    const result = await db.from("employer_legal_entities").select("id,legal_name,registration_country,registration_type,registration_number,entity_kind,is_primary,registration_status,archived_at").eq("employer_id", id).is("archived_at", null).order("is_primary", { ascending: false }).order("legal_name");
    if (result.error) return NextResponse.json({ error: "Juridiske enheder kunne ikke hentes" }, { status: 500 });
    return NextResponse.json({ data: result.data ?? [] });
  }
  const result = type === "works"
    ? await db.from("works").select("id,title,type,year,status,created_at,work_employers!inner(employer_id),work_organisations!inner(org_id)").eq("work_employers.employer_id", id).eq("work_organisations.org_id", auth.orgId).order("created_at", { ascending: false })
    : await db.from("contracts").select("id,working_title,type,status,contract_date,created_at,rettighedshavere(full_name),contract_employers!inner(employer_id)").eq("org_id", auth.orgId).eq("contract_employers.employer_id", id).order("created_at", { ascending: false });
  if (result.error && (result.error.code === "42P01" || /schema cache|relationship/i.test(result.error.message))) {
    const fallback = type === "works"
      ? await db.from("works").select("id,title,type,year,status,created_at").eq("org_id", auth.orgId).eq("employer_id", id).order("created_at", { ascending: false })
      : await db.from("contracts").select("id,working_title,type,status,contract_date,created_at,rettighedshavere(full_name)").eq("org_id", auth.orgId).eq("employer_id", id).order("created_at", { ascending: false });
    if (fallback.error) return NextResponse.json({ error: "Detaljer kunne ikke hentes" }, { status: 500 });
    return NextResponse.json({ data: fallback.data ?? [] });
  }
  if (result.error) return NextResponse.json({ error: "Detaljer kunne ikke hentes" }, { status: 500 });
  return NextResponse.json({ data: result.data ?? [] });
}
