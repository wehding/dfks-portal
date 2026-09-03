import "server-only";

import { extractWordText } from "@/lib/word-text";
import { createServiceClient } from "@/lib/supabase/service";
import { extractPdfText } from "@/lib/pdf-parse";
import { maskPersonalData } from "@/lib/mask-text";
import { runContractExtraction } from "@/lib/contract-extract-core";
import { attachmentChanges } from "@/lib/attachment-ai";
import { matchRightsHolder, matchSharedWork, type ContractMatchResult } from "@/lib/server/contract-import-matching";
import { resolveContractImportWork } from "@/lib/server/contract-import-work-resolver";
import { matchContractEmployers } from "@/lib/server/contract-import-employers";
import { CONTRACT_MATCH_VERSION, contractProductionTypeToWorkType, titleSimilarity } from "@/lib/contract-import";
import {
  CONTRACT_IMPORT_MAX_CONCURRENCY,
  CONTRACT_IMPORT_PROMPT_VERSION,
  CONTRACT_IMPORT_SCHEMA_VERSION,
  classifyContractImportFailure,
  type ContractImportJobStage,
} from "@/lib/contract-import-job";
import { resolveSeriesScopeTarget } from "@/lib/server/member-series-episode-scopes";
import { getAiRuntimeConfig } from "@/lib/ai-runtime";
import { getContractAiModel, type AiProvider } from "@/lib/ai-models";
import { recordAuditEvent } from "@/lib/audit-log-server";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type ContractJob = {
  id: string;
  contract_id: string;
  org_id: string;
  attempts: number;
  pdf_url: string | null;
  attachment_id: string | null;
  stage: ContractImportJobStage | null;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  schema_version: string | null;
  result_data: Record<string, unknown> | null;
  lease_expires_at: string | null;
  created_by: string | null;
  lease_token: string;
  input_storage_path: string;
};

function yearFromValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const match = String(value ?? "").match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function workTypeFromExtraction(value: unknown) {
  return contractProductionTypeToWorkType(value);
}

function uuidCandidates(candidates: Array<{ id: string }>) {
  return candidates.map(candidate => candidate.id).filter(id => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 10);
}

function assertDatabase(result: { error: { message: string } | null }, operation: string) {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
}

async function fileFromStoragePath(path: string) {
  const admin = createServiceClient();
  const { data, error } = await admin.storage.from("kontrakter").download(path);
  if (error || !data) throw new Error(`Kontraktfilen kunne ikke hentes: ${error?.message ?? "ukendt fejl"}`);
  const buffer = Buffer.from(await data.arrayBuffer());
  const ext = path.split(".").pop()?.toLowerCase();
  let text = "";
  if (ext === "pdf") text = await extractPdfText(buffer);
  else if (ext === "docx" || ext === "doc") text = await extractWordText(buffer, path);
  else text = buffer.toString("utf-8");
  return { buffer, ext, text };
}

async function setItemStage(admin: ServiceClient, job: ContractJob, status: "analysing" | "matching") {
  const result = await admin.rpc("set_contract_ai_import_item_stage_v2", {
    p_job_id: job.id,
    p_lease_token: job.lease_token,
    p_input_storage_path: job.input_storage_path,
    p_status: status,
  });
  assertDatabase(result, "Importstatus kunne ikke opdateres");
}

