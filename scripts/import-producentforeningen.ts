import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { buildAssociationPreview, normalizeMembershipType, normalizeSourceWebsite } from "../lib/producer-association";
import { normalizeCompanyBaseName } from "../lib/production-companies";
import { fetchProducentforeningenMemberships } from "../lib/server/producer-association-source";

config({ path: ".env.local" });
const apply = process.argv.includes("--apply");
const createReview = process.argv.includes("--create-review");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function existingProducerOptions() {
  const { data, error } = await db.from("employers")
    .select("id,name,is_verified,employer_aliases(alias),employer_legal_entities(id,legal_name,registration_number,website,archived_at)")
    .is("merged_into_id", null)
    .is("archived_at", null);
  if (error) throw error;
  return (data ?? []).map((employer: any) => ({
    employerId: employer.id,
    canonicalName: employer.name,
    aliases: (employer.employer_aliases ?? []).map((item: any) => item.alias),
    legalEntities: (employer.employer_legal_entities ?? []).filter((item: any) => !item.archived_at).map((entity: any) => ({ id: entity.id, legalName: entity.legal_name, registrationCountry: "DK", registrationType: "CVR", registrationNumber: entity.registration_number, entityKind: "company", isPrimary: false, registrationStatus: null, website: entity.website })),
    websites: (employer.employer_legal_entities ?? []).map((entity: any) => entity.website ?? "").filter(Boolean),
    isVerified: Boolean(employer.is_verified),
  }));
}

async function main() {
  const [{ rows, verifiedOn }, employers] = await Promise.all([fetchProducentforeningenMemberships(), existingProducerOptions()]);
  const preview = buildAssociationPreview(rows, employers);
  const summary = {
    verifiedOn,
    sourceRows: rows.length,
    uniqueProducers: preview.length,
    matches: preview.filter(item => item.recommendation === "match").length,
    creates: preview.filter(item => item.recommendation === "create").length,
    reviews: preview.filter(item => item.recommendation === "review").map(item => item.sourceName),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) return;

  const { data: actor } = await db.from("user_org_roles").select("user_id").eq("role", "superadmin").limit(1).maybeSingle();
  const { data: run, error: runError } = await db.from("producer_association_sync_runs").insert({
    status: "preview",
    verified_on: verifiedOn,
    source_rows: rows.length,
    unique_producers: preview.length,
    matched_count: summary.matches,
    review_count: summary.reviews.length,
    snapshot: preview,
    summary,
    created_by: actor?.user_id ?? null,
  }).select("id").single();
  if (runError || !run) throw runError ?? new Error("Synkroniseringskørslen kunne ikke oprettes");

  let matchedCount = 0;
  let createdCount = 0;
  let changedCount = 0;
  let skippedCount = 0;
  try {
    for (const item of preview) {
      const shouldCreate = item.recommendation === "create" || (item.recommendation === "review" && createReview);
      let employerId = item.recommendation === "match" ? item.suggestedEmployerId : null;
      if (!employerId && shouldCreate) {
        const { data: created, error } = await db.from("employers").insert({ name: item.sourceName, status: "active", is_verified: false, associeret: item.groups.some(group => group.membershipType === "associate") }).select("id").single();
        if (error || !created) throw error ?? new Error(`Kunne ikke oprette ${item.sourceName}`);
        employerId = created.id;
        createdCount += 1;
      } else if (employerId) matchedCount += 1;
      if (!employerId) { skippedCount += 1; continue; }

      const { data: employer } = await db.from("employers").select("name,employer_aliases(alias)").eq("id", employerId).single();
      if (employer && normalizeCompanyBaseName(employer.name) !== normalizeCompanyBaseName(item.sourceName)
        && !(employer.employer_aliases ?? []).some((alias: any) => normalizeCompanyBaseName(alias.alias) === normalizeCompanyBaseName(item.sourceName))) {
        const aliasResult = await db.from("employer_aliases").insert({ employer_id: employerId, alias: item.sourceName, alias_type: "imported", source: "producentforeningen", created_by: actor?.user_id ?? null });
        if (aliasResult.error && aliasResult.error.code !== "23505") throw aliasResult.error;
      }

      for (const group of item.groups) {
        const result = await db.from("producer_association_memberships").upsert({
          employer_id: employerId,
          association_code: "producentforeningen",
          group_code: group.groupCode,
          group_label: group.groupLabel,
          membership_type: normalizeMembershipType(group.membershipType),
          source_name: group.sourceName,
          owner_ceo_text: group.ownerCeoText,
          website: normalizeSourceWebsite(group.website),
          address: group.address,
          postal_city: group.postalCity,
          source_url: group.sourceUrl,
          source_hash: group.sourceHash ?? null,
          is_active: true,
          verified_on: verifiedOn,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: actor?.user_id ?? null,
        }, { onConflict: "employer_id,association_code,group_code" });
        if (result.error) throw result.error;
        changedCount += 1;
      }
      const knownTypes = item.groups.map(group => group.membershipType).filter(type => type !== "unknown");
      if (knownTypes.length) {
        const update = await db.from("employers").update({ associeret: knownTypes.includes("associate"), updated_at: new Date().toISOString() }).eq("id", employerId);
        if (update.error) throw update.error;
      }
    }
    const complete = await db.from("producer_association_sync_runs").update({ status: "applied", matched_count: matchedCount, created_count: createdCount, changed_count: changedCount, review_count: skippedCount, applied_at: new Date().toISOString(), summary: { ...summary, matchedCount, createdCount, changedCount, skippedCount } }).eq("id", run.id);
    if (complete.error) throw complete.error;
    console.log(JSON.stringify({ applied: true, matchedCount, createdCount, changedCount, skippedCount }, null, 2));
  } catch (error) {
    await db.from("producer_association_sync_runs").update({ status: "failed", error_message: error instanceof Error ? error.message : "Ukendt fejl" }).eq("id", run.id);
    throw error;
  }
}

main().catch(error => { console.error(error); process.exit(1); });
