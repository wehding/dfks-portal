import "server-only";

import { extractWordText } from "@/lib/word-text";
import { createServiceClient } from "@/lib/supabase/service";
import { extractPdfText } from "@/lib/pdf-parse";
import { maskPersonalData } from "@/lib/mask-text";
import { runContractExtraction } from "@/lib/contract-extract-core";
import { attachmentChanges } from "@/lib/attachment-ai";
import { matchRightsHolder, matchSharedWork, type ContractMatchResult } from "@/lib/server/contract-import-matching";
import { resolveContractImportWork } from "@/lib/server/contract-import-work-resolver";
import { attachContractEmployers, matchContractEmployers } from "@/lib/server/contract-import-employers";
import { CONTRACT_MATCH_VERSION, contractProductionTypeToWorkType, titleSimilarity } from "@/lib/contract-import";
import {
  CONTRACT_IMPORT_MAX_CONCURRENCY,
  CONTRACT_IMPORT_PROMPT_VERSION,
  CONTRACT_IMPORT_SCHEMA_VERSION,
  classifyContractImportFailure,
  type ContractImportJobStage,
} from "@/lib/contract-import-job";
import { resolveSeriesScopeTarget, upsertMemberSeriesEpisodeScope } from "@/lib/server/member-series-episode-scopes";
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
};

type DirectContractJob = ContractJob & { id: "__direct__" };

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