async function runtimeForJob(admin: ServiceClient, job: ContractJob) {
  const current = await getAiRuntimeConfig("contract_extraction");
  const storedProvider = job.provider;
  const storedModel = job.model;
  const stored = storedProvider && storedModel && getContractAiModel("contract_extraction", storedProvider, storedModel);
  const config = stored ? {
    useCase: "contract_extraction" as const,
    provider: storedProvider as AiProvider,
    model: storedModel,
    promptCachingEnabled: current.provider === storedProvider && current.model === storedModel ? current.promptCachingEnabled : false,
  } : current;
  const promptVersion = job.prompt_version ?? CONTRACT_IMPORT_PROMPT_VERSION;
  const schemaVersion = job.schema_version ?? CONTRACT_IMPORT_SCHEMA_VERSION;
  if (!stored || !job.prompt_version || !job.schema_version) {
    const updated = await admin.rpc("set_contract_ai_job_runtime_v2", {
      p_job_id: job.id,
      p_lease_token: job.lease_token,
      p_input_storage_path: job.input_storage_path,
      p_provider: config.provider,
      p_model: config.model,
      p_prompt_version: promptVersion,
      p_schema_version: schemaVersion,
    });
    assertDatabase(updated, "AI-konfigurationen kunne ikke fastlåses");
  }
  job.provider = config.provider;
  job.model = config.model;
  job.prompt_version = promptVersion;
  job.schema_version = schemaVersion;
  return { config, promptVersion, schemaVersion };
}

async function extractForJob(admin: ServiceClient, job: ContractJob) {
  if (job.result_data && job.stage !== "extraction") return job.result_data;
  if (!job.result_data && job.stage !== "extraction") {
    if (job.attachment_id) {
      const attachment = await admin.from("contract_attachments").select("ai_result").eq("id", job.attachment_id).maybeSingle();
      assertDatabase(attachment, "Allongens tidligere AI-resultat kunne ikke hentes");
      const aiResult = attachment.data?.ai_result && typeof attachment.data.ai_result === "object"
        ? attachment.data.ai_result as Record<string, unknown>
        : null;
      const previous = aiResult?.extracted && typeof aiResult.extracted === "object"
        ? aiResult.extracted as Record<string, unknown>
        : null;
      if (previous) return previous;
    } else {
      const validation = await admin.from("contract_validations").select("extracted_data").eq("contract_id", job.contract_id).maybeSingle();
      assertDatabase(validation, "Kontraktens tidligere AI-resultat kunne ikke hentes");
      if (validation.data?.extracted_data && typeof validation.data.extracted_data === "object") {
        return validation.data.extracted_data as Record<string, unknown>;
      }
    }
    throw new Error("Det gemte AI-resultat mangler; vælg genanalyse i stedet for nyt match");
  }
  if (!job.pdf_url) throw new Error("Kontrakten mangler filsti");
  await setItemStage(admin, job, "analysing");
  const file = await fileFromStoragePath(job.pdf_url);
  const maskedText = maskPersonalData(file.text);
  const runtime = await runtimeForJob(admin, job);
  const result = await runContractExtraction(maskedText, {
    orgId: job.org_id,
    entityId: job.contract_id,
    source: "cron",
    pdfBuffer: file.ext === "pdf" ? file.buffer : null,
    runtimeConfig: runtime.config,
    promptVersion: runtime.promptVersion,
    schemaVersion: runtime.schemaVersion,
    onProgress: async () => {
      const renewed = await admin.rpc("renew_contract_ai_job_lease_v2", {
        p_job_id: job.id,
        p_lease_token: job.lease_token,
        p_input_storage_path: job.input_storage_path,
      });
      assertDatabase(renewed, "AI-jobbets lease kunne ikke fornyes");
    },
  });
  if (!result.ok || !result.data) throw result.errorCause ?? new Error(result.error ?? "AI-aflæsning fejlede");
  const saved = await admin.rpc("save_contract_ai_extraction_v2", {
    p_job_id: job.id,
    p_lease_token: job.lease_token,
    p_input_storage_path: job.input_storage_path,
    p_result_data: result.data,
    p_provider_request_id: result.meta?.providerRequestId ?? null,
  });
  assertDatabase(saved, "AI-resultatet kunne ikke gemmes");
  job.stage = "matching";
  job.result_data = result.data;
  return result.data;
}

