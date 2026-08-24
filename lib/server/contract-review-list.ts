import "server-only";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { normalizeContractReviewAnalysisStatus, type ContractReviewJobSnapshot } from "@/lib/contract-review-job-status";
import { postgrestIlikePattern } from "@/lib/postgrest-search";
import { auditHeadersContext, auditSearchFingerprint } from "@/lib/audit-access-server";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { getAuthUserLabels } from "@/lib/server/auth-user-label-cache";
import { createListLoadTimer } from "@/lib/server/list-load-timing";

export type ContractReviewListCaller = { userId: string; orgId: string; role: string };

export async function loadContractReviewList(
  caller: ContractReviewListCaller,
  searchParams: URLSearchParams,
  requestHeaders: Headers,
) {
  const timer = createListLoadTimer("contract-reviews");
  const supabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const queue = searchParams.get("queue") ?? "all";
  const statusParam = searchParams.get("status");
  const productionTypeParam = searchParams.get("productionType");
  const search = searchParams.get("search")?.trim();
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1") || 1);
  const requestedLimit = Number.parseInt(searchParams.get("limit") ?? "20") || 20;
  const limit = [20, 50, 100].includes(requestedLimit) ? requestedLimit : 20;
  const sort = ["reviewed_at", "member_name", "status", "production_type"].includes(searchParams.get("sort") ?? "")
    ? searchParams.get("sort")!
    : "reviewed_at";
  const ascending = searchParams.get("direction") === "asc";
  const offset = (page - 1) * limit;

  let query = supabase
    .from("contract_reviews")
    .select("id,contract_id,org_id,member_name,file_name,reviewed_at,production_type,producer_name,producer_overenskomst_bound,status,assigned_to,ai_status,intake_status", { count: "exact" })
    .eq("org_id", caller.orgId)
    .is("soft_deleted_at", null)
    .order(sort, { ascending })
    .order("id", { ascending })
    .range(offset, offset + limit - 1);

  if (queue === "mine") query = query.eq("assigned_to", caller.userId).in("status", ["afventer", "behandling"]);
  if (statusParam) {
    const statuses = statusParam.split(",").map(value => value.trim()).filter(Boolean);
    if (statuses.length) query = query.in("status", statuses);
  }
  if (productionTypeParam) {
    const types = productionTypeParam.split(",").map(value => value.trim()).filter(Boolean);
    if (types.length) query = query.in("production_type", types);
  }
  if (search) {
    const pattern = postgrestIlikePattern(search);
    if (pattern) query = query.or(`member_name.ilike.${pattern},file_name.ilike.${pattern},producer_name.ilike.${pattern}`);
  }

  const { data, error, count } = await query;
  timer.mark("list");
  if (error) throw new Error("Kontraktgennemgangen kunne ikke hentes.");

  const reviews = data ?? [];
  const reviewIds = reviews.map(review => review.id);
  const assigneeIds = [...new Set(reviews.map(review => review.assigned_to).filter((id): id is string => Boolean(id)))];
  const [jobsResult, assigneeLabels] = await Promise.all([
    reviewIds.length
      ? supabase.rpc("get_contract_review_job_statuses", {
          target_org_id: caller.orgId,
          target_review_ids: reviewIds,
        })
      : Promise.resolve({ data: [] }),
    getAuthUserLabels(supabase, assigneeIds),
  ]);
  if ("error" in jobsResult && jobsResult.error) throw new Error("Analysestatus kunne ikke hentes.");
  const jobs = jobsResult.data;
  timer.mark("row-details");
  const latestJobByReview = new Map<string, ContractReviewJobSnapshot>();
  for (const job of jobs ?? []) {
    latestJobByReview.set(job.review_id, {
      status: job.status,
      attempts: job.attempts,
      next_attempt_at: job.next_attempt_at,
      error_message: job.has_error ? "recorded" : null,
    } as ContractReviewJobSnapshot);
  }
  const normalized = reviews.map(review => {
    const analysisJob = latestJobByReview.get(review.id) ?? null;
    return {
      ...review,
      assigned_to_name: review.assigned_to ? assigneeLabels.get(review.assigned_to) ?? "Tildelt medarbejder" : null,
      analysis_job: analysisJob ? {
        status: analysisJob.status,
        attempts: analysisJob.attempts,
        next_attempt_at: analysisJob.next_attempt_at,
        error: analysisJob.error_message ? "Kontraktanalysen kunne ikke gennemføres." : null,
      } : null,
      analysis_status: normalizeContractReviewAnalysisStatus({
        aiStatus: review.ai_status,
        intakeStatus: review.intake_status,
        job: analysisJob,
      }),
    };
  });

  await recordAuditEvent({
    context: auditHeadersContext(requestHeaders, caller, "admin", "admin.contract-reviews.list"),
    action: search || statusParam || productionTypeParam ? "search" : "read",
    entityType: "contract_reviews",
    entityLabel: "Kontraktgennemgange",
    purposeCode: "contract_case_management",
    legalBasis: "GDPR Art. 6(1)(b) og 6(1)(f)",
    dataCategories: ["contract_data", "contact_data", "ai_analysis"],
    orgIds: [caller.orgId],
    metadata: {
      resultCount: normalized.length,
      filters: { queue, hasStatus: Boolean(statusParam), hasProductionType: Boolean(productionTypeParam), hasSearch: Boolean(search) },
      queryFingerprint: search ? auditSearchFingerprint(search) : null,
    },
  });
  timer.mark("audit");
  timer.finish({ route: "/admin/kontraktgennemgang", rows: normalized.length });
  return { data: normalized, count: count ?? 0, page, limit, orgId: caller.orgId };
}
