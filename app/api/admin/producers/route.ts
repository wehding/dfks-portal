import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi, requireStaffModuleApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeCompanyName, validateRegistrationNumber } from "@/lib/production-companies";
import { loadAdminProducerList } from "@/lib/server/admin-producer-list";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getDeletionPreview(db: ReturnType<typeof createServiceClient>, ids: string[]) {
  const [employersResult, workRelationsResult, contractRelationsResult, legacyWorksResult, legacyContractsResult, mergeSourcesResult, mergeAuditResult] = await Promise.all([
    db.from("employers").select("id,name").in("id", ids).is("merged_into_id", null),
    db.from("work_employers").select("employer_id,work_id,works(org_id,work_organisations(org_id))").in("employer_id", ids),
    db.from("contract_employers").select("employer_id,contract_id,contracts(org_id)").in("employer_id", ids),
    db.from("works").select("id,employer_id,org_id,work_organisations(org_id)").in("employer_id", ids),
    db.from("contracts").select("id,employer_id,org_id").in("employer_id", ids),
    db.from("employers").select("id,merged_into_id").in("merged_into_id", ids),
    db.from("employer_merge_audit").select("source_employer_id,target_employer_id").or(`source_employer_id.in.(${ids.join(",")}),target_employer_id.in.(${ids.join(",")})`),
  ]);
  const firstError = employersResult.error ?? workRelationsResult.error ?? contractRelationsResult.error ?? legacyWorksResult.error ?? legacyContractsResult.error ?? mergeSourcesResult.error ?? mergeAuditResult.error;
  if (firstError) throw new Error("Producenternes tilknytninger kunne ikke kontrolleres.");

  return (employersResult.data ?? []).map(employer => {
    const workIds = new Set<string>();
    const contractIds = new Set<string>();
    const organisationIds = new Set<string>();
    for (const relation of workRelationsResult.data ?? []) {
      if (relation.employer_id !== employer.id) continue;
      workIds.add(relation.work_id);
      const work = Array.isArray(relation.works) ? relation.works[0] : relation.works;
      if (work?.org_id) organisationIds.add(work.org_id);
      for (const org of work?.work_organisations ?? []) if (org.org_id) organisationIds.add(org.org_id);
    }
    for (const work of legacyWorksResult.data ?? []) {
      if (work.employer_id !== employer.id) continue;
      workIds.add(work.id);
      if (work.org_id) organisationIds.add(work.org_id);
      for (const org of work.work_organisations ?? []) if (org.org_id) organisationIds.add(org.org_id);
    }
    for (const relation of contractRelationsResult.data ?? []) {
      if (relation.employer_id !== employer.id) continue;
      contractIds.add(relation.contract_id);
      const contract = Array.isArray(relation.contracts) ? relation.contracts[0] : relation.contracts;
      if (contract?.org_id) organisationIds.add(contract.org_id);
    }
    for (const contract of legacyContractsResult.data ?? []) {
      if (contract.employer_id !== employer.id) continue;
      contractIds.add(contract.id);
      if (contract.org_id) organisationIds.add(contract.org_id);
    }
    const mergeReferences = (mergeSourcesResult.data ?? []).filter(row => row.merged_into_id === employer.id).length
      + (mergeAuditResult.data ?? []).filter(row => row.source_employer_id === employer.id || row.target_employer_id === employer.id).length;
    return {
      id: employer.id,
      name: employer.name,
      workCount: workIds.size,
      contractCount: contractIds.size,
      organisationCount: organisationIds.size,
      mergeReferences,
      canDelete: workIds.size === 0 && contractIds.size === 0 && mergeReferences === 0,
    };
  });
}