async function runAttachmentJob(admin: ServiceClient, job: ContractJob, extracted: Record<string, unknown>) {
  if (!job.attachment_id) throw new Error("Allongen mangler reference");
  const validation = await admin.from("contract_validations").select("extracted_data").eq("contract_id", job.contract_id).maybeSingle();
  assertDatabase(validation, "Moderkontraktens validering kunne ikke hentes");
  const changes = attachmentChanges(
    (validation.data?.extracted_data ?? {}) as Record<string, unknown>,
    extracted,
  );
  const attachment = await admin.rpc("apply_contract_attachment_extraction_v2", {
    p_job_id: job.id,
    p_lease_token: job.lease_token,
    p_input_storage_path: job.input_storage_path,
    p_ai_result: {
      extracted: changes.extracted,
      changes: changes.changes,
      analyzedAt: new Date().toISOString(),
      includedInPayments: false,
    },
  });
  assertDatabase(attachment, "Allongeresultatet kunne ikke gemmes");
}

function mergeLockedFields(extracted: Record<string, unknown>, previous: unknown) {
  const merged = { ...extracted };
  if (!previous || typeof previous !== "object") return merged;
  const old = previous as Record<string, unknown>;
  const lockedFields = Array.isArray(old._lockedFields) ? old._lockedFields.filter(item => typeof item === "string") as string[] : [];
  for (const key of lockedFields) {
    if (key.startsWith("rightsOverview.")) {
      const subKey = key.split(".")[1];
      const oldOverview = old.rightsOverview && typeof old.rightsOverview === "object" ? old.rightsOverview as Record<string, unknown> : {};
      const newOverview = merged.rightsOverview && typeof merged.rightsOverview === "object" ? merged.rightsOverview as Record<string, unknown> : {};
      merged.rightsOverview = { ...newOverview, [subKey]: oldOverview[subKey] };
    } else if (key in old) {
      merged[key] = old[key];
    }
  }
  if (lockedFields.length) merged._lockedFields = lockedFields;
  return merged;
}

async function possibleDuplicate(admin: ServiceClient, input: {
  orgId: string;
  contractId: string;
  title: string | null;
  contractDate: string | null;
  rightsHolderId: string | null;
  workId: string | null;
}) {
  if (!input.title) return null;
  const result = await admin.rpc("search_contract_duplicate_candidates", {
    p_org_id: input.orgId,
    p_contract_id: input.contractId,
    p_title: input.title,
    p_limit: 100,
  });
  assertDatabase(result, "Dubletkontrollen kunne ikke gennemføres");
  const candidates = (result.data ?? []) as Array<{
    id: string;
    working_title: string | null;
    contract_date: string | null;
    rights_holder_id: string | null;
    work_id: string | null;
  }>;
  const ranked = candidates.map(candidate => {
    let score = titleSimilarity(input.title, candidate.working_title) === 1 ? 70 : 0;
    const evidence: Array<{ signal: string; points: number }> = score ? [{ signal: "same_normalized_title", points: 70 }] : [];
    if (input.contractDate && candidate.contract_date === input.contractDate) { score += 20; evidence.push({ signal: "same_contract_date", points: 20 }); }
    if (input.rightsHolderId && candidate.rights_holder_id === input.rightsHolderId) { score += 20; evidence.push({ signal: "same_rights_holder", points: 20 }); }
    if (input.workId && candidate.work_id === input.workId) { score += 30; evidence.push({ signal: "same_work", points: 30 }); }
    return { id: candidate.id, score: Math.min(100, score), evidence };
  }).sort((left, right) => right.score - left.score);
  return ranked[0]?.score >= 90 ? ranked[0] : null;
}

