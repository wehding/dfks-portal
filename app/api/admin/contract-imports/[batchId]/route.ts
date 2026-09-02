import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";
import { requireContractImportWriteAccess } from "@/lib/server/contract-import-access";

export const dynamic = "force-dynamic";

function decodeCursor(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { createdAt?: string; id?: string };
    if (!parsed.createdAt || !parsed.id || Number.isNaN(Date.parse(parsed.createdAt)) || !/^[0-9a-f-]{36}$/i.test(parsed.id)) return null;
    return { createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id };
  } catch { return null; }
}

export async function GET(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const auth = await requireContractImportWriteAccess();
  if (!auth) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
  const { caller } = auth;
  const { batchId } = await context.params;
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 50));
  const cursor = decodeCursor(request.nextUrl.searchParams.get("cursor"));
  const db = createServiceClient();
  const batch = await db.from("contract_import_batches")
    .select("id,source,status,discovered_count,uploaded_count,duplicate_count,completed_count,failed_count,created_at,updated_at,completed_at")
    .eq("id", batchId).eq("org_id", caller.orgId).maybeSingle();
  if (batch.error) return NextResponse.json({ error: "Importen kunne ikke hentes" }, { status: 500 });
  if (!batch.data) return NextResponse.json({ error: "Importen blev ikke fundet" }, { status: 404 });

  let query = db.from("contract_import_items")
    // Ownership suggestions are handled exclusively by the manager-only
    // ownership queue and must not leak through the ordinary import detail.
    .select("id,original_file_name,status,contract_id,ai_job_id,work_match_score,producer_match_score,possible_duplicate_of,error_code,error_message,attempts,next_attempt_at,created_at,contract_ai_jobs(provider,model,stage,status,usage_run_id,input_tokens,output_tokens,chunk_count)")
    .eq("batch_id", batchId).eq("org_id", caller.orgId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  const items = await query;
  if (items.error) return NextResponse.json({ error: "Importfilerne kunne ikke hentes" }, { status: 500 });
  const rows = items.data ?? [];
  const runIds = Array.from(new Set(rows.flatMap(row => {
    const job = Array.isArray(row.contract_ai_jobs) ? row.contract_ai_jobs[0] : row.contract_ai_jobs;
    return job?.usage_run_id ? [job.usage_run_id] : [];
  })));
  const usage = runIds.length
    ? await db.from("ai_usage_events").select("run_id,cost_usd,cost_dkk").in("run_id", runIds)
    : { data: [], error: null };
  if (usage.error) return NextResponse.json({ error: "AI-forbruget kunne ikke hentes" }, { status: 500 });
  const costs = new Map<string, { usd: number; dkk: number }>();
  for (const event of usage.data ?? []) {
    if (!event.run_id) continue;
    const current = costs.get(event.run_id) ?? { usd: 0, dkk: 0 };
    current.usd += Number(event.cost_usd ?? 0);
    current.dkk += Number(event.cost_dkk ?? 0);
    costs.set(event.run_id, current);
  }
  const page = rows.slice(0, limit).map(row => {
    const job = Array.isArray(row.contract_ai_jobs) ? row.contract_ai_jobs[0] : row.contract_ai_jobs;
    const jobCost = job?.usage_run_id ? costs.get(job.usage_run_id) : null;
    return {
      ...row,
      contract_ai_jobs: undefined,
      ai: job ? {
        provider: job.provider,
        model: job.model,
        stage: job.stage,
        status: job.status,
        inputTokens: Number(job.input_tokens ?? 0),
        outputTokens: Number(job.output_tokens ?? 0),
        chunkCount: Number(job.chunk_count ?? 0),
        costUsd: jobCost?.usd ?? null,
        costDkk: jobCost?.dkk ?? null,
      } : null,
    };
  });
  const last = page.at(-1);
  const nextCursor = rows.length > limit && last
    ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString("base64url")
    : null;
  const contractIds = [...new Set(page.map(item => item.contract_id).filter((id): id is string => Boolean(id)))];
  const { data: contracts } = contractIds.length ? await db.from("contracts").select("rights_holder_id").in("id", contractIds).eq("org_id", caller.orgId) : { data: [] };
  await recordSensitiveFlow({ actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" }, action: "read", component: "admin.contract-imports.batch", entityType: "contract_import_batches", entityId: batchId, targetMemberUuids: (contracts ?? []).map(item => item.rights_holder_id).filter((id): id is string => Boolean(id)), orgIds: [caller.orgId], purposeCode: "contract_import_review", legalBasis: "GDPR Art. 6(1)(c)/(f) og 9(2)(d)", dataCategories: ["contract_data", "document_data", "ai_analysis"], counts: { results: page.length } });
  return NextResponse.json({ batch: batch.data, items: page, nextCursor });
}