export async function GET(req: NextRequest) {
  const auth = await requireStaffModuleApi("producers", "read");
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);
  if (searchParams.get("view") === "editor-options") {
    return NextResponse.json({ error: "Brug de afgrænsede producent-endpoints" }, { status: 410 });
  }
  try {
    const payload = await loadAdminProducerList(auth, searchParams);
    await recordSensitiveFlow({ actor: { userId: auth.userId, orgId: auth.orgId, role: auth.role, source: "admin" }, action: "search", component: "admin.producers.list", entityType: "employers", orgIds: [auth.orgId], purposeCode: "producer_administration", legalBasis: "GDPR Art. 6(1)(c)/(f) og 9(2)(d)", dataCategories: ["company_data", "contact_data", "contract_data"] });
    return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Producenter kunne ikke hentes" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireStaffModuleApi("producers", "write");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null) as {
    name?: string;
    dfiCompanyId?: string | number | null;
    broadcasterId?: string | null;
    producerTypeIds?: string[];
    legalEntities?: Array<{ legalName?: string; registrationNumber?: string; address?: string; contactPhone?: string; contactEmail?: string; website?: string; registrationStatus?: string; industryCode?: string; industryDescription?: string; companyType?: string; isPrimary?: boolean }>;
  } | null;
  const name = body?.name?.trim().replace(/\s+/g, " ");
  if (!name) return NextResponse.json({ error: "Producentnavn er påkrævet" }, { status: 400 });
  const db = createServiceClient({ audit: {
    actorUserId: auth.userId,
    actorOrgId: auth.orgId,
    actorRole: auth.role,
    source: "admin",
    correlationId: crypto.randomUUID(),
  } });
  const { data: existing } = await db.from("employers").select("id,name").ilike("name", name).is("merged_into_id", null).limit(20);
  if ((existing ?? []).some(row => normalizeCompanyName(row.name) === normalizeCompanyName(name))) {
    return NextResponse.json({ error: "Producenten findes allerede" }, { status: 409 });
  }
  const preparedEntities = [];
  for (const entity of body?.legalEntities ?? []) {
    if (!entity.legalName?.trim()) continue;
    const registration = validateRegistrationNumber(entity.registrationNumber ?? "");
    if (!registration.valid) return NextResponse.json({ error: registration.error }, { status: 400 });
    preparedEntities.push({ entity, legalName: entity.legalName.trim(), registrationNumber: registration.normalized });
  }
  const parsedDfiId = body?.dfiCompanyId ? Number(body.dfiCompanyId) : null;
  const { data: employer, error } = await db.from("employers").insert({
    name,
    dfi_company_id: Number.isFinite(parsedDfiId) ? parsedDfiId : null,
    status: "active",
    is_verified: Boolean(parsedDfiId),
    broadcaster_id: body?.broadcasterId || null,
  }).select("id").single();
  if (error || !employer) return NextResponse.json({ error: error?.code === "23505" ? "Producenten findes allerede." : "Producenten kunne ikke oprettes" }, { status: error?.code === "23505" ? 409 : 500 });

  if (preparedEntities.length) {
    const selectedPrimary = Math.max(0, preparedEntities.findIndex(item => item.entity.isPrimary));
    const entityResult = await db.from("employer_legal_entities").insert(preparedEntities.map((prepared, index) => ({
      employer_id: employer.id,
      legal_name: prepared.legalName,
      registration_country: "DK",
      registration_type: "CVR",
      registration_number: prepared.registrationNumber,
      entity_kind: "company",
      is_primary: index === selectedPrimary,
      address: prepared.entity.address?.trim() || null,
      contact_phone: prepared.entity.contactPhone?.trim() || null,
      contact_email: prepared.entity.contactEmail?.trim() || null,
      website: prepared.entity.website?.trim() || null,
      registration_status: prepared.entity.registrationStatus?.trim() || null,
      industry_code: prepared.entity.industryCode?.trim() || null,
      industry_description: prepared.entity.industryDescription?.trim() || null,
      company_type: prepared.entity.companyType?.trim() || null,
      created_by: auth.userId,
    })));
    if (entityResult.error) {
      await db.from("employers").delete().eq("id", employer.id);
      return NextResponse.json({ error: "Den juridiske enhed kunne ikke oprettes." }, { status: 409 });
    }
  }
  const producerTypeIds = [...new Set((body?.producerTypeIds ?? []).filter(value => /^[0-9a-f-]{36}$/i.test(value)))];
  const relations = await db.rpc("replace_employer_manual_producer_types", {
    target_org_id: auth.orgId,
    target_employer_id: employer.id,
    target_type_ids: producerTypeIds,
    actor_id: auth.userId,
  });
  if (relations.error) {
    await db.from("employers").delete().eq("id", employer.id);
    return NextResponse.json({ error: "Producenttyperne kunne ikke gemmes." }, { status: 409 });
  }
  await recordSensitiveFlow({ actor: { userId: auth.userId, orgId: auth.orgId, role: auth.role, source: "admin" }, action: "create", component: "admin.producers.create", entityType: "employers", entityId: employer.id, orgIds: [auth.orgId], purposeCode: "producer_administration", legalBasis: "GDPR Art. 6(1)(c)/(f) og 9(2)(d)", dataCategories: ["company_data", "contact_data", "contract_data"] });
  return NextResponse.json({ id: employer.id }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdminApi(["superadmin"]);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null) as { ids?: unknown; confirmation?: unknown; preview?: unknown } | null;
  const ids = [...new Set(Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === "string" && UUID_PATTERN.test(id)) : [])].slice(0, 25);
  if (!ids.length) return NextResponse.json({ error: "Vælg mindst én producent." }, { status: 400 });

  const db = createServiceClient();
  let preview;
  try { preview = await getDeletionPreview(db, ids); }
  catch (error) {
    console.error("[admin-producers] relation check failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Tilknytningerne kunne ikke kontrolleres." }, { status: 500 });
  }
  if (preview.length !== ids.length) return NextResponse.json({ error: "En eller flere producenter blev ikke fundet.", preview }, { status: 404 });
  if (body?.preview === true) return NextResponse.json({ preview });
  if (body?.confirmation !== "SLET") return NextResponse.json({ error: "Skriv SLET for at bekræfte permanent sletning.", preview }, { status: 400 });
  if (preview.some(item => !item.canDelete)) {
    return NextResponse.json({ error: "Producenter med tilknyttede værker, kontrakter eller sammenlægninger kan ikke slettes permanent.", preview }, { status: 409 });
  }

  const auditedDb = createServiceClient({ audit: {
    actorUserId: auth.userId,
    actorOrgId: auth.orgId,
    actorRole: auth.role,
    source: "admin",
    correlationId: crypto.randomUUID(),
  } });
  const { data, error } = await auditedDb.rpc("delete_unlinked_employers_permanently", { target_ids: ids, actor_id: auth.userId });
  if (error) {
    console.error("[producers] permanent delete failed", error.message);
    return NextResponse.json({ error: /linked records/i.test(error.message) ? "Tilknytningerne er ændret. Producenterne blev ikke slettet." : "Producenterne kunne ikke slettes permanent." }, { status: 409 });
  }
  const deletedCount = Number((data as { deleted_count?: number } | null)?.deleted_count ?? 0);
  await recordSensitiveFlow({ actor: { userId: auth.userId, orgId: auth.orgId, role: auth.role, source: "admin" }, action: "delete", component: "admin.producers.delete", entityType: "employers", orgIds: [auth.orgId], purposeCode: "producer_administration", legalBasis: "GDPR Art. 6(1)(c)/(f) og 9(2)(d)", dataCategories: ["company_data", "contact_data", "contract_data"], counts: { deleted: deletedCount } });
  return NextResponse.json({ deletedCount });
}
