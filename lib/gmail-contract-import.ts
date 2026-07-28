import "server-only";

import { createHash } from "node:crypto";
import { analyseExistingContractReview } from "@/lib/contract-review-analysis";
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
  decodeBase64Url,
  extractEmailAddress,
  GMAIL_CONTRACT_INPUT_LABEL,
  GMAIL_CONTRACT_MAILBOX,
  GMAIL_CONTRACT_OUTPUT_LABEL,
  MAX_GMAIL_CONTRACT_BYTES,
  parseGmailContractMessage,
  safeGmailStorageName,
} from "@/lib/gmail-contract-import-core";
import { createServiceClient } from "@/lib/supabase/service";

type ImportState = {
  org_id: string;
  input_label_id: string | null;
  output_label_id: string | null;
  history_id: string | null;
};

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
    .select("history_id")
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
  return { mailbox: GMAIL_CONTRACT_MAILBOX, inputLabelId: input.id, outputLabelId: output.id, historyId: watch.historyId, expiration };
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

async function importMessage(messageId: string, state: ImportState): Promise<{ imported: number; skipped: number }> {
  const db = createServiceClient({ audit: { source: "import", actorOrgId: state.org_id } });
  const gmailMessage = await getGmailMessage(messageId);
  if (!gmailMessage.labelIds?.includes(state.input_label_id!)) return { imported: 0, skipped: 1 };
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
  for (const attachment of parsed.attachments) {
    const { data: existing } = await db.from("contract_reviews").select("id,ai_status")
      .eq("gmail_contract_message_id", source.id)
      .eq("gmail_attachment_id", attachment.attachmentId)
      .maybeSingle();
    const buffer = attachment.inlineData
      ? decodeBase64Url(attachment.inlineData)
      : await getGmailAttachment(messageId, attachment.attachmentId);
    if (buffer.byteLength > MAX_GMAIL_CONTRACT_BYTES) throw new Error(`Bilaget '${attachment.fileName}' er større end 25 MB.`);
    const senderEmail = extractEmailAddress(parsed.fromAddress);
    if (existing) {
      if (existing.ai_status !== "klar") {
        await analyseExistingContractReview({
          reviewId: existing.id,
          orgId: state.org_id,
          fileBuffer: buffer,
          fileName: attachment.fileName,
          memberName: parsed.fromAddress,
          memberEmail: senderEmail,
          emailReference: [parsed.subject ? `Emne: ${parsed.subject}` : null, parsed.bodyText].filter(Boolean).join("\n\n"),
          source: "import",
        });
      }
      completed += 1;
      continue;
    }

    const digest = createHash("sha256").update(buffer).digest("hex").slice(0, 20);
    const storagePath = `${state.org_id}/gmail/${messageId}/${digest}_${safeGmailStorageName(attachment.fileName)}`;
    const { error: uploadError } = await db.storage.from("contract-reviews").upload(storagePath, buffer, {
      contentType: attachment.mimeType,
      upsert: false,
    });
    if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) throw new Error(uploadError.message);

    const { data: review, error: reviewError } = await db.from("contract_reviews").insert({
      org_id: state.org_id,
      member_name: parsed.fromAddress ?? senderEmail ?? "Mailimport",
      member_email: senderEmail,
      ai_result: {},
      status: "afventer",
      ai_status: "analyserer",
      file_name: attachment.fileName,
      file_size_bytes: buffer.byteLength,
      storage_path: storagePath,
      notes: parsed.subject ? `Importeret fra mail: ${parsed.subject}` : "Importeret fra mail",
      gmail_contract_message_id: source.id,
      gmail_attachment_id: attachment.attachmentId,
    }).select("id").single();
    if (reviewError || !review) {
      if (/duplicate|unique/i.test(reviewError?.message ?? "")) {
        completed += 1;
        continue;
      }
      if (!uploadError) await db.storage.from("contract-reviews").remove([storagePath]);
      throw new Error(reviewError?.message ?? "Kontraktgennemgangen kunne ikke oprettes.");
    }
    try {
      await analyseExistingContractReview({
        reviewId: review.id,
        orgId: state.org_id,
        fileBuffer: buffer,
        fileName: attachment.fileName,
        memberName: parsed.fromAddress,
        memberEmail: senderEmail,
        emailReference: [parsed.subject ? `Emne: ${parsed.subject}` : null, parsed.bodyText].filter(Boolean).join("\n\n"),
        source: "import",
      });
    } catch (error) {
      await db.from("contract_reviews").update({ ai_status: "fejl" }).eq("id", review.id).eq("org_id", state.org_id);
      throw error;
    }
    imported += 1;
    completed += 1;
  }

  if (parsed.attachments.length > 0 && completed === parsed.attachments.length && !source.output_label_applied_at) {
    await addGmailOutputLabel(messageId, state.output_label_id!);
    await db.from("gmail_contract_messages").update({ output_label_applied_at: now, updated_at: now }).eq("id", source.id).eq("org_id", state.org_id);
  }
  return { imported, skipped: parsed.attachments.length === 0 ? 1 : 0 };
}

export async function syncGmailContractMailbox(notificationHistoryId?: string) {
  const state = await loadState();
  const db = createServiceClient({ audit: { source: "import", actorOrgId: state.org_id } });
  let messageIds: string[];
  let latestHistoryId = notificationHistoryId ?? state.history_id!;
  try {
    if (!state.history_id) throw new GmailHistoryExpiredError();
    const history = await listGmailHistory(state.history_id, state.input_label_id!);
    messageIds = history.messageIds;
    latestHistoryId = history.historyId;
  } catch (error) {
    if (!(error instanceof GmailHistoryExpiredError)) throw error;
    messageIds = await listMessagesForLabel(state.input_label_id!);
  }

  let imported = 0;
  let skipped = 0;
  try {
    for (const messageId of messageIds) {
      const result = await importMessage(messageId, state);
      imported += result.imported;
      skipped += result.skipped;
    }
    await db.from("gmail_contract_import_state").update({
      history_id: latestHistoryId,
      last_synced_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq("org_id", state.org_id);
    return { imported, skipped, messages: messageIds.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt Gmail-importfejl";
    await db.from("gmail_contract_import_state").update({ last_error: message.slice(0, 1000), updated_at: new Date().toISOString() }).eq("org_id", state.org_id);
    throw error;
  }
}
