import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCompanyName, type ProductionCompanySelection } from "@/lib/production-companies";

type SyncWorkProducerInput = {
  workId: string;
  orgId: string;
  selections?: ProductionCompanySelection[] | null;
  names?: string[] | null;
  source?: string;
};

function isMissingProducerSchema(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "42P01" || error?.code === "PGRST205" || /schema cache|could not find.*table/i.test(error?.message ?? "");
}

async function resolveCompanies(
  db: SupabaseClient,
  selections: ProductionCompanySelection[],
  names: string[],
) {
  const byEmployer = new Map<string, ProductionCompanySelection>();
  for (const selection of selections) byEmployer.set(`${selection.employerId}:${selection.legalEntityId ?? ""}`, selection);

  const unresolvedNames = names
    .map(name => name.trim())
    .filter(Boolean)
    .filter(name => !selections.some(selection => normalizeCompanyName(selection.canonicalName) === normalizeCompanyName(name)));
  if (unresolvedNames.length) {
    const { data: employers, error } = await db.from("employers").select("id,name").is("merged_into_id", null);
    if (error) throw new Error(error.message);
    for (const name of unresolvedNames) {
      let employer = (employers ?? []).find(row => normalizeCompanyName(row.name) === normalizeCompanyName(name));
      if (!employer) {
        const created = await db.from("employers").insert({ name, status: "active", is_verified: false }).select("id,name").single();
        if (created.error || !created.data) throw new Error(created.error?.message ?? "Produktionsselskabet kunne ikke oprettes.");
        employer = created.data;
      }
      byEmployer.set(`${employer.id}:`, { employerId: employer.id, canonicalName: employer.name });
    }
  }
  return [...byEmployer.values()];
}

export async function syncWorkProducerRelations(db: SupabaseClient, input: SyncWorkProducerInput) {
  const selections = await resolveCompanies(db, input.selections ?? [], input.names ?? []);
  const { error: orgError } = await db.from("work_organisations").upsert(
    { work_id: input.workId, org_id: input.orgId, relation_role: "catalogue" },
    { onConflict: "work_id,org_id" },
  );
  if (orgError && !isMissingProducerSchema(orgError)) throw new Error(orgError.message);

  if (!selections.length) return;
  const rows = selections.map((selection, index) => ({
    work_id: input.workId,
    employer_id: selection.employerId,
    legal_entity_id: selection.legalEntityId ?? null,
    relation_role: "producer",
    sort_order: index,
    source: input.source ?? "manual",
  }));
  const { data: existingRows, error: existingError } = await db
    .from("work_employers")
    .select("employer_id,legal_entity_id,relation_role")
    .eq("work_id", input.workId);
  if (existingError && !isMissingProducerSchema(existingError)) throw new Error(existingError.message);
  if (isMissingProducerSchema(existingError)) {
    const mirror = await db.from("works").update({
      employer_id: selections[0].employerId,
      production_companies: selections.map(selection => selection.canonicalName),
    }).eq("id", input.workId);
    if (mirror.error) throw new Error(mirror.error.message);
    return;
  }
  const existingKeys = new Set((existingRows ?? []).map(row => `${row.employer_id}:${row.legal_entity_id ?? ""}:${row.relation_role}`));
  const missingRows = rows.filter(row => !existingKeys.has(`${row.employer_id}:${row.legal_entity_id ?? ""}:${row.relation_role}`));
  if (missingRows.length) {
    const { error } = await db.from("work_employers").insert(missingRows);
    if (error) throw new Error(error.message);
  }

  const names = selections.map(selection => selection.canonicalName);
  const { error: mirrorError } = await db.from("works").update({
    employer_id: selections[0].employerId,
    production_companies: names,
  }).eq("id", input.workId);
  if (mirrorError) throw new Error(mirrorError.message);
}

export async function syncContractProducerRelations(
  db: SupabaseClient,
  contractId: string,
  selections: ProductionCompanySelection[],
  source = "manual",
) {
  const resolved = await resolveCompanies(db, selections, selections.map(selection => selection.canonicalName));
  const { error: deleteError } = await db.from("contract_employers").delete().eq("contract_id", contractId);
  if (deleteError && !isMissingProducerSchema(deleteError)) throw new Error(deleteError.message);
  if (isMissingProducerSchema(deleteError)) {
    const fallback = await db.from("contracts").update({ employer_id: resolved[0]?.employerId ?? null }).eq("id", contractId);
    if (fallback.error) throw new Error(fallback.error.message);
    return;
  }
  if (!resolved.length) {
    const { error } = await db.from("contracts").update({ employer_id: null }).eq("id", contractId);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await db.from("contract_employers").insert(resolved.map((selection, index) => ({
    contract_id: contractId,
    employer_id: selection.employerId,
    legal_entity_id: selection.legalEntityId ?? null,
    relation_role: "counterparty",
    sort_order: index,
    source,
  })));
  if (error) throw new Error(error.message);
  const mirror = await db.from("contracts").update({ employer_id: resolved[0].employerId }).eq("id", contractId);
  if (mirror.error) throw new Error(mirror.error.message);
}
