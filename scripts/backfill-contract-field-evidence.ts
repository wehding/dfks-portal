import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { buildPdfLayout, type ContractLayout } from "../lib/contract-layout";
import { mergeContractEvidence, resolveNativeLayoutEvidence, resolveSpatialV3Evidence, sanitizeStoredContractEvidence } from "../lib/contract-field-evidence";
import { extractPdfTextWithLayout } from "../lib/pdf-parse";
import { parseVerifiedSpatialV3Artifact } from "../lib/server/contract-spatial-artifact";
import type { StoredContractFieldEvidence } from "../lib/contract-workbench";

config({ path: ".env.local" });

const apply = process.argv.includes("--apply");
const queueOcr = process.argv.includes("--queue-ocr");
const limitArg = process.argv.find(argument => argument.startsWith("--limit="));
const orgArg = process.argv.find(argument => argument.startsWith("--org="));
const limit = Math.min(10_000, Math.max(1, Number(limitArg?.split("=")[1] ?? 500)));
const orgId = orgArg?.split("=")[1] ?? null;

if (queueOcr && !apply) throw new Error("--queue-ocr kræver --apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY mangler");
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = "kontrakter";

type ValidationRow = { id: string; extracted_data: Record<string, unknown> | null };
type ContractRow = {
  id: string;
  org_id: string;
  pdf_url: string | null;
  processed_pdf_url: string | null;
  layout_data: ContractLayout | null;
  document_spatial_data_path: string | null;
  document_spatial_schema_version: string | null;
  document_spatial_accuracy: number | null;
  contract_validations: ValidationRow | ValidationRow[] | null;
};

function sourceFormatFromPath(path: string | null) {
  const extension = path?.split(/[?#]/, 1)[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return extension && ["pdf", "doc", "docx"].includes(extension) ? extension : null;
}

function relation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

async function download(path: string) {
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) throw error ?? new Error("Dokumentet kunne ikke hentes");
  return Buffer.from(await data.arrayBuffer());
}

async function nativeLayout(contract: ContractRow) {
  if (contract.layout_data) return contract.layout_data;
  const path = contract.processed_pdf_url ?? contract.pdf_url;
  if (!path?.toLowerCase().endsWith(".pdf")) return null;
  return buildPdfLayout(await extractPdfTextWithLayout(await download(path)));
}

async function spatialEvidence(contract: ContractRow, sources: Record<string, string | null>) {
  if (contract.document_spatial_schema_version !== "google-vision-spatial-v3" || Number(contract.document_spatial_accuracy ?? 0) < 0.95 || !contract.document_spatial_data_path) return {};
  const { data: job } = await db.from("contract_document_jobs")
    .select("spatial_sha256,spatial_data_path,spatial_accuracy_score")
    .eq("contract_id", contract.id)
    .eq("status", "completed")
    .eq("spatial_data_path", contract.document_spatial_data_path)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!job?.spatial_sha256 || Number(job.spatial_accuracy_score ?? 0) < 0.95) return {};
  return resolveSpatialV3Evidence(sources, parseVerifiedSpatialV3Artifact(await download(contract.document_spatial_data_path), job.spatial_sha256));
}

async function queueSelectiveDocumentProcessing(contract: ContractRow) {
  if (!contract.pdf_url || !sourceFormatFromPath(contract.pdf_url)) return false;
  const { data: active } = await db.from("contract_document_jobs").select("id").eq("contract_id", contract.id).in("status", ["queued", "processing"]).limit(1).maybeSingle();
  if (active) return false;
  const jobId = randomUUID();
  const { error } = await db.from("contract_document_jobs").insert({
    id: jobId,
    org_id: contract.org_id,
    contract_id: contract.id,
    original_storage_path: contract.pdf_url,
    output_storage_path: `${contract.org_id}/processed/${contract.id}/pending/${jobId}/normalised.pdf`,
    status: "queued",
    priority: 1000,
    attempts: 0,
    downstream_ai_policy: "reanalyze",
  });
  if (error) throw error;
  return true;
}

async function main() {
  let query = db.from("contracts")
    .select("id,org_id,pdf_url,processed_pdf_url,layout_data,document_spatial_data_path,document_spatial_schema_version,document_spatial_accuracy,contract_validations(id,extracted_data)")
    .order("id")
    .limit(limit);
  if (orgId) query = query.eq("org_id", orgId);
  const { data, error } = await query;
  if (error) throw error;

  const result = { inspected: 0, spatialV3: 0, nativePdf: 0, updated: 0, ocrRequired: 0, wordConversionRequired: 0, processingQueued: 0, unsupported: 0, skipped: 0 };
  for (const raw of data ?? []) {
    const contract = raw as unknown as ContractRow;
    const validation = relation(contract.contract_validations);
    result.inspected += 1;
    if (!validation) { result.skipped += 1; continue; }
    const extracted = validation.extracted_data ?? {};
    const sources = extracted._sources && typeof extracted._sources === "object" ? extracted._sources as Record<string, string | null> : {};
    const sourceCount = Object.entries(sources).filter(([key, value]) => value && !/(?:_clause_id|_page|_focus)$/.test(key)).length;
    if (!sourceCount) { result.skipped += 1; continue; }

    let layout: ContractLayout | null = null;
    let native: Record<string, StoredContractFieldEvidence> = {};
    let spatial: Record<string, StoredContractFieldEvidence> = {};
    try { spatial = await spatialEvidence(contract, sources); } catch { /* native fallback below */ }
    if (Object.keys(spatial).length) result.spatialV3 += 1;
    if (Object.keys(spatial).length < sourceCount) {
      try {
        layout = await nativeLayout(contract);
        native = resolveNativeLayoutEvidence(sources, layout);
      } catch { /* OCR candidate below */ }
    }
    if (Object.keys(native).length) result.nativePdf += 1;
    const existing = sanitizeStoredContractEvidence(extracted._evidence);
    const evidence = mergeContractEvidence(existing, native, spatial);
    if (!Object.keys(evidence).length) {
      const sourceFormat = sourceFormatFromPath(contract.pdf_url);
      if (!sourceFormat) {
        result.unsupported += 1;
        continue;
      }
      result.ocrRequired += 1;
      if (sourceFormat === "doc" || sourceFormat === "docx") result.wordConversionRequired += 1;
      if (queueOcr && await queueSelectiveDocumentProcessing(contract)) result.processingQueued += 1;
      continue;
    }
    if (JSON.stringify(existing) === JSON.stringify(evidence) && (!layout || contract.layout_data)) continue;
    if (apply) {
      const { error: updateError } = await db.from("contract_validations").update({ extracted_data: { ...extracted, _evidence: evidence } }).eq("id", validation.id);
      if (updateError) throw updateError;
      if (layout && !contract.layout_data) {
        const { error: layoutError } = await db.from("contracts").update({ layout_data: layout }).eq("id", contract.id).eq("org_id", contract.org_id);
        if (layoutError) throw layoutError;
      }
    }
    result.updated += 1;
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...result }, null, 2));
  if (!apply && result.ocrRequired) console.log("Dokumentkandidater blev kun optalt. Word-filer kræver en deployet konverteringsworker før --apply --queue-ocr.");
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
