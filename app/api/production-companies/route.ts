import { NextRequest, NextResponse } from "next/server";
import { requireSessionApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  companyMatchScore,
  normalizeCompanyName,
  validateRegistrationNumber,
  type LegalEntityKind,
  type ProductionCompanyOption,
} from "@/lib/production-companies";

type EmployerRow = {
  id: string;
  name: string;
  is_verified?: boolean | null;
  employer_aliases?: Array<{ alias: string }> | null;
  employer_external_ids?: Array<{ source: string; external_id: string; external_name: string | null; approved: boolean }> | null;
  employer_legal_entities?: Array<{
    id: string;
    legal_name: string;
    registration_country: string;
    registration_type: string;
    registration_number: string | null;
    entity_kind: LegalEntityKind;
    is_primary: boolean;
    registration_status: string | null;
    address?: string | null;
    contact_phone?: string | null;
    contact_email?: string | null;
    website?: string | null;
    industry_code?: string | null;
    industry_description?: string | null;
    company_type?: string | null;
    archived_at: string | null;
  }> | null;
};

function toOption(row: EmployerRow): ProductionCompanyOption {
  return {
    employerId: row.id,
    canonicalName: row.name,
    aliases: (row.employer_aliases ?? []).map(alias => alias.alias),
    legalEntities: (row.employer_legal_entities ?? [])
      .filter(entity => !entity.archived_at)
      .map(entity => ({
        id: entity.id,
        legalName: entity.legal_name,
        registrationCountry: entity.registration_country,
        registrationType: entity.registration_type,
        registrationNumber: entity.registration_number,
        entityKind: entity.entity_kind,
        isPrimary: entity.is_primary,
        registrationStatus: entity.registration_status,
        address: entity.address ?? null,
        contactPhone: entity.contact_phone ?? null,
        contactEmail: entity.contact_email ?? null,
        website: entity.website ?? null,
        industryCode: entity.industry_code ?? null,
        industryDescription: entity.industry_description ?? null,
        companyType: entity.company_type ?? null,
      })),
    isVerified: Boolean(row.is_verified),
    externalIdentities: (row.employer_external_ids ?? []).map(identity => ({
      source: identity.source,
      externalId: identity.external_id,
      externalName: identity.external_name,
      approved: identity.approved,
    })),
  };
}

async function readCompanies() {
  const db = createServiceClient();
  const { data, error } = await db
    .from("employers")
    .select(`
      id,name,is_verified,
      employer_aliases(alias),
      employer_external_ids(source,external_id,external_name,approved),
      employer_legal_entities(id,legal_name,registration_country,registration_type,registration_number,entity_kind,is_primary,registration_status,address,contact_phone,contact_email,website,industry_code,industry_description,company_type,archived_at)
    `)
    .is("merged_into_id", null)
    .is("archived_at", null)
    .order("name");
  if (error) {
    if (error.code !== "42P01" && error.code !== "PGRST205" && !/schema cache|relationship|column/i.test(error.message)) throw error;
    const legacy = await db.from("employers").select("id,name,cvr").order("name");
    if (legacy.error) throw legacy.error;
    return (legacy.data ?? []).map(row => ({
      employerId: row.id,
      canonicalName: row.name,
      aliases: [],
      legalEntities: [],
      isVerified: false,
      externalIdentities: [],
    } satisfies ProductionCompanyOption));
  }
  return ((data ?? []) as EmployerRow[]).map(toOption);
}

