/**
 * scripts/one-off/clear-blocked-billing-ai-jobs.mjs
 *
 * Engangsoprydning: contract_ai_jobs der blev sat til status 'blocked' pga. et
 * kortvarigt AI-udbyder betalings-/kreditdyk (failure_class = 'billing' eller
 * 'configuration'). 'blocked' er en bevidst dead-end — jobbet hentes aldrig
 * igen af claim_next_contract_ai_job — så et 15-min udbyderproblem efterlader
 * jobs permanent i "kræver handling"-visningen.
 *
 * Scriptet SLETTER de blokerede jobs. Det udløser INGEN ny AI-kørsel:
 * hver kontrakt falder tilbage til sit tidligere 'done'-job og beholder sin
 * eksisterende extracted_data. Kør derefter AI manuelt pr. kontrakt efter behov.
 *
 * Kør tørt (default):   node scripts/one-off/clear-blocked-billing-ai-jobs.mjs
 * Anvend:               node scripts/one-off/clear-blocked-billing-ai-jobs.mjs --apply
 * Begræns til én org:   ... --org=<uuid>
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const apply = process.argv.includes("--apply");
const orgArg = process.argv.find(a => a.startsWith("--org="))?.split("=")[1] ?? null;
const CLEARABLE_CLASSES = ["billing", "configuration"];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY skal være sat i .env.local");

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

let query = db
  .from("contract_ai_jobs")
  .select("id, contract_id, org_id, failure_class, error_code, created_at")
  .eq("status", "blocked")
  .in("failure_class", CLEARABLE_CLASSES)
  .order("created_at", { ascending: true });
if (orgArg) query = query.eq("org_id", orgArg);

const { data: jobs, error } = await query;
if (error) throw new Error(`Kunne ikke læse blokerede jobs: ${error.message}`);

if (!jobs?.length) {
  console.log("Ingen blokerede billing/configuration-jobs at rydde op.");
  process.exit(0);
}

const byClass = jobs.reduce((acc, j) => ((acc[j.failure_class] = (acc[j.failure_class] ?? 0) + 1), acc), {});
console.log(`Fandt ${jobs.length} blokerede jobs (${JSON.stringify(byClass)}):`);
for (const j of jobs) {
  console.log(`  ${j.created_at.slice(0, 19)}  contract ${j.contract_id.slice(0, 8)}  ${j.failure_class}/${j.error_code}`);
}

// Sikkerhedstjek: hver kontrakt skal have et tidligere 'done'-job ELLER
// eksisterende extracted_data, så sletningen aldrig efterlader en kontrakt
// uden aflæsning.
const contractIds = [...new Set(jobs.map(j => j.contract_id))];
const [{ data: doneJobs }, { data: validations }] = await Promise.all([
  db.from("contract_ai_jobs").select("contract_id").eq("status", "done").in("contract_id", contractIds),
  db.from("contract_validations").select("contract_id").not("extracted_data", "is", null).in("contract_id", contractIds),
]);
const covered = new Set([
  ...(doneJobs ?? []).map(r => r.contract_id),
  ...(validations ?? []).map(r => r.contract_id),
]);
const uncovered = contractIds.filter(id => !covered.has(id));
if (uncovered.length) {
  console.log(`\n⚠ ${uncovered.length} kontrakt(er) har hverken et tidligere 'done'-job eller extracted_data:`);
  for (const id of uncovered) console.log(`  ${id}`);
  console.log("De bliver sprunget over — kør AI manuelt på dem i stedet.");
}
const deletable = jobs.filter(j => covered.has(j.contract_id)).map(j => j.id);

if (!apply) {
  console.log(`\nTør kørsel. ${deletable.length} job(s) ville blive slettet. Kør med --apply for at anvende.`);
  process.exit(0);
}
if (!deletable.length) {
  console.log("\nIntet at slette.");
  process.exit(0);
}

const { error: delError } = await db.from("contract_ai_jobs").delete().in("id", deletable);
if (delError) throw new Error(`Sletning fejlede: ${delError.message}`);
console.log(`\n✓ Slettede ${deletable.length} blokerede job(s). Kontrakterne beholder deres tidligere aflæsning.`);
