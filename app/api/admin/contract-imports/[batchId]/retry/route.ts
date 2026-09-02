import { after, NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { processPendingContractJobs } from "@/lib/server/contract-import-processor";
import { CONTRACT_IMPORT_PROMPT_VERSION, CONTRACT_IMPORT_SCHEMA_VERSION } from "@/lib/contract-import-job";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";
import { requireContractImportWriteAccess } from "@/lib/server/contract-import-access";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RetryMode = "resume" | "rematch" | "reanalyze";

export async function POST(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const auth = await requireContractImportWriteAccess();
  if (!auth) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const { caller } = auth;
  const { batchId } = await context.params;
  const body = await request.json().catch(() => ({})) as { itemIds?: unknown; mode?: unknown };
  const mode: RetryMode | null = body.mode === "resume" || body.mode === "rematch" || body.mode === "reanalyze" ? body.mode : null;
  if (!mode) return NextResponse.json({ error: "Ugyldig retrytype" }, { status: 400 });
  const itemIds = Array.isArray(body.itemIds)
    ? Array.from(new Set(body.itemIds.filter((value): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)))).slice(0, 500)
    : [];

  const db = createServiceClient({ audit: {
    actorUserId: caller.userId,
    actorOrgId: caller.orgId,
    actorRole: caller.role,
    source: "admin",
    correlationId: crypto.randomUUID(),
    mode: "summary",
  } });
  const batch = await db.from("contract_import_batches").select("id").eq("id", batchId).eq("org_id", caller.orgId).maybeSingle();
  if (batch.error) return NextResponse.json({ error: "Importen kunne ikke hentes" }, { status: 500 });
  if (!batch.data) return NextResponse.json({ error: "Importen blev ikke fundet" }, { status: 404 });

  let query = db.from("contract_import_items").select("id,ai_job_id,contract_id").eq("batch_id", batchId).eq("org_id", caller.orgId).not("ai_job_id", "is", null);
  if (itemIds.length) query = query.in("id", itemIds);
  else if (mode === "resume") query = query.in("status", ["retryable_error", "blocked", "dead"]);
  const items = await query;
  if (items.error) return NextResponse.json({ error: "Importfilerne kunne ikke hentes" }, { status: 500 });
  const jobIds = (items.data ?? []).map(item => item.ai_job_id).filter((id): id is string => Boolean(id));
  if (!jobIds.length) return NextResponse.json({ ok: true, queued: 0 });

  const now = new Date().toISOString();
  const jobPatch: Record<string, unknown> = {
    status: "queued",
    lease_expires_at: null,
    next_attempt_at: now,
    completed_at: null,
    error_message: null,
    error_code: null,
    failure_class: null,
    updated_at: now,
  };
  if (mode === "rematch") {
    jobPatch.stage = "matching";
    jobPatch.attempts = 0;
  }
  if (mode === "reanalyze") {
    jobPatch.stage = "extraction";
    jobPatch.result_data = null;
    jobPatch.provider_request_id = null;
    jobPatch.usage_run_id = null;
    jobPatch.input_tokens = 0;
    jobPatch.output_tokens = 0;
    jobPatch.chunk_count = 0;
    jobPatch.provider = null;
    jobPatch.model = null;
    jobPatch.prompt_version = CONTRACT_IMPORT_PROMPT_VERSION;
    jobPatch.schema_version = CONTRACT_IMPORT_SCHEMA_VERSION;
    jobPatch.attempts = 0;
  }
  const jobs = await db.from("contract_ai_jobs").update(jobPatch).in("id", jobIds).neq("status", "processing").select("id");
  if (jobs.error) return NextResponse.json({ error: "Analysejobbene kunne ikke genstartes" }, { status: 500 });
  const updatedJobIds = new Set((jobs.data ?? []).map(job => job.id));
  const resetItemIds = (items.data ?? []).filter(item => item.ai_job_id && updatedJobIds.has(item.ai_job_id)).map(item => item.id);
  if (!resetItemIds.length) return NextResponse.json({ ok: true, queued: 0, mode });
  const resetItems = await db.from("contract_import_items").update({
    status: "queued",
    error_code: null,
    error_message: null,
    next_attempt_at: now,
    updated_at: now,
  }).in("id", resetItemIds);
  if (resetItems.error) return NextResponse.json({ error: "Importstatus kunne ikke nulstilles" }, { status: 500 });

  const contractIds = [...new Set((items.data ?? []).map(item => item.contract_id).filter((id): id is string => Boolean(id)))];
  const { data: contracts } = contractIds.length ? await db.from("contracts").select("rights_holder_id").in("id", contractIds).eq("org_id", caller.orgId) : { data: [] };
  await recordSensitiveFlow({ actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" }, action: "ai_analysis", component: "admin.contract-imports.retry", entityType: "contract_import_batches", entityId: batchId, targetMemberUuids: (contracts ?? []).map(item => item.rights_holder_id).filter((id): id is string => Boolean(id)), orgIds: [caller.orgId], purposeCode: "contract_import_retry", legalBasis: "GDPR Art. 6(1)(c)/(f) og 9(2)(d)", dataCategories: ["contract_data", "document_data", "ai_analysis"], counts: { queued: updatedJobIds.size } });

  after(async () => { await processPendingContractJobs(caller.orgId); });
  return NextResponse.json({ ok: true, queued: updatedJobIds.size, mode });
}
