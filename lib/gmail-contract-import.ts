import "server-only";

import { createHash } from "node:crypto";
import { createContractReviewIntake } from "@/lib/contract-review-intake";
import {
  addGmailOutputLabel,
  createGmailLabel,
  getGmailAttachment,
  getGmailMessage,
  GmailHistoryExpiredError,
  listGmailHistory,
  listGmailLabels,
  listMessagesForLabel,
  watchGmailContractLabel,
} from "@/lib/gmail-contract-client";
import {
  buildGmailAttachmentExternalSourceId,
  decodeBase64Url,
  extractEmailAddress,
  getGmailReconciliationRange,
  GMAIL_CONTRACT_INPUT_LABEL,
  GMAIL_CONTRACT_MAILBOX,
  GMAIL_CONTRACT_OUTPUT_LABEL,
  MAX_GMAIL_CONTRACT_BYTES,
  parseGmailContractMessage,
  processGmailMessageBatch,
  type GmailDateRange,
  type GmailImportBatchResult,
  type GmailImportMessageResult,
} from "@/lib/gmail-contract-import-core";
import { createServiceClient } from "@/lib/supabase/service";

type ImportState = {
  org_id: string;
  input_label_id: string | null;
  output_label_id: string | null;
  history_id: string | null;
};

type GmailSyncMode = "history" | "reconciliation";

function importConfigurationStatus() {
  const watchVariables = [
    "GOOGLE_GMAIL_CONTRACT_ORG_ID",
    "GOOGLE_GMAIL_CONTRACT_TOPIC",
    "GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  ] as const;
  const pushVariables = [
    "GOOGLE_PUBSUB_PUSH_AUDIENCE",
    "GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL",
  ] as const;
  const isMissing = (name: (typeof watchVariables)[number] | (typeof pushVariables)[number]) => !process.env[name]?.trim();
  const missingWatch = watchVariables.filter(isMissing);
  const missingPush = pushVariables.filter(isMissing);
  return {
    configured: missingWatch.length === 0 && missingPush.length === 0,
    watchConfigured: missingWatch.length === 0,
    pushConfigured: missingPush.length === 0,
    missing: [...missingWatch, ...missingPush],
  };
}

export function getGmailContractConfigurationStatus() {
  return importConfigurationStatus();
}

function requiredImportConfig() {
  const orgId = process.env.GOOGLE_GMAIL_CONTRACT_ORG_ID?.trim();
  const topicName = process.env.GOOGLE_GMAIL_CONTRACT_TOPIC?.trim();
  if (!orgId) throw new Error("GOOGLE_GMAIL_CONTRACT_ORG_ID mangler.");
  if (!topicName) throw new Error("GOOGLE_GMAIL_CONTRACT_TOPIC mangler.");
  return { orgId, topicName };
}

export async function configureGmailContractWatch() {
  const { orgId, topicName } = requiredImportConfig();
  const db = createServiceClient({ audit: { source: "import", actorOrgId: orgId } });
  const { data: org, error: orgError } = await db.from("organisations").select("id").eq("id", orgId).maybeSingle();
  if (orgError || !org) throw new Error("Den konfigurerede Gmail-organisation findes ikke.");

  const labels = await listGmailLabels();
  const input = labels.find(label => label.name.toLocaleLowerCase("da") === GMAIL_CONTRACT_INPUT_LABEL);
  if (!input) throw new Error(`Gmail-labelen '${GMAIL_CONTRACT_INPUT_LABEL}' findes ikke. Workspace-filteret skal oprette den først.`);
  let output = labels.find(label => label.name.toLocaleLowerCase("da") === GMAIL_CONTRACT_OUTPUT_LABEL);
  if (!output) output = await createGmailLabel(GMAIL_CONTRACT_OUTPUT_LABEL);

  const { data: previousState } = await db.from("gmail_contract_import_state")
    .select("history_id,last_synced_at")
    .eq("org_id", orgId)
    .maybeSingle();
  const watch = await watchGmailContractLabel(topicName, input.id);
  const expiration = /^\d+$/.test(watch.expiration) ? new Date(Number(watch.expiration)).toISOString() : null;
  const now = new Date().toISOString();
  const { error } = await db.from("gmail_contract_import_state").upsert({
    org_id: orgId,
    mailbox: GMAIL_CONTRACT_MAILBOX,
    input_label_id: input.id,
    output_label_id: output.id,
    // Bevar cursoren ved en watch-fornyelse, så mails siden sidste vellykkede
    // synkronisering ikke springes over. Kun første opsætning starter ved nu.
    history_id: previousState?.history_id ?? watch.historyId,
    watch_expiration: expiration,
    last_error: null,
    updated_at: now,
  }, { onConflict: "org_id" });
  if (error) throw new Error(error.message);
  return {
    mailbox: GMAIL_CONTRACT_MAILBOX,
    inputLabelId: input.id,
    outputLabelId: output.id,
    historyId: watch.historyId,
    expiration,
    initialized: !previousState,
  };
}

async function loadState(): Promise<ImportState> {
  const { orgId } = requiredImportConfig();
  const db = createServiceClient();
  const { data, error } = await db.from("gmail_contract_import_state")
    .select("org_id,input_label_id,output_label_id,history_id")
    .eq("org_id", orgId)
    .eq("mailbox", GMAIL_CONTRACT_MAILBOX)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.input_label_id || !data.output_label_id) throw new Error("Gmail-overvågningen er ikke konfigureret endnu.");
  return data as ImportState;
}

