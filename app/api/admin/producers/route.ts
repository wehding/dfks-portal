import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveProducerStatus, type ProducerStatus } from "@/lib/admin-producers";
import { normalizeCompanyName, validateRegistrationNumber } from "@/lib/production-companies";


export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const db = createServiceClient();
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("query") ?? "").trim().toLocaleLowerCase("da");
  const status = searchParams.get("status") as ProducerStatus | null;
  const rightsHolderId = searchParams.get("rightsHolderId");
  const sort = searchParams.get("sort") ?? "name";
  const direction = searchParams.get("direction") === "desc" ? -1 : 1;

  const [{ data: employers, error }, { data: contracts }, { data: legacyWorks }, { data: assignments }, { data: holders }, workOrgResult, contractRelationsResult] = await Promise.all([
    db.from("employers").select("id,name,parent_id,dfi_company_id,associeret,created_at,cvr,status,is_verified,employer_aliases(alias),employer_legal_entities(id,legal_name,registration_country,registration_type,registration_number,entity_kind,is_primary,registration_status,address,contact_phone,archived_at)").is("merged_into_id", null).is("archived_at", null),
    db.from("contracts").select("id,employer_id,status,created_at,rights_holder_id").eq("org_id", auth.orgId).not("employer_id", "is", null),
    db.from("works").select("id,employer_id,status,created_at").eq("org_id", auth.orgId).not("employer_id", "is", null),
    db.from("work_assignments").select("rights_holder_id,work_id,works(employer_id)").eq("org_id", auth.orgId),
    db.from("rettighedshavere").select("id,full_name,org_affiliations!inner(org_id)").eq("org_affiliations.org_id", auth.orgId).order("full_name"),
    db.from("work_organisations").select("work_id").eq("org_id", auth.orgId),
    db.from("contract_employers").select("contract_id,employer_id,contracts!inner(org_id)").eq("contracts.org_id", auth.orgId),
  ]);
  let employerRows = employers ?? [];
  if (error) {
    if (error.code !== "42P01" && error.code !== "PGRST205" && !/schema cache|relationship|column/i.test(error.message)) {
      return NextResponse.json({ error: "Producenter kunne ikke hentes" }, { status: 500 });
    }
    const legacy = await db.from("employers").select("id,name,parent_id,dfi_company_id,associeret,created_at,cvr");
    if (legacy.error) return NextResponse.json({ error: "Producenter kunne ikke hentes" }, { status: 500 });
    employerRows = (legacy.data ?? []).map(row => ({ ...row, status: "active", is_verified: false, employer_aliases: [], employer_legal_entities: [] })) as typeof employerRows;
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
      aliases: (employer.employer_aliases ?? []).map(alias => alias.alias),
      parent_name: employer.parent_id ? names.get(employer.parent_id) ?? null : null,
      contract_count: employerContracts.length,
      work_count: employerWorks.length,
      status: producerStatus,
      latest_activity: lastDates[0] ?? null,
      rights_holder_ids: [...(holderMap.get(employer.id) ?? [])],
    };
  });
  if (query) rows = rows.filter(row => [
    row.name,
    row.parent_name ?? "",
    row.cvr ?? "",
    ...row.aliases,
    ...row.legal_entities.flatMap(entity => [entity.legal_name, entity.registration_number ?? ""]),
  ].join(" ").toLocaleLowerCase("da").includes(query));
  if (status && ["attention", "active", "inactive"].includes(status)) rows = rows.filter(row => row.status === status);
  if (rightsHolderId) rows = rows.filter(row => row.rights_holder_ids.includes(rightsHolderId));
  rows.sort((a, b) => {
    const values: Record<string, [string | number, string | number]> = {
      name: [a.name, b.name], parent: [a.parent_name ?? "", b.parent_name ?? ""], status: [a.status, b.status],
      works: [a.work_count, b.work_count], contracts: [a.contract_count, b.contract_count], latest: [a.latest_activity ?? "", b.latest_activity ?? ""],
    };
    const [left, right] = values[sort] ?? values.name;
    return (typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "da", { numeric: true })) * direction;
  });
  return NextResponse.json({ data: rows, rightsHolders: holders ?? [], canMerge: auth.role === "superadmin" });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi(["superadmin", "admin", "org-admin"]);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null) as {
    name?: string;
    dfiCompanyId?: string | number | null;
    legalEntities?: Array<{ legalName?: string; registrationNumber?: string; address?: string; contactPhone?: string; isPrimary?: boolean }>;
  } | null;
  const name = body?.name?.trim().replace(/\s+/g, " ");
  if (!name) return NextResponse.json({ error: "Producentnavn er påkrævet" }, { status: 400 });
  const db = createServiceClient();
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
  }).select("id").single();
  if (error || !employer) return NextResponse.json({ error: error?.message ?? "Producenten kunne ikke oprettes" }, { status: 409 });

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
      created_by: auth.userId,
    })));
    if (entityResult.error) {
      await db.from("employers").delete().eq("id", employer.id);
      return NextResponse.json({ error: entityResult.error.message }, { status: 409 });
    }
  }
  return NextResponse.json({ id: employer.id }, { status: 201 });
}