async function applyContractExtraction(admin: ServiceClient, job: ContractJob, extracted: Record<string, unknown>) {
  await setItemStage(admin, job, "matching");
  const contract = await admin.from("contracts")
    .select("rights_holder_id,work_id,working_title,employer_id,contract_date")
    .eq("id", job.contract_id).maybeSingle();
  assertDatabase(contract, "Kontrakten kunne ikke hentes");
  if (!contract.data) throw new Error("Kontrakten blev ikke fundet");
  const existing = contract.data;
  const extractedTitle = String(extracted.workTitle ?? extracted.title ?? "").trim() || null;
  const extractedYear = yearFromValue(extracted.premiereYear ?? extracted.productionYear ?? extracted.year ?? extracted.premiereDate ?? extracted.contractDate);
  const timingDate = [extracted.contractDate, extracted.startDate, extracted.endDate].find(value => typeof value === "string" && value.trim()) as string | undefined;
  const type = workTypeFromExtraction(extracted.productionType ?? extracted.workType);

  let workMatch: ContractMatchResult = existing.work_id
    ? { id: existing.work_id, score: 100, evidence: [{ signal: "existing_manual_link", points: 100 }], version: CONTRACT_MATCH_VERSION, candidates: [] }
    : await matchSharedWork(admin, { title: extractedTitle, premiereYear: extractedYear, contractDate: timingDate, type });
  let workId: string | null = existing.work_id ?? workMatch.id;
  let ownerMatch = await matchRightsHolder(admin, {
    orgId: job.org_id,
    name: extracted.rightsHolderName ? String(extracted.rightsHolderName) : null,
    workId,
  });
  // AI matching is evidence, never authority. Only the already assigned owner
  // may influence contract/work relations until an administrator uses the
  // revision-checked ownership review RPC.
  const rightsHolderId: string | null = existing.rights_holder_id;
  let ownerCandidateId: string | null = ownerMatch.id;

  if (!workId) {
    workMatch = await resolveContractImportWork(admin, {
      orgId: job.org_id,
      title: extractedTitle,
      year: extractedYear,
      contractDate: timingDate,
      type,
      rightsHolderId: rightsHolderId ?? ownerCandidateId,
      allowExternalCreate: true,
    });
    workId = workMatch.id;
  }

  // Et værk fundet via de eksterne kilder kan være det signal, der gør et
  // alternativt krediteringsnavn sikkert nok. Kør derfor ejermatchet én gang
  // mere med værkrelationen, men kun når første forsøg ikke valgte en ejer.
  if (!ownerCandidateId && workId) {
    ownerMatch = await matchRightsHolder(admin, {
      orgId: job.org_id,
      name: extracted.rightsHolderName ? String(extracted.rightsHolderName) : null,
      workId,
    });
    ownerCandidateId = ownerMatch.id;
  }

  let employerMatches: Awaited<ReturnType<typeof matchContractEmployers>> = { matches: [], candidates: [] };
  if (!existing.employer_id) {
    const names = [extracted.employerName, extracted.parentCompanyName]
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
    employerMatches = await matchContractEmployers(admin, names);
  }

  const previousValidation = await admin.from("contract_validations")
    .select("extracted_data").eq("contract_id", job.contract_id).maybeSingle();
  assertDatabase(previousValidation, "Tidligere kontraktdata kunne ikke hentes");
  const merged = mergeLockedFields(extracted, previousValidation.data?.extracted_data);
  const locked = new Set(Array.isArray(merged._lockedFields) ? merged._lockedFields as string[] : []);
  let series: { seriesWorkId: string; seasonNumber: number } | null = null;
  if (rightsHolderId && workId) {
    const season = Math.max(1, Math.floor(Number(merged.seasonNumber ?? merged.season ?? 1) || 1));
    const target = await resolveSeriesScopeTarget(admin, workId, season);
    if (target) series = target;
  }

  const duplicate = await possibleDuplicate(admin, {
    orgId: job.org_id,
    contractId: job.contract_id,
    title: extractedTitle,
    contractDate: typeof merged.contractDate === "string" ? merged.contractDate : null,
    rightsHolderId,
    workId,
  });
  const itemStatus = duplicate ? "possible_duplicate"
    : !rightsHolderId ? "missing_owner"
      : !workId ? "missing_work"
        : "ready_for_review";

  const applied = await admin.rpc("apply_contract_ai_extraction_v2", {
    p_job_id: job.id,
    p_lease_token: job.lease_token,
    p_input_storage_path: job.input_storage_path,
    p_payload: {
      extractedData: merged,
      validation: {
        holidayPayRate: merged.holidayPayRate ?? null,
        betaRate: merged.betaRate ?? null,
        hasCreditClause: Boolean(merged.hasCreditClause || merged.creditedRoles || merged.creditedFunction),
        hasTerminationClause: Boolean(merged.hasTerminationClause),
        terminationDaysEditor: merged.terminationDaysEditor ?? null,
        terminationDaysProducer: merged.terminationDaysProducer ?? null,
        hasIndemnification: Boolean(merged.hasIndemnification),
        hasOverenskomstIncorporation: Boolean(merged.hasOverenskomstIncorporation || merged.collectiveAgreement),
      },
      contract: {
        applyType: !locked.has("contractType"),
        type: merged.contractType ?? "a-løn",
        applyOverenskomst: !locked.has("overenskomst"),
        overenskomst: merged.overenskomst === "ingen" ? null : (merged.overenskomst ?? null),
        applyWorkingTitle: !locked.has("workTitle"),
        workingTitle: extractedTitle ?? existing.working_title ?? null,
        applyContractDate: !locked.has("contractDate"),
        contractDate: merged.contractDate ?? null,
        applyStartDate: !locked.has("startDate"),
        startDate: merged.startDate ?? null,
        applyEndDate: !locked.has("endDate"),
        endDate: merged.endDate ?? null,
        rightsHolderId: null,
        ownerSuggestionId: ownerCandidateId,
        workId,
        employerId: !existing.employer_id ? employerMatches.matches[0]?.id ?? null : null,
      },
      employerIds: !existing.employer_id ? employerMatches.matches.map(match => match.id) : [],
      series,
      import: {
        status: itemStatus,
        ownerMatchScore: ownerMatch.score,
        workMatchScore: workMatch.score,
        producerMatchScore: employerMatches.matches[0]?.score ?? employerMatches.candidates[0]?.score ?? null,
        ownerMatchEvidence: ownerMatch.evidence,
        workMatchEvidence: workMatch.evidence,
        producerMatchEvidence: employerMatches.matches.flatMap(match => match.evidence),
        ownerCandidateIds: uuidCandidates(ownerMatch.candidates),
        workCandidateIds: uuidCandidates(workMatch.candidates),
        producerCandidateIds: employerMatches.candidates.map(candidate => candidate.id),
        possibleDuplicateOf: duplicate?.id ?? null,
        duplicateEvidence: duplicate?.evidence ?? [],
        matchVersion: CONTRACT_MATCH_VERSION,
      },
    },
  });
  assertDatabase(applied, "Kontraktens udtræksdata kunne ikke gemmes atomisk");
}

