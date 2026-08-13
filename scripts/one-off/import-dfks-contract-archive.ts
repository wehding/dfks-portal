import "dotenv/config";

import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { extractPdfText } from "@/lib/pdf-parse";
import { extractWordText } from "@/lib/word-text";
import {
  downloadProviderFile,
  exportGoogleSpreadsheet,
  listProviderFiles,
  type ProviderFile,
} from "@/lib/server/import-provider-files";
import { intakeContractFile } from "@/lib/server/contract-import-intake";
import {
  applySpreadsheetFallback,
  archiveImportFileName,
  buildSearchableJpegPdf,
  detectDevelopmentContract,
  extractLocalContactData,
  groupJpegArchivePages,
  isJpegArchivePage,
  isObviousNonContract,
  isSupportedArchiveContract,
  jpegGroupContentIsConsistent,
  matchArchiveRows,
  normalizeArchiveCredit,
  normalizeArchiveDate,
  parseArchiveSpreadsheet,
  type ArchiveDriveFile,
  type ArchiveFileSignals,
  type ArchiveSpreadsheetRow,
} from "@/lib/one-off/contract-archive-import";
import { ocrArchiveJpegPagesLocally } from "@/lib/one-off/local-contract-ocr";
import { chooseArchiveIdentity, resolveArchiveRightsHolder, safeIdentitySummary } from "@/lib/one-off/contract-archive-rights-holders";
import { resolveArchiveWork } from "@/lib/one-off/contract-archive-works";
import { attachArchiveEmployers, matchArchiveEmployers } from "@/lib/one-off/contract-archive-employers";
import { extractedProductionCompanyNames } from "@/lib/production-companies";

