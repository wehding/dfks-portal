import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveProducerStatus, type ProducerStatus } from "@/lib/admin-producers";


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

  const [{ data: employers, error }, { data: contracts }, { data: works }, { data: assignments }, { data: holders }] = await Promise.all([
    db.from("employers").select("id,name,parent_id,dfi_company_id,associeret,created_at"),
    db.from("contracts").select("id,employer_id,status,created_at,rights_holder_id").eq("org_id", auth.orgId).not("employer_id", "is", null),
    db.from("works").select("id,employer_id,status,created_at").eq("org_id", auth.orgId).not("employer_id", "is", null),
    db.from("work_assignments").select("rights_holder_id,works!inner(employer_id,org_id)").eq("works.org_id", auth.orgId).not("works.employer_id", "is", null),
    db.from("rettighedshavere").select("id,full_name,org_affiliations!inner(org_id)").eq("org_affiliations.org_id", auth.orgId).order("full_name"),
  ]);
  if (error) return NextResponse.json({ error: "Producenter kunne ikke hentes" }, { status: 500 });

  const names = new Map((employers ?? []).map(employer => [employer.id, employer.name]));
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
  for (const work of works ?? []) if (work.employer_id) workMap.set(work.employer_id, [...(workMap.get(work.employer_id) ?? []), work]);
  for (const assignment of assignments ?? []) {
    const linkedWorks = Array.isArray(assignment.works) ? assignment.works : [assignment.works];
    for (const work of linkedWorks) {
      const employerId = work?.employer_id;
      if (!employerId || !assignment.rights_holder_id) continue;
      const ids = holderMap.get(employerId) ?? new Set<string>(); ids.add(assignment.rights_holder_id); holderMap.set(employerId, ids);
    }
  }

  let rows = (employers ?? []).map(employer => {
    const employerContracts = contractMap.get(employer.id) ?? [];
    const employerWorks = workMap.get(employer.id) ?? [];
    const lastDates = [...employerContracts, ...employerWorks].map(row => row.created_at).filter(Boolean).sort().reverse();
    const producerStatus = resolveProducerStatus(employerContracts.map(row => row.status), employerWorks.length);
    return {
      ...employer,
      parent_name: employer.parent_id ? names.get(employer.parent_id) ?? null : null,
      contract_count: employerContracts.length,
      work_count: employerWorks.length,
      status: producerStatus,
      latest_activity: lastDates[0] ?? null,
      rights_holder_ids: [...(holderMap.get(employer.id) ?? [])],
    };
  });
  if (query) rows = rows.filter(row => `${row.name} ${row.parent_name ?? ""}`.toLocaleLowerCase("da").includes(query));
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
  return NextResponse.json({ data: rows, rightsHolders: holders ?? [] });
}
