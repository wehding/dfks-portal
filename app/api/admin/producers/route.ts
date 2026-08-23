import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi, requireStaffModuleApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveProducerStatus, type ProducerStatus } from "@/lib/admin-producers";
import { normalizeCompanyName, validateRegistrationNumber } from "@/lib/production-companies";
import { createListLoadTimer } from "@/lib/server/list-load-timing";

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
  const timer = createListLoadTimer("admin-producers");
  const auth = await requireStaffModuleApi("producers", "read");
  if (!auth.ok) return auth.response;
  timer.mark("access");
  const db = createServiceClient();
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("query") ?? "").trim().toLocaleLowerCase("da");
  const status = searchParams.get("status") as ProducerStatus | null;
  const associationGroup = searchParams.get("associationGroup");
  const producerType = searchParams.get("producerType");
  const rightsHolderId = searchParams.get("rightsHolderId");
  const sort = searchParams.get("sort") ?? "name";
  const direction = searchParams.get("direction") === "desc" ? -1 : 1;
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1") || 1);
  const requestedPageSize = Number.parseInt(searchParams.get("pageSize") ?? "20") || 20;
  const pageSize = [20, 50, 100].includes(requestedPageSize) ? requestedPageSize : 20;

  // The normal list uses a narrow, paginated database function. The legacy
  // payload remains temporarily available only while the editor is opened.
  if (searchParams.get("view") !== "editor-options") {
    const result = await db.rpc("list_admin_producer_summaries", {
      target_org_id: auth.orgId,
      search_text: query || null,
      status_filter: status && ["attention", "active", "inactive"].includes(status) ? status : null,
      association_filter: associationGroup && associationGroup !== "all" ? associationGroup : null,
      producer_type_filter: producerType && producerType !== "all" ? producerType : null,
      rights_holder_filter: rightsHolderId && UUID_PATTERN.test(rightsHolderId) ? rightsHolderId : null,
      sort_field: ["name", "parent", "status", "works", "contracts", "latest"].includes(sort) ? sort : "name",
      sort_direction: direction === -1 ? "desc" : "asc",
      page_number: page,
      page_size: pageSize,
    });
    if (result.error) {
      console.error("[admin-producers] summary list failed", result.error.code);
      return NextResponse.json({ error: "Producenter kunne ikke hentes" }, { status: 500 });
    }
    timer.mark("list");
    const payload = (result.data ?? {}) as { rows?: unknown[]; filteredCount?: number; totalCount?: number; page?: number; pageSize?: number };
    timer.finish({ route: "/api/admin/producers", rows: payload.rows?.length ?? 0 });
    return NextResponse.json({
      data: payload.rows ?? [],
      filteredCount: Number(payload.filteredCount ?? 0),
      totalCount: Number(payload.totalCount ?? 0),
      page: Number(payload.page ?? page),
      pageSize: Number(payload.pageSize ?? pageSize),
      canMerge: auth.role === "superadmin",
      canDelete: auth.role === "superadmin",
    }, { headers: { "cache-control": "no-store" } });
  }

  const [{ data: employers, error }, { data: contracts }, { data: legacyWorks }, { data: assignments }, { data: holders }, workOrgResult, contractRelationsResult, broadcasterResult, producerTypeResult] = await Promise.all([
    db.from("employers").select("id,name,parent_id,dfi_company_id,broadcaster_id,associeret,created_at,cvr,status,is_verified,employer_aliases(alias),employer_legal_entities(id,legal_name,registration_country,registration_type,registration_number,entity_kind,is_primary,registration_status,address,contact_phone,contact_email,website,industry_code,industry_description,company_type,archived_at),producer_type_relations:employer_producer_types(id,membership_type,source,source_name,source_url,source_metadata,is_active,verified_on,last_seen_at,producer_types(id,code,name,origin)),broadcasters(name,logo_path,content_type)").is("merged_into_id", null).is("archived_at", null),
    db.from("contracts").select("id,employer_id,status,created_at,rights_holder_id").eq("org_id", auth.orgId).not("employer_id", "is", null),
    db.from("works").select("id,employer_id,status,created_at").eq("org_id", auth.orgId).not("employer_id", "is", null),
    db.from("work_assignments").select("rights_holder_id,work_id,works(employer_id)").eq("org_id", auth.orgId),
    db.from("rettighedshavere").select("id,full_name,org_affiliations!inner(org_id)").eq("org_affiliations.org_id", auth.orgId).order("full_name"),
    db.from("work_organisations").select("work_id").eq("org_id", auth.orgId),
    db.from("contract_employers").select("contract_id,employer_id,contracts!inner(org_id)").eq("contracts.org_id", auth.orgId),
    db.from("broadcasters").select("id,name,logo_path,content_type").order("name"),
    db.from("organisation_producer_types").select("display_order,producer_types(id,code,name,origin)").eq("org_id", auth.orgId).order("display_order"),
  ]);
  let employerRows = employers ?? [];
  if (error) {
    if (error.code !== "42P01" && error.code !== "PGRST205" && !/schema cache|relationship|column/i.test(error.message)) {
      return NextResponse.json({ error: "Producenter kunne ikke hentes" }, { status: 500 });
    }
    const legacy = await db.from("employers").select("id,name,parent_id,dfi_company_id,associeret,created_at,cvr");
    if (legacy.error) return NextResponse.json({ error: "Producenter kunne ikke hentes" }, { status: 500 });
    employerRows = (legacy.data ?? []).map(row => ({ ...row, broadcaster_id: null, broadcasters: [], status: "active", is_verified: false, employer_aliases: [], employer_legal_entities: [], producer_type_relations: [] })) as unknown as typeof employerRows;
  }

  const relationWorkIds = (workOrgResult.data ?? []).map(row => row.work_id);
  const [{ data: sharedWorks }, workRelationsResult] = await Promise.all([
    relationWorkIds.length
      ? db.from("works").select("id,employer_id,status,created_at").in("id", relationWorkIds)
      : Promise.resolve({ data: [] as Array<{ id: string; employer_id: string | null; status: string; created_at: string }>, error: null }),
    relationWorkIds.length
      ? db.from("work_employers").select("work_id,employer_id").in("work_id", relationWorkIds)
      : Promise.resolve({ data: [] as Array<{ work_id: string; employer_id: string }>, error: null }),
  ]);
  const works = workOrgResult.error ? (legacyWorks ?? []) : (sharedWorks ?? []);

  const names = new Map(employerRows.map(employer => [employer.id, employer.name]));
  const contractMap = new Map<string, typeof contracts>();
  const workMap = new Map<string, typeof works>();
  const holderMap = new Map<string, Set<string>>();
  for (const contract of contracts ?? []) {
    if (!contract.employer_id) continue;
    contractMap.set(contract.employer_id, [...(contractMap.get(contract.employer_id) ?? []), contract]);
    if (contract.rights_holder_id) {
      const ids = holderMap.get(contract.employer_id) ?? new Set<string>(); ids.add(contract.rights_holder_id); holderMap.set(contract.employer_id, ids);
    }
  }
  if (!contractRelationsResult.error) {
    const contractsById = new Map((contracts ?? []).map(contract => [contract.id, contract]));
    for (const relation of contractRelationsResult.data ?? []) {
      const contract = contractsById.get(relation.contract_id);
      if (!contract || relation.employer_id === contract.employer_id) continue;
      contractMap.set(relation.employer_id, [...(contractMap.get(relation.employer_id) ?? []), contract]);
      if (contract.rights_holder_id) {
        const ids = holderMap.get(relation.employer_id) ?? new Set<string>(); ids.add(contract.rights_holder_id); holderMap.set(relation.employer_id, ids);
      }
    }
  }
  const worksById = new Map((works ?? []).map(work => [work.id, work]));
  const linkedWorkIds = new Set<string>();
  const employerIdsByWork = new Map<string, Set<string>>();
  if (!workRelationsResult.error) {
    for (const relation of workRelationsResult.data ?? []) {
      const work = worksById.get(relation.work_id);
      if (!work) continue;
      linkedWorkIds.add(work.id);
      const employerIds = employerIdsByWork.get(work.id) ?? new Set<string>(); employerIds.add(relation.employer_id); employerIdsByWork.set(work.id, employerIds);
      workMap.set(relation.employer_id, [...(workMap.get(relation.employer_id) ?? []), work]);
    }
  }
  for (const work of works ?? []) if (work.employer_id && !linkedWorkIds.has(work.id)) workMap.set(work.employer_id, [...(workMap.get(work.employer_id) ?? []), work]);
  for (const assignment of assignments ?? []) {
    const linkedWork = Array.isArray(assignment.works) ? assignment.works[0] : assignment.works;
    const employerIds = employerIdsByWork.get(assignment.work_id) ?? new Set(linkedWork?.employer_id ? [linkedWork.employer_id] : []);
    for (const employerId of employerIds) {
      if (!employerId || !assignment.rights_holder_id) continue;
      const ids = holderMap.get(employerId) ?? new Set<string>(); ids.add(assignment.rights_holder_id); holderMap.set(employerId, ids);
    }
  }

  let rows = employerRows.map(employer => {
    const employerContracts = contractMap.get(employer.id) ?? [];
    const employerWorks = workMap.get(employer.id) ?? [];
    const lastDates = [...employerContracts, ...employerWorks].map(row => row.created_at).filter(Boolean).sort().reverse();
    const producerStatus = resolveProducerStatus(employerContracts.map(row => row.status), employerWorks.length);
    return {
      ...employer,
      legal_entities: (employer.employer_legal_entities ?? []).filter(entity => !entity.archived_at),
      producer_types: (employer.producer_type_relations ?? []).filter(relation => relation.is_active).map(relation => {
        const producerType = Array.isArray(relation.producer_types) ? relation.producer_types[0] : relation.producer_types;
        return {
          relation_id: relation.id,
          id: producerType?.id,
          code: producerType?.code,
          name: producerType?.name,
          origin: producerType?.origin,
          source: relation.source,
          membership_type: relation.membership_type,
        };
      }).filter(type => type.id),
      association_memberships: (employer.producer_type_relations ?? []).filter(relation => relation.is_active && relation.source === "producentforeningen").map(relation => {
        const producerType = Array.isArray(relation.producer_types) ? relation.producer_types[0] : relation.producer_types;
        const metadata = (relation.source_metadata ?? {}) as Record<string, unknown>;
        return {
          id: relation.id,
          group_code: producerType?.code,
          group_label: producerType?.name,
          membership_type: relation.membership_type === "member" ? "ordinary" : relation.membership_type,
          source_name: relation.source_name,
          owner_ceo_text: typeof metadata.owner_ceo_text === "string" ? metadata.owner_ceo_text : null,
          website: typeof metadata.website === "string" ? metadata.website : null,
          address: typeof metadata.address === "string" ? metadata.address : null,
          postal_city: typeof metadata.postal_city === "string" ? metadata.postal_city : null,
          source_url: relation.source_url,
          is_active: relation.is_active,
          verified_on: relation.verified_on,
          last_seen_at: relation.last_seen_at,
        };
      }),
      aliases: (employer.employer_aliases ?? []).map(alias => alias.alias),
      parent_name: employer.parent_id ? names.get(employer.parent_id) ?? null : null,
      contract_count: employerContracts.length,
      work_count: employerWorks.length,
      status: producerStatus,
      latest_activity: lastDates[0] ?? null,
      rights_holder_ids: [...(holderMap.get(employer.id) ?? [])],
    };
  });
  const totalCount = rows.length;
  if (query) rows = rows.filter(row => [
    row.name,
    row.parent_name ?? "",
    row.cvr ?? "",
    ...row.aliases,
    ...row.legal_entities.flatMap(entity => [entity.legal_name, entity.registration_number ?? ""]),
  ].join(" ").toLocaleLowerCase("da").includes(query));
  if (status && ["attention", "active", "inactive"].includes(status)) rows = rows.filter(row => row.status === status);
  if (associationGroup === "ordinary" || associationGroup === "member") rows = rows.filter(row => row.association_memberships.some(membership => membership.membership_type === "ordinary"));
  else if (associationGroup === "associate") rows = rows.filter(row => !row.association_memberships.some(membership => membership.membership_type === "ordinary") && row.association_memberships.some(membership => membership.membership_type === "associate"));
  else if (associationGroup === "none") rows = rows.filter(row => row.association_memberships.length === 0);
  else if (associationGroup === "unknown") rows = rows.filter(row => !row.association_memberships.some(membership => ["ordinary", "associate"].includes(membership.membership_type)) && row.association_memberships.length > 0);
  else if (associationGroup && ["documentary", "feature_fiction", "tv", "advertising", "dubbing", "animation", "streamer", "broadcaster"].includes(associationGroup)) {
    rows = rows.filter(row => row.producer_types.some(type => type.code === associationGroup));
  }
  if (rightsHolderId) rows = rows.filter(row => row.rights_holder_ids.includes(rightsHolderId));
  rows.sort((a, b) => {
    const values: Record<string, [string | number, string | number]> = {
      name: [a.name, b.name], parent: [a.parent_name ?? "", b.parent_name ?? ""], status: [a.status, b.status],
      works: [a.work_count, b.work_count], contracts: [a.contract_count, b.contract_count], latest: [a.latest_activity ?? "", b.latest_activity ?? ""],
    };
    const [left, right] = values[sort] ?? values.name;
    return (typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "da", { numeric: true })) * direction;
  });
  const producerTypes = (producerTypeResult.data ?? []).map(row =>
    Array.isArray(row.producer_types) ? row.producer_types[0] : row.producer_types
  ).filter(Boolean);
  return NextResponse.json({ data: rows, filteredCount: rows.length, totalCount, rightsHolders: holders ?? [], broadcasters: broadcasterResult.data ?? [], producerTypes, canMerge: auth.role === "superadmin", canDelete: auth.role === "superadmin" });
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
  return NextResponse.json({ deletedCount: Number((data as { deleted_count?: number } | null)?.deleted_count ?? 0) });
}
