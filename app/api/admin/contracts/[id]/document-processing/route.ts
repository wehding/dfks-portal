import { NextRequest, NextResponse } from "next/server";
import { requireStaffModuleApi } from "@/lib/api-auth";
import { auditRequestContext } from "@/lib/audit-access-server";
import { recordAuditEvent } from "@/lib/audit-log-server";
import {
  affectedPagesText,
  contractDocumentReviewActions,
  contractDocumentReviewDescriptor,
  sanitizeContractDocumentReviewErrorCode,
  sanitizeContractDocumentReviewDetails,
  type ContractDocumentReviewAction,
  type ContractDocumentReviewData,
} from "@/lib/contract-document-review";
import { isSameOriginMutation } from "@/lib/request-security";
import { createServiceClient } from "@/lib/supabase/service";

type ContractRow = {
  id: string;
  org_id: string;
  rights_holder_id: string | null;
  status: string;
  document_processing_status: string | null;
  document_processing_error_code: string | null;
};

type DocumentJobRow = {
  id: string;
  status: string;
  error_code: string | null;
  page_count: number | null;
  attempts: number | null;
  review_disposition: string | null;
  review_details: unknown;
};

const ALLOWED_REVIEW_DISPOSITIONS = new Set([
  "retry_after_pipeline_fix",
  "rescan_requested",
  "manual_review_required",
  "manual_overlay",
]);

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}

function safeReviewDisposition(value: unknown) {
  return typeof value === "string" && ALLOWED_REVIEW_DISPOSITIONS.has(value) ? value : null;
}

function safePageCount(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 200
    ? Number(value)
    : null;
}

function safeAttempts(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0
    ? Math.min(Number(value), 100)
    : 0;
}

function reviewData(contract: ContractRow, job: DocumentJobRow | null): ContractDocumentReviewData | null {
  const status = job?.status ?? contract.document_processing_status ?? "pending";
  const reviewDisposition = safeReviewDisposition(job?.review_disposition);
  const errorCode = reviewDisposition === "rescan_requested"
    ? "ocr_rescan_required"
    : sanitizeContractDocumentReviewErrorCode(
      job?.error_code ?? contract.document_processing_error_code,
    );
  if (status !== "needs_review" && status !== "failed") return null;

  const pageCount = safePageCount(job?.page_count);
  const reviewDetails = sanitizeContractDocumentReviewDetails(job?.review_details, pageCount);
  const matchingReason = reviewDetails.reasons.find(reason => reason.code === errorCode);
  const affectedPages = matchingReason?.pageNumbers
    ?? reviewDetails.reasons.flatMap(reason => reason.pageNumbers);
  const descriptor = contractDocumentReviewDescriptor(errorCode);
  const actions = contractDocumentReviewActions({
    status,
    errorCode,
    reviewDisposition,
    contractStatus: contract.status,
    hasRightsHolder: Boolean(contract.rights_holder_id),
    hasJob: Boolean(job),
  });

  return {
    status,
    errorCode,
    title: descriptor.title,
    reason: descriptor.reason,
    pageCount,
    affectedPages,
    affectedPagesText: affectedPagesText(affectedPages),
    attempts: safeAttempts(job?.attempts),
    reviewDisposition,
    recommendedAction: actions.recommendedAction,
    canRetry: actions.canRetry,
    canRequestRescan: actions.canRequestRescan,
  };
}

async function loadContractAndLatestJob(id: string, orgId: string) {
  const db = createServiceClient();
  const { data: contract, error: contractError } = await db
    .from("contracts")
    .select("id,org_id,rights_holder_id,status,document_processing_status,document_processing_error_code")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (contractError) throw new Error("contract_lookup_failed");
  if (!contract) return null;

  const { data: job, error: jobError } = await db
    .from("contract_document_jobs")
    .select("id,status,error_code,page_count,attempts,review_disposition,review_details")
    .eq("contract_id", id)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (jobError) throw new Error("document_job_lookup_failed");
  return {
    contract: contract as ContractRow,
    job: (job ?? null) as DocumentJobRow | null,
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffModuleApi("contracts", "read");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let loaded: Awaited<ReturnType<typeof loadContractAndLatestJob>>;
  try {
    loaded = await loadContractAndLatestJob(id, auth.orgId);
  } catch {
    return noStoreJson({ error: "PDF-status kunne ikke hentes." }, { status: 500 });
  }
  if (!loaded) return noStoreJson({ error: "Kontrakten blev ikke fundet." }, { status: 404 });

  await recordAuditEvent({
    context: auditRequestContext(request, auth, "admin", "admin.contracts.document-processing"),
    action: "read",
    entityType: "contracts",
    entityId: id,
    entityLabel: "PDF-behandlingsstatus",
    targetMemberUuid: loaded.contract.rights_holder_id,
    purposeCode: "contract_document_quality",
    legalBasis: "GDPR Art. 6(1)(c)/(f), Art. 9(2)(d)",
    dataCategories: ["contract_data"],
    orgIds: [auth.orgId],
    metadata: { hasDocumentJob: Boolean(loaded.job) },
  });

  return noStoreJson({ data: reviewData(loaded.contract, loaded.job) });
}

function isReviewAction(value: unknown): value is ContractDocumentReviewAction {
  return value === "retry" || value === "request_rescan";
}

function rpcErrorStatus(code: string | undefined) {
  if (code === "22023") return 400;
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "55000") return 409;
  return 500;
}