async function importMessage(messageId: string, state: ImportState): Promise<GmailImportMessageResult> {
  const db = createServiceClient({ audit: { source: "import", actorOrgId: state.org_id } });
  const gmailMessage = await getGmailMessage(messageId);
  if (!gmailMessage.labelIds?.includes(state.input_label_id!)) return { imported: 0, skipped: 1, alreadyKnown: 0 };
  const parsed = parseGmailContractMessage(gmailMessage);
  const now = new Date().toISOString();
  const { data: source, error: sourceError } = await db.from("gmail_contract_messages").upsert({
    org_id: state.org_id,
    mailbox: GMAIL_CONTRACT_MAILBOX,
    gmail_message_id: parsed.gmailMessageId,
    gmail_thread_id: parsed.gmailThreadId,
    internet_message_id: parsed.internetMessageId,
    in_reply_to: parsed.inReplyTo,
    references_header: parsed.referencesHeader,
    subject: parsed.subject,
    from_address: parsed.fromAddress,
    to_addresses: parsed.toAddresses,
    cc_addresses: parsed.ccAddresses,
    received_at: parsed.receivedAt,
    body_text: parsed.bodyText,
    input_label_id: state.input_label_id,
    updated_at: now,
  }, { onConflict: "mailbox,gmail_message_id" }).select("id,output_label_applied_at").single();
  if (sourceError || !source) throw new Error(sourceError?.message ?? "Mailreferencen kunne ikke gemmes.");

  let imported = 0;
  let completed = 0;
  let alreadyKnown = 0;
  for (const attachment of parsed.attachments) {
    const { data: existing, error: existingError } = await db.from("contract_reviews").select("id")
      .eq("gmail_contract_message_id", source.id)
      .eq("gmail_attachment_id", attachment.attachmentId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) {
      completed += 1;
      alreadyKnown += 1;
      continue;
    }
    const buffer = attachment.inlineData
      ? decodeBase64Url(attachment.inlineData)
      : await getGmailAttachment(messageId, attachment.attachmentId);
    if (buffer.byteLength > MAX_GMAIL_CONTRACT_BYTES) throw new Error(`Bilaget '${attachment.fileName}' er større end 25 MB.`);
    const fileHash = createHash("sha256").update(buffer).digest("hex");
    // Gmail kan returnere et nyt attachment-id for samme uændrede bilag ved
    // senere API-kald. Message-id + filhash er derfor den stabile identitet.
    const { data: existingFile, error: existingFileError } = await db.from("contract_reviews").select("id")
      .eq("gmail_contract_message_id", source.id)
      .eq("file_hash", fileHash)
      .is("soft_deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (existingFileError) throw new Error(existingFileError.message);
    if (existingFile) {
      completed += 1;
      alreadyKnown += 1;
      continue;
    }
    const senderEmail = extractEmailAddress(parsed.fromAddress);

    const intake = await createContractReviewIntake({
      orgId: state.org_id,
      source: "gmail",
      externalSourceId: buildGmailAttachmentExternalSourceId(messageId, fileHash),
      fileName: attachment.fileName,
      contentType: attachment.mimeType,
      fileBuffer: buffer,
      memberName: parsed.fromAddress ?? senderEmail ?? "Mailimport",
      memberEmail: senderEmail,
      metadata: {
        notes: parsed.subject ? `Importeret fra mail: ${parsed.subject}` : "Importeret fra mail",
        gmail_contract_message_id: source.id,
        gmail_attachment_id: attachment.attachmentId,
      },
    });
    if (!intake.duplicate) imported += 1;
    else alreadyKnown += 1;
    completed += 1;
  }

  if (parsed.attachments.length > 0 && completed === parsed.attachments.length && !source.output_label_applied_at) {
    await addGmailOutputLabel(messageId, state.output_label_id!);
    await db.from("gmail_contract_messages").update({ output_label_applied_at: now, updated_at: now }).eq("id", source.id).eq("org_id", state.org_id);
  }
  return { imported, skipped: parsed.attachments.length === 0 ? 1 : 0, alreadyKnown };
}

export function getSafeGmailContractImportError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/GOOGLE_.*mangler|ikke konfigureret|overvågningen er ikke konfigureret/i.test(message)) {
    return "Gmail-importen er ikke konfigureret.";
  }
  if (/25 MB/i.test(message)) return "Et Gmail-bilag overstiger filgrænsen på 25 MB.";
  if (/Google-servicekonto/i.test(message)) return "Google-servicekontoen er ikke konfigureret korrekt.";
  if (/Gmail API.*\((401|403)\)/i.test(message)) return "Gmail-adgangen blev afvist.";
  if (/storage|bucket/i.test(message)) return "Kontraktfilen kunne ikke gemmes.";
  return "En Gmail-kontrakt kunne ikke importeres.";
}