type Mode = "dry-run" | "execute" | "resume" | "report";
type Options = {
  mode: Mode;
  orgId: string;
  actorUserId: string;
  connectionId: string;
  folderId: string;
  spreadsheetId: string;
  batchId: string | null;
  limit: number | null;
  reportPath: string;
};
type ImportUnit = {
  id: string;
  name: string;
  revision: string;
  files: ProviderFile[];
  contentType: string | null;
  kind: "file" | "jpeg_group";
};
type SafeItemReport = {
  reference: string;
  fileName: string;
  status: string;
  contractId?: string | null;
  spreadsheetRow?: number | null;
  owner?: ReturnType<typeof safeIdentitySummary>;
  work?: { id: string | null; score: number | null; created: boolean; source: string };
  error?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseArchiveImportOptions(argv: string[]): Options {
  const values = new Map<string, string>();
  let mode: Mode = "dry-run";
  for (const argument of argv) {
    if (["dry-run", "execute", "resume", "report"].includes(argument)) mode = argument as Mode;
    else if (argument.startsWith("--")) {
      const [key, ...rest] = argument.slice(2).split("=");
      values.set(key, rest.join("="));
    }
  }
  const required = (key: string) => {
    const value = values.get(key)?.trim();
    if (!value) throw new Error(`Parameteren --${key}=... mangler`);
    return value;
  };
  const orgId = required("org-id");
  const actorUserId = required("actor-user-id");
  const connectionId = required("connection-id");
  if (![orgId, actorUserId, connectionId].every(value => UUID.test(value))) throw new Error("Organisation, aktør og forbindelse skal være gyldige UUID'er");
  const batchId = values.get("batch-id")?.trim() || null;
  if (batchId && !UUID.test(batchId)) throw new Error("--batch-id er ugyldig");
  if ((mode === "resume" || mode === "report") && !batchId) throw new Error(`${mode} kræver --batch-id`);
  const rawLimit = values.get("limit");
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : null;
  if (limit != null && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit skal være et positivt heltal");
  return {
    mode, orgId, actorUserId, connectionId, batchId, limit,
    folderId: mode === "report" ? values.get("folder-id")?.trim() || "unused" : required("folder-id"),
    spreadsheetId: mode === "report" ? values.get("spreadsheet-id")?.trim() || "unused" : required("spreadsheet-id"),
    reportPath: path.resolve(values.get("report-path")?.trim() || `tmp/contract-archive-${mode}-${Date.now()}.json`),
  };
}

function safeReference(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Ukendt fejl")
    .replace(/https?:\/\/\S+/gi, "[link skjult]")
    .replace(/[A-Za-z0-9_-]{30,}/g, "[reference skjult]")
    .slice(0, 500);
}

async function saveReport(reportPath: string, report: Record<string, unknown>) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await chmod(reportPath, 0o600);
}

function toArchiveFile(file: ProviderFile): ArchiveDriveFile {
  return { id: file.id, name: file.name, revision: file.revision, size: file.size, contentType: file.contentType, parentId: file.parentId };
}

export function buildArchiveImportUnits(files: ProviderFile[]): { units: ImportUnit[]; excluded: ProviderFile[] } {
  const jpegs = files.filter(file => isJpegArchivePage(toArchiveFile(file)));
  const groupedIds = new Set(jpegs.map(file => file.id));
  const groups: ImportUnit[] = groupJpegArchivePages(jpegs.map(toArchiveFile)).map(group => ({
    id: `jpeg:${group.key}`,
    name: `${group.pages[0].name.replace(/\.jpe?g$/i, "").replace(/[\s_.-]*(?:side|page|scan)?\s*\d+$/i, "")}.pdf`,
    revision: group.pages.map(page => page.revision).join(":"),
    files: group.pages as ProviderFile[], contentType: "application/pdf", kind: "jpeg_group",
  }));
  const regular: ImportUnit[] = files
    .filter(file => !groupedIds.has(file.id) && isSupportedArchiveContract(toArchiveFile(file)))
    .map(file => ({ id: file.id, name: file.name, revision: file.revision, files: [file], contentType: file.contentType, kind: "file" }));
  const acceptedIds = new Set([...jpegs, ...regular.flatMap(unit => unit.files)].map(file => file.id));
  return { units: [...regular, ...groups], excluded: files.filter(file => !acceptedIds.has(file.id)) };
}

function rowByNumber(rows: ArchiveSpreadsheetRow[], rowNumber: number | null) {
  return rowNumber == null ? null : rows.find(row => row.rowNumber === rowNumber) ?? null;
}

function valueString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function valueYear(value: unknown) {
  const match = String(value ?? "").match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function signalsFromExtracted(extracted: Record<string, unknown>): ArchiveFileSignals {
  return {
    title: valueString(extracted.workTitle ?? extracted.title),
    rightsHolderName: valueString(extracted.rightsHolderName),
    producerName: valueString(extracted.producerName ?? extracted.employerName),
    year: valueYear(extracted.premiereYear ?? extracted.productionYear ?? extracted.year),
  };
}

async function downloadUnit(token: string, unit: ImportUnit) {
  if (unit.kind === "jpeg_group") {
    const pages = [];
    for (const file of unit.files) pages.push({ fileName: file.name, bytes: await downloadProviderFile("google_drive", token, file) });
    const texts = await ocrArchiveJpegPagesLocally(pages);
    if (!jpegGroupContentIsConsistent(texts)) throw new Error("JPG-siderne ser ikke ud til at høre til samme kontrakt");
    const buffer = await buildSearchableJpegPdf(pages.map((page, index) => ({ bytes: page.bytes, ocrText: texts[index] })));
    return { buffer, localText: texts.join("\n\n") };
  }
  const file = unit.files[0];
  const buffer = await downloadProviderFile("google_drive", token, file);
  const extension = file.name.split(".").pop()?.toLowerCase();
  const isPdf = extension === "pdf" || file.contentType === "application/pdf";
  const isWord = ["doc", "docx"].includes(extension ?? "")
    || file.contentType === "application/msword"
    || file.contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const isText = extension === "txt" || file.contentType === "text/plain";
  const localText = isPdf ? await extractPdfText(buffer)
    : isWord ? await extractWordText(buffer, file.name)
      : isText ? buffer.toString("utf8") : "";
  return { buffer, localText };
}

async function validateActor(db: ReturnType<typeof createServiceClient>, options: Options) {
  const [{ data: org }, { data: role }, { data: connection, error }] = await Promise.all([
    db.from("organisations").select("id,name").eq("id", options.orgId).maybeSingle(),
    db.from("user_org_roles").select("role").eq("user_id", options.actorUserId).eq("org_id", options.orgId).in("role", ["superadmin", "admin", "org-admin"]).limit(1).maybeSingle(),
    db.from("import_connections").select("id,org_id,provider,credentials_encrypted,status,connection_kind").eq("id", options.connectionId).eq("org_id", options.orgId).maybeSingle(),
  ]);
  if (!org) throw new Error("Organisationen blev ikke fundet");
  if (!role) throw new Error("Aktøren har ikke en godkendt administratorrolle i organisationen");
  if (error || !connection || connection.provider !== "google_drive" || connection.status !== "connected" || connection.connection_kind !== "organisation") throw new Error("En aktiv Google Drive-administratorforbindelse blev ikke fundet");
  return { org, role: role.role as string, connection };
}

async function createBatch(db: ReturnType<typeof createServiceClient>, options: Options, discoveredCount: number) {
  const { data, error } = await db.from("contract_import_batches").insert({
    org_id: options.orgId, created_by: options.actorUserId, source: "google_drive",
    connection_id: options.connectionId, status: "processing", discovered_count: discoveredCount,
  }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Importbatchen kunne ikke oprettes");
  return data.id as string;
}

async function reportExistingBatch(db: ReturnType<typeof createServiceClient>, options: Options) {
  const batchId = options.batchId!;
  const [{ data: batch }, { data: items, error }] = await Promise.all([
    db.from("contract_import_batches").select("id,status,discovered_count,uploaded_count,duplicate_count,completed_count,failed_count,started_at,completed_at").eq("id", batchId).eq("org_id", options.orgId).maybeSingle(),
    db.from("contract_import_items").select("id,original_file_name,status,contract_id,owner_match_score,work_match_score,error_code").eq("batch_id", batchId).eq("org_id", options.orgId).order("created_at"),
  ]);
  if (error || !batch) throw new Error(error?.message ?? "Importbatchen blev ikke fundet");
  await saveReport(options.reportPath, {
    generatedAt: new Date().toISOString(), mode: "report", batch,
    items: (items ?? []).map(item => ({
      reference: safeReference(item.id), fileName: item.original_file_name, status: item.status,
      contractId: item.contract_id, ownerMatchScore: item.owner_match_score,
      workMatchScore: item.work_match_score, errorCode: item.error_code,
    })),
  });
  return { batchId, reportPath: options.reportPath };
}

async function updatePostAnalysis(db: ReturnType<typeof createServiceClient>, input: {
  options: Options;
  itemId: string;
  contractId: string;
  rows: ArchiveSpreadsheetRow[];
  unit: ImportUnit;
  initialRow: ArchiveSpreadsheetRow | null;
  localText: string;
}) {
  const { data: validation } = await db.from("contract_validations").select("extracted_data").eq("contract_id", input.contractId).maybeSingle();
  if (!validation) return { pending: true as const };
  const extracted = (validation.extracted_data ?? {}) as Record<string, unknown>;
  const candidateFile = toArchiveFile({ ...input.unit.files[0], id: input.unit.id, name: input.unit.name });
  const match = input.initialRow ? null : matchArchiveRows([candidateFile], input.rows, { [input.unit.id]: signalsFromExtracted(extracted) })[0];
  const row = input.initialRow ?? rowByNumber(input.rows, match?.automatic ? match.rowNumber : null);
  const merged = applySpreadsheetFallback(extracted, row);
  const contacts = extractLocalContactData(input.localText);
  const identity = chooseArchiveIdentity({
    aiName: extracted.rightsHolderName, sheetName: row?.name,
    localEmail: contacts.email, sheetEmail: row?.email,
  });
  const owner = await resolveArchiveRightsHolder(db, {
    orgId: input.options.orgId, name: identity.name, email: identity.email,
    phone: contacts.phone, address: contacts.address, allowCreateNonMember: true,
  });
  const work = await resolveArchiveWork(db, {
    orgId: input.options.orgId,
    // The safely matched archive title is the preferred search title. The
    // contract title remains an alias/working title; DFI/TMDb remains final.
    title: row?.title ?? valueString(merged.workTitle ?? merged.title),
    alternativeTitle: valueString(extracted.workTitle ?? extracted.title),
    year: valueYear(merged.premiereYear ?? merged.productionYear ?? merged.year) ?? row?.premiereYear ?? null,
    type: valueString(merged.productionType ?? merged.workType) ?? row?.productionType ?? null,
    contractDate: valueString(merged.contractDate), rightsHolderId: owner.id,
    allowExternalCreate: true,
  });
  const development = detectDevelopmentContract(input.localText);
  if (development.isDevelopmentContract) merged.isDevelopmentContract = true;
  const contractTitle = valueString(extracted.workTitle ?? extracted.title);
  if (row?.title && contractTitle && row.title !== contractTitle) merged.archiveWorkingTitle = contractTitle;
  const validationUpdate = await db.from("contract_validations").update({
    extracted_data: merged,
    has_credit_clause: Boolean(merged.hasCreditClause || merged.creditedRoles || merged.creditedFunction),
  }).eq("contract_id", input.contractId);
  if (validationUpdate.error) throw new Error(validationUpdate.error.message);
  const contractUpdate: Record<string, unknown> = {
    status: "kladde", archive_received_at: normalizeArchiveDate(row?.archiveDate ?? null),
    ...(owner.id ? { rights_holder_id: owner.id } : {}),
    ...(work.id ? { work_id: work.id } : {}),
  };
  if (row?.title && contractTitle && row.title !== contractTitle) contractUpdate.working_title = contractTitle;
  const updatedContract = await db.from("contracts").update(contractUpdate).eq("id", input.contractId).eq("org_id", input.options.orgId);
  if (updatedContract.error) throw new Error(updatedContract.error.message);
  const employerNames = extractedProductionCompanyNames(merged);
  if (row?.productionCompany) employerNames.push(row.productionCompany);
  const employers = await matchArchiveEmployers(db, employerNames);
  await attachArchiveEmployers(db, { orgId: input.options.orgId, contractId: input.contractId, workId: work.id, matches: employers });
  if (owner.id && work.id) {
    const assignment = await db.from("work_assignments").upsert({
      org_id: input.options.orgId, work_id: work.id, rights_holder_id: owner.id,
      role: normalizeArchiveCredit(row?.credit ?? null) ?? valueString(merged.creditedFunction) ?? "Klipper",
      contract_id: input.contractId,
    }, { onConflict: "work_id,rights_holder_id,role" });
    if (assignment.error) throw new Error(assignment.error.message);
  }
  const { data: linkedWork } = work.id ? await db.from("works").select("type").eq("id", work.id).maybeSingle() : { data: null };
  const status = !owner.id ? "missing_owner" : !work.id ? "missing_work"
    : String(linkedWork?.type ?? "").includes("serie") ? "awaiting_episode_confirmation" : "ready_for_review";
  const itemUpdate = await db.from("contract_import_items").update({
    status, owner_match_score: owner.score, work_match_score: work.score,
    owner_match_evidence: [{ signal: owner.reason, points: owner.score ?? 0 }],
    work_match_evidence: [{ signal: work.source, points: work.score ?? 0 }],
    match_version: "archive-one-off-v1", error_code: null, error_message: null,
    updated_at: new Date().toISOString(),
  }).eq("id", input.itemId);
  if (itemUpdate.error) throw new Error(itemUpdate.error.message);
  return { pending: false as const, row, owner, work, status };
}

async function loadArchive(db: ReturnType<typeof createServiceClient>, options: Options, encryptedCredentials: string) {
  const { token, files } = await listProviderFiles({
    provider: "google_drive", encryptedCredentials, folderId: options.folderId,
    recursive: true, connectionKind: "organisation",
  });
  const spreadsheet = await exportGoogleSpreadsheet(token, options.spreadsheetId);
  const rows = await parseArchiveSpreadsheet(spreadsheet);
  const { units: allUnits, excluded } = buildArchiveImportUnits(files);
  return { token, files, rows, units: options.limit ? allUnits.slice(0, options.limit) : allUnits, excluded };
}

async function runDryRun(options: Options, orgName: string, archive: Awaited<ReturnType<typeof loadArchive>>) {
  const initialMatches = matchArchiveRows(archive.units.map(unit => toArchiveFile({ ...unit.files[0], id: unit.id, name: unit.name })), archive.rows);
  const obviousNonContracts = archive.excluded.filter(file => isObviousNonContract(file.name));
  const unknownExcluded = archive.excluded.filter(file => !isObviousNonContract(file.name));
  await saveReport(options.reportPath, {
    generatedAt: new Date().toISOString(), mode: options.mode, organisation: orgName,
    counts: {
      driveFiles: archive.files.length, importUnits: archive.units.length,
      jpegGroups: archive.units.filter(unit => unit.kind === "jpeg_group").length,
      spreadsheetRows: archive.rows.length,
      automaticSpreadsheetMatches: initialMatches.filter(match => match.automatic).length,
      obviousNonContracts: obviousNonContracts.length, excludedForManualReview: unknownExcluded.length,
    },
    candidates: archive.units.map((unit, index) => ({
      reference: safeReference(unit.id), fileName: unit.name, kind: unit.kind,
      pageCount: unit.files.length, spreadsheetRow: initialMatches[index]?.rowNumber ?? null,
      spreadsheetScore: initialMatches[index]?.score ?? null,
    })),
    excluded: unknownExcluded.map(file => ({ reference: safeReference(file.id), fileName: file.name })),
  });
  return { mode: options.mode, importUnits: archive.units.length, reportPath: options.reportPath };
}

async function runExecute(db: ReturnType<typeof createServiceClient>, options: Options, role: string, archive: Awaited<ReturnType<typeof loadArchive>>) {
  const batchId = await createBatch(db, options, archive.units.length);
  const matches = matchArchiveRows(archive.units.map(unit => toArchiveFile({ ...unit.files[0], id: unit.id, name: unit.name })), archive.rows);
  const report: SafeItemReport[] = [];
  for (const [index, unit] of archive.units.entries()) {
    try {
      const downloaded = await downloadUnit(archive.token, unit);
      const row = rowByNumber(archive.rows, matches[index]?.automatic ? matches[index].rowNumber : null);
      const contact = extractLocalContactData(downloaded.localText);
      const identity = chooseArchiveIdentity({ sheetName: row?.name, localEmail: contact.email, sheetEmail: row?.email });
      const owner = await resolveArchiveRightsHolder(db, {
        orgId: options.orgId, name: identity.name, email: identity.email,
        phone: contact.phone, address: contact.address, allowCreateNonMember: false,
      });
      const work = await resolveArchiveWork(db, {
        orgId: options.orgId, title: row?.title ?? null, year: row?.premiereYear ?? null,
        type: row?.productionType ?? null, rightsHolderId: owner.id, allowExternalCreate: false,
      });
      const intake = await intakeContractFile({
        batchId, actor: { userId: options.actorUserId, orgId: options.orgId, role },
        rightsHolderId: owner.id, workId: work.id,
        file: {
          name: archiveImportFileName({ name: unit.name, contentType: unit.contentType }),
          contentType: unit.contentType, buffer: downloaded.buffer,
          clientToken: randomUUID(), providerFileId: unit.id, providerRevision: unit.revision,
        },
      });
      if (!intake.ok || !intake.item) throw new Error(intake.ok ? "Importelementet mangler" : intake.error);
      report.push({
        reference: safeReference(unit.id), fileName: unit.name,
        status: intake.duplicate ? "duplicate" : "queued", contractId: intake.item.contract_id,
        spreadsheetRow: row?.rowNumber ?? null,
      });
    } catch (error) {
      report.push({ reference: safeReference(unit.id), fileName: unit.name, status: "error", error: safeError(error) });
    }
  }
  await saveReport(options.reportPath, {
    generatedAt: new Date().toISOString(), mode: options.mode, batchId,
    nextStep: "Lad appens eksisterende kontrakt-worker behandle køen, og kør derefter resume med samme batch-id.",
    counts: { requested: archive.units.length, queued: report.filter(item => item.status === "queued").length, duplicates: report.filter(item => item.status === "duplicate").length, errors: report.filter(item => item.status === "error").length },
    items: report,
  });
  await recordAuditEvent({
    context: { actorUserId: options.actorUserId, actorOrgId: options.orgId, actorRole: role, source: "import", correlationId: batchId, mode: "summary" },
    action: "import", entityType: "contract_import_batches", entityId: batchId,
    entityLabel: "Engangsimport af kontraktarkiv", orgIds: [options.orgId],
    metadata: {
      queuedCount: report.filter(item => item.status === "queued").length,
      duplicateCount: report.filter(item => item.status === "duplicate").length,
      failedCount: report.filter(item => item.status === "error").length,
    },
  });
  return { mode: options.mode, batchId, queued: report.filter(item => item.status === "queued").length, reportPath: options.reportPath };
}

async function runResume(db: ReturnType<typeof createServiceClient>, options: Options, archive: Awaited<ReturnType<typeof loadArchive>>) {
  const batchId = options.batchId!;
  const { data: items, error } = await db.from("contract_import_items")
    .select("id,contract_id,status,provider_file_id,provider_revision,original_file_name")
    .eq("batch_id", batchId).eq("org_id", options.orgId).order("created_at");
  if (error) throw new Error(error.message);
  const initialMatches = matchArchiveRows(archive.units.map(unit => toArchiveFile({ ...unit.files[0], id: unit.id, name: unit.name })), archive.rows);
  const unitById = new Map(archive.units.map((unit, index) => [unit.id, { unit, index }]));
  const report: SafeItemReport[] = [];
  for (const item of items ?? []) {
    const entry = unitById.get(item.provider_file_id ?? "");
    if (!entry || !item.contract_id) {
      report.push({ reference: safeReference(item.id), fileName: item.original_file_name, status: item.status });
      continue;
    }
    if (["queued", "analysing", "matching", "uploaded"].includes(item.status)) {
      report.push({ reference: safeReference(entry.unit.id), fileName: entry.unit.name, status: "awaiting_analysis", contractId: item.contract_id });
      continue;
    }
    try {
      const downloaded = await downloadUnit(archive.token, entry.unit);
      const row = rowByNumber(archive.rows, initialMatches[entry.index]?.automatic ? initialMatches[entry.index].rowNumber : null);
      const updated = await updatePostAnalysis(db, {
        options, itemId: item.id, contractId: item.contract_id, rows: archive.rows,
        unit: entry.unit, initialRow: row, localText: downloaded.localText,
      });
      if (updated.pending) {
        report.push({ reference: safeReference(entry.unit.id), fileName: entry.unit.name, status: "awaiting_analysis", contractId: item.contract_id });
      } else {
        report.push({
          reference: safeReference(entry.unit.id), fileName: entry.unit.name, status: updated.status,
          contractId: item.contract_id, spreadsheetRow: updated.row?.rowNumber ?? null,
          owner: safeIdentitySummary(updated.owner),
          work: { id: updated.work.id, score: updated.work.score, created: updated.work.created, source: updated.work.source },
        });
      }
    } catch (resumeError) {
      await db.from("contract_import_items").update({
        status: "retryable_error", error_code: "archive_postprocess",
        error_message: "Arkivets supplerende data kunne ikke behandles",
      }).eq("id", item.id);
      report.push({ reference: safeReference(entry.unit.id), fileName: entry.unit.name, status: "postprocess_error", contractId: item.contract_id, error: safeError(resumeError) });
    }
  }
  await saveReport(options.reportPath, {
    generatedAt: new Date().toISOString(), mode: options.mode, batchId,
    counts: {
      items: report.length,
      awaitingAnalysis: report.filter(item => item.status === "awaiting_analysis").length,
      missingOwner: report.filter(item => item.status === "missing_owner").length,
      missingWork: report.filter(item => item.status === "missing_work").length,
      readyForReview: report.filter(item => item.status === "ready_for_review").length,
      awaitingEpisodes: report.filter(item => item.status === "awaiting_episode_confirmation").length,
      errors: report.filter(item => item.status.includes("error")).length,
    },
    items: report,
  });
  await recordAuditEvent({
    context: { actorUserId: options.actorUserId, actorOrgId: options.orgId, actorRole: "admin", source: "import", correlationId: batchId, mode: "summary" },
    action: "sync", entityType: "contract_import_batches", entityId: batchId,
    entityLabel: "Supplering af kontraktarkiv", orgIds: [options.orgId],
    metadata: {
      processedCount: report.filter(item => !["awaiting_analysis", "postprocess_error"].includes(item.status)).length,
      awaitingAnalysisCount: report.filter(item => item.status === "awaiting_analysis").length,
      failedCount: report.filter(item => item.status.includes("error")).length,
    },
  });
  return { mode: options.mode, batchId, awaitingAnalysis: report.filter(item => item.status === "awaiting_analysis").length, reportPath: options.reportPath };
}

async function main() {
  const options = parseArchiveImportOptions(process.argv.slice(2));
  const db = createServiceClient({ audit: {
    actorUserId: options.actorUserId, actorOrgId: options.orgId, actorRole: "admin",
    source: "import", correlationId: options.batchId ?? randomUUID(), mode: "summary",
  } });
  const access = await validateActor(db, options);
  if (options.mode === "report") {
    console.log(JSON.stringify(await reportExistingBatch(db, options)));
    return;
  }
  const archive = await loadArchive(db, options, access.connection.credentials_encrypted);
  const result = options.mode === "dry-run"
    ? await runDryRun(options, access.org.name, archive)
    : options.mode === "execute"
      ? await runExecute(db, options, access.role, archive)
      : await runResume(db, options, archive);
  console.log(JSON.stringify(result));
}

if (process.env.NODE_ENV !== "test") {
  main().catch(error => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
