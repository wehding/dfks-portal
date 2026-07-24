import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { apiCvrNameMatchScore, formatApiCvrAddress, fuzzySearchApiCvr, lookupApiCvr } from "../lib/api-cvr-mcp";

function readEnv(path: string) {
  return Object.fromEntries(
    fs.readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter(line => line.includes("=") && !line.trim().startsWith("#"))
      .map(line => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
}

async function mapLimit<T, R>(rows: T[], limit: number, mapper: (row: T) => Promise<R>) {
  const output = new Array<R>(rows.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < rows.length) {
      const index = nextIndex++;
      output[index] = await mapper(rows[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, worker));
  return output;
}

async function main() {
const apply = process.argv.includes("--apply");
const env = readEnv(".env.local");
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase-konfiguration mangler i .env.local");
}
if (env.APICVR_MCP_URL) process.env.APICVR_MCP_URL = env.APICVR_MCP_URL;

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: producers, error } = await db
  .from("employers")
  .select("id,name,employer_aliases(alias),employer_legal_entities(id,registration_number,archived_at)")
  .is("merged_into_id", null)
  .is("archived_at", null)
  .order("name");
if (error) throw error;

const pending = (producers ?? []).filter(producer => !(producer.employer_legal_entities ?? []).some(entity => !entity.archived_at && entity.registration_number));
const inspected = await mapLimit(pending, 3, async producer => {
  try {
    const names = [producer.name, ...(producer.employer_aliases ?? []).map(alias => alias.alias)];
    const resultMap = new Map<string, Awaited<ReturnType<typeof fuzzySearchApiCvr>>[number]>();
    for (const name of names.slice(0, 3)) {
      for (const candidate of await fuzzySearchApiCvr(name)) resultMap.set(candidate.cvrNumber, candidate);
    }
    const ranked = [...resultMap.values()]
      .map(candidate => ({
        candidate,
        score: Math.max(...names.map(name => apiCvrNameMatchScore(candidate.name, name))),
      }))
      .filter(row => row.score >= 105)
      .sort((left, right) => right.score - left.score);
    if (!ranked.length) return { producer, status: "not_found" as const, candidates: [] };

    const bestScore = ranked[0].score;
    const strongest = ranked.filter(row => row.score === bestScore);
    if (strongest.length !== 1) {
      return { producer, status: "review" as const, candidates: ranked.slice(0, 8) };
    }
    const company = await lookupApiCvr(strongest[0].candidate.cvrNumber);
    if (!company) return { producer, status: "not_found" as const, candidates: ranked.slice(0, 8) };
    const normalizedStatus = company.status?.trim().toLocaleUpperCase("da") ?? "";
    if (normalizedStatus && !["NORMAL", "AKTIV", "ACTIVE"].includes(normalizedStatus)) {
      return { producer, status: "review" as const, candidates: ranked.slice(0, 8), detail: `Status ${company.status}` };
    }
    return { producer, status: "matched" as const, company, score: bestScore };
  } catch (lookupError) {
    return { producer, status: "error" as const, detail: lookupError instanceof Error ? lookupError.message : "Ukendt fejl" };
  }
});

const matches = inspected.filter(row => row.status === "matched");
const duplicateCvr = new Set(matches
  .filter((match, index) => matches.findIndex(other => other.company.cvrNumber === match.company.cvrNumber) !== index)
  .map(match => match.company.cvrNumber));
const safeMatches = matches.filter(match => !duplicateCvr.has(match.company.cvrNumber));
const failures: Array<{ name: string; detail: string }> = [];
let applied = 0;

if (apply && safeMatches.length) {
  const cvrNumbers = safeMatches.map(match => match.company.cvrNumber);
  const { data: existing, error: existingError } = await db
    .from("employer_legal_entities")
    .select("id,employer_id,registration_number")
    .in("registration_number", cvrNumbers);
  if (existingError) throw existingError;
  const existingByCvr = new Map((existing ?? []).map(entity => [entity.registration_number, entity]));
  const fetchedAt = new Date().toISOString();
  const inserts = [];
  for (const match of safeMatches) {
    const existingEntity = existingByCvr.get(match.company.cvrNumber);
    if (existingEntity && existingEntity.employer_id !== match.producer.id) {
      failures.push({ name: match.producer.name, detail: `CVR ${match.company.cvrNumber} tilhører allerede en anden producent` });
      continue;
    }
    const payload = {
      employer_id: match.producer.id,
      legal_name: match.company.name,
      registration_country: "DK",
      registration_type: "CVR",
      registration_number: match.company.cvrNumber,
      entity_kind: "company",
      address: formatApiCvrAddress(match.company),
      contact_phone: match.company.phone,
      contact_email: match.company.email,
      website: match.company.website,
      registration_status: match.company.status,
      industry_code: match.company.industryCode,
      industry_description: match.company.industryDescription,
      company_type: match.company.companyType,
      is_primary: true,
      verified_at: fetchedAt,
      source_metadata: {
        source: "apicvr_mcp",
        fetched_at: fetchedAt,
        start_date: match.company.startDate,
        end_date: match.company.endDate,
        employees: match.company.employees,
      },
      updated_at: fetchedAt,
    };
    if (existingEntity) {
      const { error: updateError } = await db.from("employer_legal_entities").update(payload).eq("id", existingEntity.id);
      if (updateError) failures.push({ name: match.producer.name, detail: updateError.message });
      else applied += 1;
    } else {
      inserts.push(payload);
    }
  }
  if (inserts.length) {
    const { error: insertError } = await db.from("employer_legal_entities").insert(inserts);
    if (insertError) throw insertError;
    applied += inserts.length;
  }
}

const grouped = Object.groupBy(inspected, row => row.status);
console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  producers: producers?.length ?? 0,
  inspected: pending.length,
  matched: safeMatches.length,
  review: (grouped.review?.length ?? 0) + duplicateCvr.size,
  notFound: grouped.not_found?.length ?? 0,
  errors: grouped.error?.length ?? 0,
  applied,
  matches: safeMatches.map(match => ({ producer: match.producer.name, cvr: match.company.cvrNumber, legalName: match.company.name, score: match.score })),
  needsReview: (grouped.review ?? []).map(row => ({ producer: row.producer.name, detail: row.detail, candidates: (row.candidates ?? []).map(candidate => ({ name: candidate.candidate.name, cvr: candidate.candidate.cvrNumber, score: candidate.score })) })),
  unmatched: (grouped.not_found ?? []).map(row => row.producer.name),
  failures: [...(grouped.error ?? []).map(row => ({ name: row.producer.name, detail: row.detail })), ...failures],
}, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