export async function GET(req: NextRequest) {
  const auth = await requireSessionApi();
  if (!auth.ok) return auth.response;
  const query = (req.nextUrl.searchParams.get("query") ?? "").trim().slice(0, 100);
  const externalSource = (req.nextUrl.searchParams.get("source") ?? "").trim();
  const externalId = (req.nextUrl.searchParams.get("externalId") ?? "").trim();
  try {
    const companies = await readCompanies();
    const rows = companies.map(company => {
      const externalMatch = Boolean(externalSource && externalId && company.externalIdentities?.some(identity =>
        identity.source === externalSource && identity.externalId === externalId && identity.approved
      ));
      const score = externalMatch ? 120 : companyMatchScore(company, query);
      const normalizedQuery = normalizeCompanyName(query);
      const exactName = [company.canonicalName, ...company.aliases, ...company.legalEntities.map(entity => entity.legalName)]
        .some(name => normalizeCompanyName(name) === normalizedQuery);
      return {
        company: {
          ...company,
          matchScore: score,
          matchMethod: externalMatch ? "external_id" as const : exactName ? "exact_name" as const : "fuzzy_name" as const,
          externalMatch,
        },
        score,
      };
    });
    return NextResponse.json({
      data: rows
        .filter(result => result.score > 0)
        .sort((left, right) => right.score - left.score
          || Number(right.company.isVerified) - Number(left.company.isVerified)
          || left.company.canonicalName.localeCompare(right.company.canonicalName, "da-DK"))
        .slice(0, 20)
        .map(result => result.company),
    });
  } catch {
    return NextResponse.json({ error: "Produktionsselskaber kunne ikke hentes." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireSessionApi();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null) as {
    action?: "canonical" | "legal_entity";
    name?: string;
    employerId?: string;
    legalName?: string;
    registrationCountry?: string;
    registrationType?: string;
    registrationNumber?: string;
    entityKind?: LegalEntityKind;
    address?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    website?: string | null;
    industryCode?: string | null;
    industryDescription?: string | null;
    companyType?: string | null;
    registrationStatus?: string | null;
  } | null;
  if (!body) return NextResponse.json({ error: "Ugyldige data." }, { status: 400 });

  const db = createServiceClient();
  if (body.action === "canonical") {
    const name = body.name?.trim().replace(/\s+/g, " ");
    if (!name || name.length > 200) return NextResponse.json({ error: "Angiv et gyldigt selskabsnavn." }, { status: 400 });
    const existing = (await readCompanies()).find(company => normalizeCompanyName(company.canonicalName) === normalizeCompanyName(name));
    if (existing) return NextResponse.json({ data: existing, existing: true });
    let { data, error } = await db
      .from("employers")
      .insert({ name, status: "active", is_verified: false })
      .select("id,name,is_verified")
      .single();
    if (error && (error.code === "42703" || /schema cache|column/i.test(error.message))) {
      const legacy = await db.from("employers").insert({ name }).select("id,name").single();
      data = legacy.data as typeof data;
      error = legacy.error;
    }
    if (error || !data) return NextResponse.json({ error: "Selskabet kunne ikke oprettes." }, { status: 409 });
    return NextResponse.json({ data: toOption(data as EmployerRow), existing: false }, { status: 201 });
  }

  if (body.action === "legal_entity") {
    if (!body.employerId) return NextResponse.json({ error: "Vælg et kanonisk selskab." }, { status: 400 });
    const legalName = body.legalName?.trim();
    if (!legalName || legalName.length > 250) return NextResponse.json({ error: "Angiv et gyldigt juridisk navn." }, { status: 400 });
    const registrationCountry = (body.registrationCountry ?? "DK").trim().toUpperCase();
    const registrationType = (body.registrationType ?? "CVR").trim().toUpperCase();
    const registration = validateRegistrationNumber(body.registrationNumber ?? "", registrationCountry, registrationType);
    if (!registration.valid) return NextResponse.json({ error: registration.error }, { status: 400 });
    if (registration.normalized) {
      const { data: duplicate } = await db
        .from("employer_legal_entities")
        .select("id,employer_id,legal_name")
        .eq("registration_country", registrationCountry)
        .eq("registration_type", registrationType)
        .eq("registration_number", registration.normalized)
        .maybeSingle();
      if (duplicate) {
        return NextResponse.json({
          error: duplicate.employer_id === body.employerId
            ? "Registreringsnummeret findes allerede på dette selskab."
            : "Registreringsnummeret tilhører allerede et andet kanonisk selskab.",
          duplicate,
        }, { status: 409 });
      }
    }
    const { count } = await db
      .from("employer_legal_entities")
      .select("id", { count: "exact", head: true })
      .eq("employer_id", body.employerId)
      .is("archived_at", null);
    const { data, error } = await db
      .from("employer_legal_entities")
      .insert({
        employer_id: body.employerId,
        legal_name: legalName,
        registration_country: registrationCountry,
        registration_type: registrationType,
        registration_number: registration.normalized,
        entity_kind: body.entityKind ?? "company",
        address: body.address?.trim() || null,
        contact_phone: body.contactPhone?.trim() || null,
        contact_email: body.contactEmail?.trim() || null,
        website: body.website?.trim() || null,
        industry_code: body.industryCode?.trim() || null,
        industry_description: body.industryDescription?.trim() || null,
        company_type: body.companyType?.trim() || null,
        registration_status: body.registrationStatus?.trim() || null,
        is_primary: (count ?? 0) === 0,
        created_by: auth.userId,
      })
      .select("id,legal_name,registration_country,registration_type,registration_number,entity_kind,is_primary,registration_status,address,contact_phone,contact_email,website,industry_code,industry_description,company_type")
      .single();
    if (error || !data) return NextResponse.json({ error: "Den juridiske enhed kunne ikke oprettes." }, { status: 409 });
    return NextResponse.json({ data }, { status: 201 });
  }

  return NextResponse.json({ error: "Ukendt handling." }, { status: 400 });
}