async function saveSyncResult(
  state: ImportState,
  result: GmailImportBatchResult,
  latestHistoryId?: string,
) {
  const db = createServiceClient({ audit: { source: "import", actorOrgId: state.org_id } });
  const now = new Date().toISOString();
  const update: Record<string, string | null> = {
    last_synced_at: now,
    last_error: result.failed > 0 ? `${result.failed} Gmail-mail(s) kunne ikke importeres.` : null,
    updated_at: now,
  };
  if (latestHistoryId) update.history_id = latestHistoryId;
  const { error } = await db.from("gmail_contract_import_state").update(update).eq("org_id", state.org_id);
  if (error) throw new Error(error.message);
}

async function importMessageIds(messageIds: string[], state: ImportState): Promise<GmailImportBatchResult> {
  return processGmailMessageBatch(
    messageIds,
    messageId => importMessage(messageId, state),
    (messageId, error) => {
      console.error("[gmail-contract-import] Mail kunne ikke importeres", {
        messageId,
        occurredAt: new Date().toISOString(),
        error: getSafeGmailContractImportError(error),
      });
    },
  );
}

async function reconcileRange(state: ImportState, range: GmailDateRange) {
  const messageIds = await listMessagesForLabel(state.input_label_id!, range);
  const result = await importMessageIds(messageIds, state);
  await saveSyncResult(state, result);
  return {
    ...result,
    mode: "reconciliation" as const,
    after: range.after.toISOString(),
    before: range.before.toISOString(),
  };
}

export async function reconcileGmailContractMessages(range: GmailDateRange) {
  return reconcileRange(await loadState(), range);
}

export async function reconcileRecentGmailContractMessages(now = new Date()) {
  return reconcileGmailContractMessages(getGmailReconciliationRange(now));
}

export async function getGmailContractImportStatus() {
  const configuration = importConfigurationStatus();
  const orgId = process.env.GOOGLE_GMAIL_CONTRACT_ORG_ID?.trim();
  if (!orgId) return { configuration, state: null };
  const db = createServiceClient();
  const { data, error } = await db.from("gmail_contract_import_state")
    .select("watch_expiration,last_synced_at,last_error,history_id,updated_at")
    .eq("org_id", orgId)
    .eq("mailbox", GMAIL_CONTRACT_MAILBOX)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    configuration,
    state: data ? {
      watchExpiration: data.watch_expiration,
      lastSyncedAt: data.last_synced_at,
      lastError: data.last_error,
      historyConfigured: Boolean(data.history_id),
      updatedAt: data.updated_at,
    } : null,
  };
}

export async function syncGmailContractMailbox(notificationHistoryId?: string) {
  let state = await loadState();
  let messageIds: string[];
  let latestHistoryId = notificationHistoryId ?? state.history_id!;
  let mode: GmailSyncMode = "history";
  try {
    if (!state.history_id) throw new GmailHistoryExpiredError();
    const history = await listGmailHistory(state.history_id, state.input_label_id!);
    messageIds = history.messageIds;
    latestHistoryId = history.historyId;
  } catch (error) {
    if (!(error instanceof GmailHistoryExpiredError)) throw error;
    // En udløbet cursor må aldrig udløse en ubegrænset historisk import.
    // Forny watchen og genkontrollér kun det faste, rullende tidsvindue.
    const watch = await configureGmailContractWatch();
    state = await loadState();
    messageIds = await listMessagesForLabel(state.input_label_id!, getGmailReconciliationRange());
    latestHistoryId = watch.historyId;
    mode = "reconciliation";
  }

  try {
    const result = await importMessageIds(messageIds, state);
    await saveSyncResult(state, result, latestHistoryId);
    return { ...result, mode };
  } catch (error) {
    const message = getSafeGmailContractImportError(error);
    const db = createServiceClient({ audit: { source: "import", actorOrgId: state.org_id } });
    await db.from("gmail_contract_import_state").update({ last_error: message.slice(0, 1000), updated_at: new Date().toISOString() }).eq("org_id", state.org_id);
    throw error;
  }
}