export async function runContractJob(admin: ServiceClient, job: ContractJob) {
  const extracted = await extractForJob(admin, job);
  if (job.attachment_id) await runAttachmentJob(admin, job, extracted);
  else await applyContractExtraction(admin, job, extracted);
  await recordAuditEvent({
    context: {
      actorUserId: job.created_by,
      actorOrgId: job.org_id,
      source: "import",
      correlationId: job.id,
      mode: "summary",
    },
    action: "ai_analysis",
    entityType: job.attachment_id ? "contract_attachments" : "contracts",
    entityId: job.attachment_id ?? job.contract_id,
    entityLabel: job.attachment_id ? "AI-aflæsning af allonge" : "AI-aflæsning og match af kontrakt",
    targetMemberUuid: (await admin.from("contracts").select("rights_holder_id").eq("id", job.contract_id).maybeSingle()).data?.rights_holder_id ?? null,
    purposeCode: "contract_analysis",
    legalBasis: "GDPR Art. 6(1)(b) og 9(2)(d)",
    dataCategories: ["contract_data", "salary_data", "ai_analysis"],
    orgIds: [job.org_id],
    metadata: {
      outcome: "completed",
      provider: job.provider,
      model: job.model,
      promptVersion: job.prompt_version,
      schemaVersion: job.schema_version,
    },
  });
  const finalized = await admin.rpc("finalize_contract_ai_job_v2", {
    p_job_id: job.id,
    p_lease_token: job.lease_token,
    p_input_storage_path: job.input_storage_path,
  });
  assertDatabase(finalized, "AI-jobbet kunne ikke afsluttes");
  return { jobId: job.id, contractId: job.contract_id, attachmentId: job.attachment_id };
}