async function setItemStage(admin: ServiceClient, jobId: string, status: "analysing" | "matching") {
  if (jobId === "__direct__") return;
  const result = await admin.from("contract_import_items").update({ status, updated_at: new Date().toISOString() }).eq("ai_job_id", jobId);
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
  if (job.id !== "__direct__" && (!stored || !job.prompt_version || !job.schema_version)) {
    const updated = await admin.from("contract_ai_jobs").update({
      provider: config.provider,
      model: config.model,
      prompt_version: promptVersion,
      schema_version: schemaVersion,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id).eq("status", "processing");
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
  await setItemStage(admin, job.id, "analysing");
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
    onProgress: job.id === "__direct__" ? null : async () => {
      const renewed = await admin.rpc("renew_contract_ai_job_lease", { p_job_id: job.id });
      assertDatabase(renewed, "AI-jobbets lease kunne ikke fornyes");
    },
  });
  if (!result.ok || !result.data) throw result.errorCause ?? new Error(result.error ?? "AI-aflæsning fejlede");
  if (job.id !== "__direct__") {
    const saved = await admin.rpc("save_contract_ai_extraction", {
      p_job_id: job.id,
      p_result_data: result.data,
      p_provider_request_id: result.meta?.providerRequestId ?? null,
    });
    assertDatabase(saved, "AI-resultatet kunne ikke gemmes");
    job.stage = "matching";
    job.result_data = result.data;
  }
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
  const attachment = await admin.from("contract_attachments").update({
    ai_status: "klar",
    ai_result: { extracted: changes.extracted, changes: changes.changes, analyzedAt: new Date().toISOString(), includedInPayments: false },
  }).eq("id", job.attachment_id);
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
  await setItemStage(admin, job.id, "matching");
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
  let ownerMatch = existing.rights_holder_id
    ? { id: existing.rights_holder_id, score: 100, evidence: [{ signal: "existing_manual_link", points: 100 }], version: CONTRACT_MATCH_VERSION, candidates: [] }
    : await matchRightsHolder(admin, {
      orgId: job.org_id,
      name: extracted.rightsHolderName ? String(extracted.rightsHolderName) : null,
      workId,
    });
  let rightsHolderId: string | null = existing.rights_holder_id ?? ownerMatch.id;

  if (!workId) {
    workMatch = await resolveContractImportWork(admin, {
      orgId: job.org_id,
      title: extractedTitle,
      year: extractedYear,
      contractDate: timingDate,
      type,
      rightsHolderId,
      allowExternalCreate: true,
    });
    workId = workMatch.id;
  }

  // Et værk fundet via de eksterne kilder kan være det signal, der gør et
  // alternativt krediteringsnavn sikkert nok. Kør derfor ejermatchet én gang
  // mere med værkrelationen, men kun når første forsøg ikke valgte en ejer.
  if (!rightsHolderId && workId) {
    ownerMatch = await matchRightsHolder(admin, {
      orgId: job.org_id,
      name: extracted.rightsHolderName ? String(extracted.rightsHolderName) : null,
      workId,
    });
    rightsHolderId = ownerMatch.id;
  }

  let employerMatches: Awaited<ReturnType<typeof matchContractEmployers>> = { matches: [], candidates: [] };
  if (!existing.employer_id) {
    const names = [extracted.employerName, extracted.parentCompanyName]
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
    employerMatches = await matchContractEmployers(admin, names);
    await attachContractEmployers(admin, { contractId: job.contract_id, matches: employerMatches.matches });
  }

  const previousValidation = await admin.from("contract_validations")
    .select("extracted_data").eq("contract_id", job.contract_id).maybeSingle();
  assertDatabase(previousValidation, "Tidligere kontraktdata kunne ikke hentes");
  const merged = mergeLockedFields(extracted, previousValidation.data?.extracted_data);
  const validation = await admin.from("contract_validations").upsert({
    contract_id: job.contract_id,
    org_id: job.org_id,
    holiday_pay_rate: merged.holidayPayRate ?? null,
    beta_rate: merged.betaRate ?? null,
    has_credit_clause: Boolean(merged.hasCreditClause || merged.creditedRoles || merged.creditedFunction),
    has_termination_clause: Boolean(merged.hasTerminationClause),
    termination_days_editor: merged.terminationDaysEditor ?? null,
    termination_days_producer: merged.terminationDaysProducer ?? null,
    has_indemnification: Boolean(merged.hasIndemnification),
    has_overenskomst_incorporation: Boolean(merged.hasOverenskomstIncorporation || merged.collectiveAgreement),
    extracted_data: merged,
  }, { onConflict: "contract_id" });
  assertDatabase(validation, "Kontraktens udtræksdata kunne ikke gemmes");

  const locked = new Set(Array.isArray(merged._lockedFields) ? merged._lockedFields as string[] : []);
  const updates: Record<string, unknown> = { status: "kladde" };
  if (!locked.has("contractType")) updates.type = merged.contractType ?? "a-løn";
  if (!locked.has("overenskomst")) updates.overenskomst = merged.overenskomst === "ingen" ? null : (merged.overenskomst ?? null);
  if (!locked.has("workTitle")) updates.working_title = extractedTitle ?? existing.working_title ?? null;
  if (!locked.has("contractDate")) updates.contract_date = merged.contractDate ?? null;
  if (!locked.has("startDate")) updates.start_date = merged.startDate ?? null;
  if (!locked.has("endDate")) updates.end_date = merged.endDate ?? null;
  if (rightsHolderId) updates.rights_holder_id = rightsHolderId;
  if (workId) updates.work_id = workId;
  if (!existing.employer_id && employerMatches.matches[0]) updates.employer_id = employerMatches.matches[0].id;
  const contractUpdate = await admin.from("contracts").update(updates).eq("id", job.contract_id);
  assertDatabase(contractUpdate, "Kontrakten kunne ikke opdateres");

  let seriesPending = false;
  if (rightsHolderId && workId) {
    const season = Math.max(1, Math.floor(Number(merged.seasonNumber ?? merged.season ?? 1) || 1));
    const target = await resolveSeriesScopeTarget(admin, workId, season);
    if (target) {
      const scopeResult = await upsertMemberSeriesEpisodeScope(admin, {
        orgId: job.org_id,
        rightsHolderId,
        seriesWorkId: target.seriesWorkId,
        seasonNumber: target.seasonNumber,
        status: "pending",
        source: "contract_upload",
      });
      if (!scopeResult.success) throw new Error(scopeResult.error);
      const scopeUpdate = await admin.from("contracts").update({
        episode_scope_id: scopeResult.scope.id,
        season_number: scopeResult.scope.season_number,
        episode_numbers: scopeResult.scope.status === "confirmed"
          ? scopeResult.scope.covers_whole_season ? [] : scopeResult.scope.episode_numbers
          : null,
      }).eq("id", job.contract_id);
      assertDatabase(scopeUpdate, "Afsnitsopgaven kunne ikke gemmes");
      seriesPending = scopeResult.scope.status !== "confirmed";
    }
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
        : seriesPending ? "awaiting_episode_confirmation" : "ready_for_review";

  if (job.id !== "__direct__") {
    const item = await admin.from("contract_import_items").update({
      status: itemStatus,
      owner_match_score: ownerMatch.score,
      work_match_score: workMatch.score,
      producer_match_score: employerMatches.matches[0]?.score ?? employerMatches.candidates[0]?.score ?? null,
      owner_match_evidence: ownerMatch.evidence,
      work_match_evidence: workMatch.evidence,
      producer_match_evidence: employerMatches.matches.flatMap(match => match.evidence),
      owner_candidate_ids: uuidCandidates(ownerMatch.candidates),
      work_candidate_ids: uuidCandidates(workMatch.candidates),
      producer_candidate_ids: employerMatches.candidates.map(candidate => candidate.id),
      possible_duplicate_of: duplicate?.id ?? null,
      duplicate_evidence: duplicate?.evidence ?? [],
      match_version: CONTRACT_MATCH_VERSION,
      error_code: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    }).eq("ai_job_id", job.id);
    assertDatabase(item, "Importresultatet kunne ikke gemmes");
  }
}

export async function runContractJob(admin: ServiceClient, job: ContractJob) {
  const extracted = await extractForJob(admin, job);
  if (job.attachment_id) await runAttachmentJob(admin, job, extracted);
  else await applyContractExtraction(admin, job, extracted);
  if (job.id !== "__direct__") {
    const advanced = await admin.rpc("advance_contract_ai_job", { p_job_id: job.id, p_stage: "finalizing" });
    assertDatabase(advanced, "AI-jobbet kunne ikke færdiggøres");
  }
  await recordAuditEvent({
    context: {
      actorUserId: job.created_by,
      actorOrgId: job.org_id,
      source: job.id === "__direct__" ? "admin" : "import",
      correlationId: job.id === "__direct__" ? crypto.randomUUID() : job.id,
      mode: "summary",
    },
    action: "job",
    entityType: job.attachment_id ? "contract_attachments" : "contracts",
    entityId: job.attachment_id ?? job.contract_id,
    entityLabel: job.attachment_id ? "AI-aflæsning af allonge" : "AI-aflæsning og match af kontrakt",
    orgIds: [job.org_id],
    metadata: {
      outcome: "completed",
      provider: job.provider,
      model: job.model,
      promptVersion: job.prompt_version,
      schemaVersion: job.schema_version,
    },
  });
  if (job.id !== "__direct__") {
    const finalized = await admin.rpc("finalize_contract_ai_job", { p_job_id: job.id });
    assertDatabase(finalized, "AI-jobbet kunne ikke afsluttes");
  }
  return { jobId: job.id, contractId: job.contract_id, attachmentId: job.attachment_id };
}

async function failContractJob(admin: ServiceClient, job: ContractJob, error: unknown) {
  if (job.id === "__direct__") throw error;
  const decision = classifyContractImportFailure(error, job.attempts);
  const failed = await admin.rpc("fail_contract_ai_job", {
    p_job_id: job.id,
    p_status: decision.status,
    p_failure_class: decision.failureClass,
    p_error_code: decision.errorCode,
    p_error_message: decision.safeMessage,
    p_next_attempt_at: decision.nextAttemptAt,
    p_refund_attempt: decision.refundAttempt,
  });
  assertDatabase(failed, "Jobfejlen kunne ikke registreres");
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
  let query = admin.from("contracts").select("id,org_id,pdf_url").eq("id", input.contractId);
  if (input.orgId) query = query.eq("org_id", input.orgId);
  const contract = await query.maybeSingle();
  assertDatabase(contract, "Kontrakten kunne ikke hentes");
  if (!contract.data) throw new Error("Kontrakten blev ikke fundet");
  return runContractJob(admin, {
    id: "__direct__",
    contract_id: contract.data.id,
    org_id: contract.data.org_id,
    attempts: 0,
    pdf_url: contract.data.pdf_url,
    attachment_id: null,
    stage: "extraction",
    provider: null,
    model: null,
    prompt_version: CONTRACT_IMPORT_PROMPT_VERSION,
    schema_version: CONTRACT_IMPORT_SCHEMA_VERSION,
    result_data: null,
    lease_expires_at: null,
    created_by: input.actorUserId ?? null,
  } satisfies DirectContractJob);
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
