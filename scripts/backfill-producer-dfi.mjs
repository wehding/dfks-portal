import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function readEnv(path) {
  return Object.fromEntries(
    fs.readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter(line => line.includes("=") && !line.trim().startsWith("#"))
      .map(line => {
        const separator = line.indexOf("=");
        const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
        return [line.slice(0, separator), value];
      }),
  );
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("da")
    .replace(/[’'`´]/g, "")
    .replace(/[^a-z0-9æøå]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function baseName(value) {
  return normalizeName(value)
    .replace(/(?:\s+(?:aps|a s|as|ivs|amba|s mba|ltd|limited|inc|llc|ab|oy|gmbh))+$/g, "")
    .trim();
}

function uniqueMatch(results, producerName) {
  const exact = results.filter(result => normalizeName(result.Name) === normalizeName(producerName));
  if (exact.length === 1) return { result: exact[0], confidence: "exact" };
  const base = results.filter(result => baseName(result.Name) && baseName(result.Name) === baseName(producerName));
  if (base.length === 1) return { result: base[0], confidence: "base" };
  const compactBase = baseName(producerName).replace(/\s+/g, "");
  const compact = results.filter(result => compactBase && baseName(result.Name).replace(/\s+/g, "") === compactBase);
  return compact.length === 1 ? { result: compact[0], confidence: "compact_base" } : null;
}

async function mapLimit(rows, limit, mapper) {
  const output = new Array(rows.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < rows.length) {
      const index = nextIndex++;
      output[index] = await mapper(rows[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, worker));
  return output;
}

const apply = process.argv.includes("--apply");
const env = readEnv(".env.local");
const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DFI_API_USERNAME", "DFI_API_PASSWORD"];
for (const name of required) {
  if (!env[name]) throw new Error(`Mangler ${name} i .env.local`);
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const dfiHeaders = {
  Authorization: `Basic ${Buffer.from(`${env.DFI_API_USERNAME}:${env.DFI_API_PASSWORD}`).toString("base64")}`,
  Accept: "application/json",
  "Accept-Language": "da-DK",
};

const { data: producers, error } = await db
  .from("employers")
  .select("id,name,dfi_company_id")
  .is("merged_into_id", null)
  .is("archived_at", null)
  .order("name");
if (error) throw error;

const pending = (producers ?? []).filter(producer => !producer.dfi_company_id);
const inspected = await mapLimit(pending, 4, async producer => {
  try {
    const response = await fetch(`https://data.dfi.dk/v1/company?Name=${encodeURIComponent(producer.name)}`, {
      headers: dfiHeaders,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { producer, status: "error", detail: `DFI HTTP ${response.status}` };
    const payload = await response.json();
    const results = Array.isArray(payload.CompanyList) ? payload.CompanyList : [];
    const match = uniqueMatch(results, producer.name);
    if (!match) {
      return {
        producer,
        status: results.length ? "review" : "not_found",
        candidates: results.slice(0, 5).map(row => ({ id: row.Id, name: row.Name })),
      };
    }
    return {
      producer,
      status: "matched",
      dfiId: Number(match.result.Id),
      dfiName: String(match.result.Name),
      confidence: match.confidence,
    };
  } catch (requestError) {
    return { producer, status: "error", detail: requestError instanceof Error ? requestError.message : "Ukendt fejl" };
  }
});

const matches = inspected.filter(row => row.status === "matched");
const applied = [];
if (apply) {
  const updatedAt = new Date().toISOString();
  const { error: updateError } = await db.from("employers").upsert(matches.map(match => ({
    id: match.producer.id,
    name: match.producer.name,
    dfi_company_id: match.dfiId,
    is_verified: true,
    updated_at: updatedAt,
  })), { onConflict: "id" });
  if (updateError) throw updateError;

  const matchIds = matches.map(match => match.producer.id);
  const { data: existingAliases, error: aliasReadError } = matchIds.length
    ? await db.from("employer_aliases").select("employer_id,alias").in("employer_id", matchIds)
    : { data: [], error: null };
  if (aliasReadError) throw aliasReadError;
  const aliasesToInsert = matches.flatMap(match => {
    if (normalizeName(match.dfiName) === normalizeName(match.producer.name)) return [];
    const exists = (existingAliases ?? []).some(row => row.employer_id === match.producer.id && normalizeName(row.alias) === normalizeName(match.dfiName));
    return exists ? [] : [{
      employer_id: match.producer.id,
      alias: match.dfiName,
      alias_type: "spelling",
      source: "dfi_backfill",
    }];
  });
  const aliasResult = aliasesToInsert.length
    ? await db.from("employer_aliases").insert(aliasesToInsert)
    : { error: null };
  for (const match of matches) {
    applied.push(aliasResult.error && normalizeName(match.dfiName) !== normalizeName(match.producer.name)
      ? { name: match.producer.name, status: "dfi_saved_alias_failed", detail: aliasResult.error.message }
      : { name: match.producer.name, status: "updated", dfiId: match.dfiId, dfiName: match.dfiName });
  }
}

const grouped = Object.groupBy(inspected, row => row.status);
console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  existingDfiIds: (producers ?? []).length - pending.length,
  inspected: pending.length,
  matched: grouped.matched?.length ?? 0,
  needsReview: grouped.review?.length ?? 0,
  notFound: grouped.not_found?.length ?? 0,
  errors: grouped.error?.length ?? 0,
  applied: applied.filter(row => row.status === "updated").length,
  matches: matches.map(row => ({ name: row.producer.name, dfiId: row.dfiId, dfiName: row.dfiName, confidence: row.confidence })),
  review: (grouped.review ?? []).map(row => ({ name: row.producer.name, candidates: row.candidates })),
  unmatched: (grouped.not_found ?? []).map(row => row.producer.name),
  failures: [...(grouped.error ?? []).map(row => ({ name: row.producer.name, detail: row.detail })), ...applied.filter(row => row.status !== "updated")],
}, null, 2));