async function failContractJob(admin: ServiceClient, job: ContractJob, error: unknown) {
  const decision = classifyContractImportFailure(error, job.attempts);
  const failed = await admin.rpc("fail_contract_ai_job_v2", {
    p_job_id: job.id,
    p_lease_token: job.lease_token,
    p_input_storage_path: job.input_storage_path,
    p_status: decision.status,
    p_failure_class: decision.failureClass,
    p_error_code: decision.errorCode,
    p_error_message: decision.safeMessage,
    p_next_attempt_at: decision.nextAttemptAt,
    p_refund_attempt: decision.refundAttempt,
  });
  assertDatabase(failed, "Jobfejlen kunne ikke registreres");
  // A false result means OCR (or a newer worker generation) superseded this
  // worker. Never let the stale worker write import-item/attachment errors.
  if (failed.data !== true) return decision;
  const item = await admin.from("contract_import_items").update({
    status: decision.itemStatus,
    error_code: decision.errorCode,
    error_message: decision.safeMessage,
    attempts: decision.refundAttempt ? Math.max(0, job.attempts - 1) : job.attempts,
    next_attempt_at: decision.nextAttemptAt ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("ai_job_id", job.id);
  assertDatabase(item, "Importfejlen kunne ikke registreres");
  if (job.attachment_id) {
    const attachment = await admin.from("contract_attachments").update({
      ai_status: "fejl",
      ai_result: { errorCode: decision.errorCode, error: decision.safeMessage },
    }).eq("id", job.attachment_id);
    assertDatabase(attachment, "Allongefejlen kunne ikke registreres");
  }
  return decision;
}

export async function claimContractJob(admin: ServiceClient, input: { jobId?: string | null; orgId?: string | null } = {}) {
  const result = await admin.rpc("claim_next_contract_ai_job", {
    p_job_id: input.jobId ?? null,
    p_org_id: input.orgId ?? null,
  });
  assertDatabase(result, "Kontraktkøen kunne ikke læses");
  return (result.data?.[0] ?? null) as ContractJob | null;
}

const MAX_JOBS_PER_RUN = 10;
const RUN_TIME_BUDGET_MS = 50_000;

export async function processPendingContractJobs(orgId?: string | null) {
  const admin = createServiceClient({ audit: { actorOrgId: orgId, source: "import", mode: "summary" } });
  const deadline = Date.now() + RUN_TIME_BUDGET_MS;
  const processedContractIds: string[] = [];
  const errors: Array<{ jobId: string; errorCode: string; retrying: boolean }> = [];

  while (processedContractIds.length + errors.length < MAX_JOBS_PER_RUN && Date.now() < deadline) {
    const remaining = Math.min(CONTRACT_IMPORT_MAX_CONCURRENCY, MAX_JOBS_PER_RUN - processedContractIds.length - errors.length);
    const claimed: ContractJob[] = [];
    for (let index = 0; index < remaining; index += 1) {
      const job = await claimContractJob(admin, { orgId });
      if (!job) break;
      claimed.push(job);
    }
    if (!claimed.length) break;
    await Promise.all(claimed.map(async job => {
      const jobAdmin = createServiceClient({ audit: {
        actorUserId: job.created_by,
        actorOrgId: job.org_id,
        source: "import",
        correlationId: job.id,
        mode: "summary",
      } });
      try {
        await runContractJob(jobAdmin, job);
        processedContractIds.push(job.contract_id);
      } catch (error) {
        const decision = await failContractJob(jobAdmin, job, error);
        errors.push({ jobId: job.id, errorCode: decision.errorCode, retrying: decision.status === "retry_wait" });
      }
    }));
  }

  const due = await admin.from("contract_ai_jobs").select("id", { count: "exact", head: true })
    .in("status", ["queued", "retry_wait", "error"])
    .lte("next_attempt_at", new Date().toISOString());
  assertDatabase(due, "Køstatus kunne ikke hentes");
  return {
    ok: true,
    processed: processedContractIds.length,
    processedContractIds,
    errors,
    hasMore: Number(due.count ?? 0) > 0,
  };
}

export async function runDirectContractJob(input: { contractId: string; orgId?: string | null; actorUserId?: string | null }) {
  const admin = createServiceClient({ audit: { actorUserId: input.actorUserId, actorOrgId: input.orgId, source: "admin", correlationId: crypto.randomUUID(), mode: "summary" } });
  let query = admin.from("contracts").select("id,org_id,pdf_url,processed_pdf_url,document_processing_status").eq("id", input.contractId);
  if (input.orgId) query = query.eq("org_id", input.orgId);
  const contract = await query.maybeSingle();
  assertDatabase(contract, "Kontrakten kunne ikke hentes");
  if (!contract.data) throw new Error("Kontrakten blev ikke fundet");
  if (["pdf", "doc", "docx"].includes(contract.data.pdf_url?.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "")
    && !["ready", "not_required"].includes(contract.data.document_processing_status)) {
    throw new Error("PDF'en skal færdigbehandles, før AI-aflæsningen kan startes");
  }
  const runtime = await getAiRuntimeConfig("contract_extraction");
  const inserted = await admin.from("contract_ai_jobs").insert({
    contract_id: contract.data.id,
    org_id: contract.data.org_id,
    created_by: input.actorUserId ?? null,
    status: "queued",
    stage: "extraction",
    priority: 0,
    provider: runtime.provider,
    model: runtime.model,
    prompt_version: CONTRACT_IMPORT_PROMPT_VERSION,
    schema_version: CONTRACT_IMPORT_SCHEMA_VERSION,
    next_attempt_at: new Date().toISOString(),
  }).select("id").single();
  assertDatabase(inserted, "Det indhegnede AI-job kunne ikke oprettes");
  if (!inserted.data?.id) throw new Error("Det indhegnede AI-job mangler id");
  const processed = await processSpecificContractJob({ jobId: inserted.data.id, orgId: contract.data.org_id });
  if (!processed.ok || !processed.processed) {
    throw new Error(processed.error ?? "AI-jobbet kunne ikke behandles");
  }
  return {
    jobId: processed.jobId,
    contractId: processed.contractId,
    attachmentId: processed.attachmentId,
  };
}

export async function processSpecificContractJob(input: { jobId: string; orgId?: string | null }) {
  const admin = createServiceClient();
  const job = await claimContractJob(admin, input);
  if (!job) return { ok: true, processed: false as const };
  const jobAdmin = createServiceClient({ audit: {
    actorUserId: job.created_by,
    actorOrgId: job.org_id,
    source: "import",
    correlationId: job.id,
    mode: "summary",
  } });
  try {
    const result = await runContractJob(jobAdmin, job);
    return { ok: true, processed: true as const, ...result };
  } catch (error) {
    const decision = await failContractJob(jobAdmin, job, error);
    return { ok: false, processed: false as const, error: decision.safeMessage, errorCode: decision.errorCode };
  }
}
