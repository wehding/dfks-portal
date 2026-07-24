import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { validateRegistrationNumber } from "@/lib/production-companies";

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
    const result = await db.from("employer_legal_entities").select("id,legal_name,registration_country,registration_type,registration_number,entity_kind,is_primary,registration_status,address,contact_phone,archived_at").eq("employer_id", id).is("archived_at", null).order("is_primary", { ascending: false }).order("legal_name");
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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi(["superadmin", "admin", "org-admin"]);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => null) as {
    name?: string;
    dfiCompanyId?: string | number | null;
    legalEntities?: Array<{ id?: string; legalName?: string; registrationNumber?: string; address?: string; contactPhone?: string; isPrimary?: boolean }>;
  } | null;
  const name = body?.name?.trim().replace(/\s+/g, " ");
  if (!name) return NextResponse.json({ error: "Producentnavn er påkrævet" }, { status: 400 });
  const preparedEntities = [];
  for (const entity of body?.legalEntities ?? []) {
    const legalName = entity.legalName?.trim();
    if (!legalName) continue;
    const registration = validateRegistrationNumber(entity.registrationNumber ?? "");
    if (!registration.valid) return NextResponse.json({ error: registration.error }, { status: 400 });
    preparedEntities.push({ entity, legalName, registrationNumber: registration.normalized });
  }

  const db = createServiceClient();
  const parsedDfiId = body?.dfiCompanyId ? Number(body.dfiCompanyId) : null;
  const employerUpdate = await db.from("employers").update({
    name,
    dfi_company_id: Number.isFinite(parsedDfiId) ? parsedDfiId : null,
    is_verified: Boolean(parsedDfiId),
    updated_at: new Date().toISOString(),
  }).eq("id", id).is("merged_into_id", null);
  if (employerUpdate.error) return NextResponse.json({ error: employerUpdate.error.message }, { status: 409 });

  if (preparedEntities.some(prepared => prepared.entity.isPrimary)) {
    const clearPrimary = await db.from("employer_legal_entities").update({ is_primary: false }).eq("employer_id", id).is("archived_at", null);
    if (clearPrimary.error) return NextResponse.json({ error: clearPrimary.error.message }, { status: 409 });
  }

  for (const prepared of preparedEntities) {
    const payload = {
      employer_id: id,
      legal_name: prepared.legalName,
      registration_country: "DK",
      registration_type: "CVR",
      registration_number: prepared.registrationNumber,
      entity_kind: "company",
      address: prepared.entity.address?.trim() || null,
      contact_phone: prepared.entity.contactPhone?.trim() || null,
      is_primary: Boolean(prepared.entity.isPrimary),
      updated_at: new Date().toISOString(),
    };
    const result = prepared.entity.id
      ? await db.from("employer_legal_entities").update(payload).eq("id", prepared.entity.id).eq("employer_id", id)
      : await db.from("employer_legal_entities").insert({ ...payload, created_by: auth.userId });
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
