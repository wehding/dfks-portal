import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  companyMatchScore,
  normalizeCompanyName,
  type ProductionCompanyOption,
  type ProductionCompanySelection,
} from "@/lib/production-companies";

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
    const { data: employers, error } = await db.from("employers")
      .select("id,name,is_verified,employer_aliases(alias),employer_legal_entities(id,legal_name,registration_country,registration_type,registration_number,entity_kind,is_primary,registration_status,archived_at)")
      .is("merged_into_id", null)
      .is("archived_at", null);
    if (error) throw new Error(error.message);
    for (const name of unresolvedNames) {
      const scored = (employers ?? []).map(row => {
        const option: ProductionCompanyOption = {
          employerId: row.id,
          canonicalName: row.name,
          aliases: (row.employer_aliases ?? []).map(item => item.alias),
          legalEntities: (row.employer_legal_entities ?? []).filter(item => !item.archived_at).map(item => ({
            id: item.id,
            legalName: item.legal_name,
            registrationCountry: item.registration_country,
            registrationType: item.registration_type,
            registrationNumber: item.registration_number,
            entityKind: item.entity_kind,
            isPrimary: item.is_primary,
            registrationStatus: item.registration_status,
          })),
          isVerified: Boolean(row.is_verified),
        };
        return { row, score: companyMatchScore(option, name) };
      }).sort((left, right) => right.score - left.score);
      let employer: { id: string; name: string } | null = scored[0]?.score >= 90
        ? { id: scored[0].row.id, name: scored[0].row.name }
        : null;
      if (!employer) {
        const created = await db.from("employers").insert({ name, status: "active", is_verified: false }).select("id,name").single();
        if (created.error || !created.data) throw new Error(created.error?.message ?? "Produktionsselskabet kunne ikke oprettes.");
        employer = { id: created.data.id, name: created.data.name };
      } else if (normalizeCompanyName(employer.name) !== normalizeCompanyName(name)) {
        const aliasResult = await db.from("employer_aliases").insert({
          employer_id: employer.id,
          alias: name,
          alias_type: "imported",
          source: "external_work_match",
        });
        if (aliasResult.error && aliasResult.error.code !== "23505" && !/schema cache/i.test(aliasResult.error.message)) throw new Error(aliasResult.error.message);
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
      employer_id: selections[0]?.employerId ?? null,
      production_companies: selections.map(selection => selection.canonicalName),
    }).eq("id", input.workId);
    if (mirror.error) throw new Error(mirror.error.message);
    return;
  }
  const desiredKeys = new Set(rows.map(row => `${row.employer_id}:${row.legal_entity_id ?? ""}:${row.relation_role}`));
  const obsoleteRows = (existingRows ?? []).filter(row => !desiredKeys.has(`${row.employer_id}:${row.legal_entity_id ?? ""}:${row.relation_role}`));
  for (const obsolete of obsoleteRows) {
    let query = db.from("work_employers").delete()
      .eq("work_id", input.workId)
      .eq("employer_id", obsolete.employer_id)
      .eq("relation_role", obsolete.relation_role);
    query = obsolete.legal_entity_id ? query.eq("legal_entity_id", obsolete.legal_entity_id) : query.is("legal_entity_id", null);
    const { error } = await query;
    if (error) throw new Error(error.message);
  }
  const existingKeys = new Set((existingRows ?? []).map(row => `${row.employer_id}:${row.legal_entity_id ?? ""}:${row.relation_role}`));
  const missingRows = rows.filter(row => !existingKeys.has(`${row.employer_id}:${row.legal_entity_id ?? ""}:${row.relation_role}`));
  if (missingRows.length) {
    const { error } = await db.from("work_employers").insert(missingRows);
    if (error) throw new Error(error.message);
  }

  for (const selection of selections) {
    if (!selection.externalSource || !selection.externalId) continue;
    const approved = selection.matchMethod === "external_id"
      || selection.matchMethod === "exact_name"
      || selection.matchMethod === "admin"
      || (selection.matchMethod === "fuzzy_name" && (selection.matchScore ?? 0) >= 90);
    const identityResult = await db.from("employer_external_ids").upsert({
      employer_id: selection.employerId,
      source: selection.externalSource,
      external_id: selection.externalId,
      external_name: selection.externalName ?? selection.canonicalName,
      match_method: selection.matchMethod ?? "admin",
      match_score: selection.matchScore ?? null,
      approved,
      approved_at: approved ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "source,external_id" });
    if (identityResult.error && !isMissingProducerSchema(identityResult.error)) throw new Error(identityResult.error.message);
  }

  const names = selections.map(selection => selection.canonicalName);
  const { error: mirrorError } = await db.from("works").update({
    employer_id: selections[0]?.employerId ?? null,
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
