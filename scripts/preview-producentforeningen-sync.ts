import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fetchProducentforeningenMemberships } from "../lib/server/producer-association-source";
import { buildAssociationPreview } from "../lib/producer-association";

config({ path: ".env.local" });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const source = await fetchProducentforeningenMemberships();
  const { data, error } = await db.from("employers")
    .select("id,name,is_verified,employer_aliases(alias),employer_legal_entities(id,legal_name,registration_number,website,archived_at)")
    .is("merged_into_id", null)
    .is("archived_at", null);
  if (error) throw error;
  const employers = (data ?? []).map((employer: any) => ({
    employerId: employer.id,
    canonicalName: employer.name,
    aliases: (employer.employer_aliases ?? []).map((item: any) => item.alias),
    legalEntities: (employer.employer_legal_entities ?? []).filter((item: any) => !item.archived_at).map((entity: any) => ({ id: entity.id, legalName: entity.legal_name, registrationCountry: "DK", registrationType: "CVR", registrationNumber: entity.registration_number, entityKind: "company", isPrimary: false, registrationStatus: null, website: entity.website })),
    websites: (employer.employer_legal_entities ?? []).map((entity: any) => entity.website ?? "").filter(Boolean),
    isVerified: Boolean(employer.is_verified),
  }));
  const preview = buildAssociationPreview(source.rows, employers);
  const summary = Object.fromEntries(["match", "create", "review"].map(kind => [kind, preview.filter(item => item.recommendation === kind).length]));
  console.log(JSON.stringify({ verifiedOn: source.verifiedOn, rows: source.rows.length, unique: preview.length, local: employers.length, summary, review: preview.filter(item => item.recommendation === "review").map(item => ({ source: item.sourceName, candidates: item.candidates })) }, null, 2));
}

main().catch(error => { console.error(error); process.exit(1); });