function conflictMessage(outcome: string) {
  if (outcome === "retry_manual_review_required") return "Dokumentet er markeret til manuel kontrol og kan ikke prøves automatisk igen.";
  if (outcome === "retry_limit_reached") return "Grænsen for automatiske genforsøg er nået. Dokumentet kræver manuel kontrol.";
  if (outcome === "retry_rescan_requested") return "Der er allerede markeret behov for en ny scanning.";
  return null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffModuleApi("contracts", "write");
  if (!auth.ok) return auth.response;
  if (!isSameOriginMutation(request)) {
    return noStoreJson({ error: "Anmodningen blev afvist af sikkerhedskontrollen." }, { status: 403 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  if (!isReviewAction(body?.action)) {
    return noStoreJson({ error: "Vælg en gyldig PDF-handling." }, { status: 400 });
  }

  let loaded: Awaited<ReturnType<typeof loadContractAndLatestJob>>;
  try {
    loaded = await loadContractAndLatestJob(id, auth.orgId);
  } catch {
    return noStoreJson({ error: "PDF-status kunne ikke kontrolleres." }, { status: 500 });
  }
  if (!loaded) return noStoreJson({ error: "Kontrakten blev ikke fundet." }, { status: 404 });

  const current = reviewData(loaded.contract, loaded.job);
  const allowed = body.action === "retry" ? current?.canRetry : current?.canRequestRescan;
  if (!allowed) {
    return noStoreJson({
      error: body.action === "retry"
        ? "PDF'en kan ikke prøves automatisk igen i sin nuværende tilstand."
        : "En ny scanning kan ikke markeres for denne kontrakt i sin nuværende tilstand.",
    }, { status: 409 });
  }

  // The service-only RPC applies the mutation and its semantic audit event in
  // the same database transaction. Do not emit a second route-level event:
  // that could leave false or duplicate history if the mutation is rejected.
  const db = createServiceClient({
    audit: {
      actorUserId: auth.userId,
      actorOrgId: auth.orgId,
      actorRole: auth.role,
      source: "admin",
      correlationId: crypto.randomUUID(),
      mode: "summary",
    },
  });
  const { data, error } = await db.rpc("admin_contract_document_review_action", {
    p_contract_id: id,
    p_org_id: auth.orgId,
    p_action: body.action,
    p_actor_user_id: auth.userId,
  });
  if (error) {
    const status = rpcErrorStatus(error.code);
    return noStoreJson({
      error: status === 409
        ? "PDF-status er ændret. Genåbn kontrakten og prøv igen."
        : status === 404
          ? "Kontrakten eller PDF-jobbet blev ikke fundet."
          : status === 403
            ? "Du har ikke adgang til denne PDF-handling."
            : "PDF-handlingen kunne ikke gennemføres.",
    }, { status });
  }

  const result = (Array.isArray(data) ? data[0] : data) as {
    outcome?: string;
    job_id?: string | null;
    review_disposition?: string | null;
  } | null;
  const outcome = result?.outcome ?? "";
  const conflict = conflictMessage(outcome);
  if (conflict) return noStoreJson({ error: conflict, outcome }, { status: 409 });
  if (body.action === "retry" && outcome !== "retry_queued" && outcome !== "retry_already_queued") {
    return noStoreJson({ error: "PDF'en kunne ikke sættes i kø til ny behandling." }, { status: 409 });
  }
  if (body.action === "request_rescan" && outcome !== "rescan_requested") {
    return noStoreJson({ error: "Behovet for en ny scanning kunne ikke registreres." }, { status: 409 });
  }

  return noStoreJson({
    accepted: true,
    outcome,
    status: body.action === "retry" ? "pending" : "needs_review",
    errorCode: body.action === "retry" ? null : "ocr_rescan_required",
  }, { status: body.action === "retry" ? 202 : 200 });
}
