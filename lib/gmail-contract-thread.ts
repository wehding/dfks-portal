import "server-only";

import { getGmailThread } from "@/lib/gmail-contract-client";
import { GMAIL_CONTRACT_MAILBOX, isGmailDraftMessage, parseGmailContractMessage } from "@/lib/gmail-contract-import-core";
import { createServiceClient } from "@/lib/supabase/service";
import { mapWithConcurrency, roundRobinByOrganisation } from "@/lib/gmail-contract-thread-core";

export type ContractReviewThreadMessage = {
  id: string;
  gmailMessageId: string;
  internetMessageId: string | null;
  subject: string | null;
  from: string | null;
  to: string[];
  cc: string[];
  receivedAt: string | null;
  body: string | null;
  direction: "incoming" | "outgoing";
};

export async function syncContractReviewThread(reviewId: string, orgId: string, options: { minimumAgeMs?: number } = {}) {
  const db = createServiceClient({ audit: { source: "import", actorOrgId: orgId } });
  const { data: review, error: reviewError } = await db.from("contract_reviews")
    .select("id,gmail_contract_message_id")
    .eq("id", reviewId).eq("org_id", orgId).neq("intake_status", "deleted").maybeSingle();
  if (reviewError) throw new Error(reviewError.message);
  if (!review?.gmail_contract_message_id) return { synced: false, messages: 0 };
  const { data: source, error: sourceError } = await db.from("gmail_contract_messages")
    .select("mailbox,gmail_thread_id,input_label_id,thread_synced_at")
    .eq("id", review.gmail_contract_message_id).eq("org_id", orgId).maybeSingle();
  if (sourceError) throw new Error(sourceError.message);
  if (!source?.gmail_thread_id) return { synced: false, messages: 0 };
  const minimumAgeMs = Math.max(0, options.minimumAgeMs ?? 0);
  if (minimumAgeMs && source.thread_synced_at && Date.now() - Date.parse(source.thread_synced_at) < minimumAgeMs) {
    return { synced: false, messages: 0, cached: true };
  }
  const thread = await getGmailThread(source.gmail_thread_id);
  const now = new Date().toISOString();
  const messages = (thread.messages ?? []).filter(message => !isGmailDraftMessage(message));
  for (const message of messages) {
    const parsed = parseGmailContractMessage(message);
    const { error } = await db.from("gmail_contract_messages").upsert({
      org_id: orgId, mailbox: source.mailbox, gmail_message_id: parsed.gmailMessageId,
      gmail_thread_id: source.gmail_thread_id, internet_message_id: parsed.internetMessageId,
      in_reply_to: parsed.inReplyTo, references_header: parsed.referencesHeader,
      subject: parsed.subject, from_address: parsed.fromAddress, to_addresses: parsed.toAddresses,
      cc_addresses: parsed.ccAddresses, received_at: parsed.receivedAt, body_text: parsed.bodyText,
      input_label_id: source.input_label_id, thread_synced_at: now, updated_at: now,
    }, { onConflict: "mailbox,gmail_message_id" });
    if (error) throw new Error(error.message);
  }
  await db.from("gmail_contract_messages").update({ thread_synced_at: now, updated_at: now })
    .eq("org_id", orgId).eq("mailbox", source.mailbox).eq("gmail_thread_id", source.gmail_thread_id);
  return { synced: true, messages: messages.length };
}

export async function getContractReviewThread(reviewId: string, orgId: string): Promise<ContractReviewThreadMessage[]> {
  const db = createServiceClient();
  const { data: review } = await db.from("contract_reviews").select("gmail_contract_message_id")
    .eq("id", reviewId).eq("org_id", orgId).maybeSingle();
  if (!review?.gmail_contract_message_id) return [];
  const { data: source } = await db.from("gmail_contract_messages").select("mailbox,gmail_thread_id")
    .eq("id", review.gmail_contract_message_id).eq("org_id", orgId).maybeSingle();
  if (!source?.gmail_thread_id) return [];
  const { data, error } = await db.from("gmail_contract_messages")
    .select("id,gmail_message_id,internet_message_id,subject,from_address,to_addresses,cc_addresses,received_at,body_text")
    .eq("org_id", orgId).eq("mailbox", source.mailbox).eq("gmail_thread_id", source.gmail_thread_id)
    .order("received_at", { ascending: true }).order("id", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(message => ({
    id: message.id, gmailMessageId: message.gmail_message_id, internetMessageId: message.internet_message_id,
    subject: message.subject, from: message.from_address, to: message.to_addresses ?? [], cc: message.cc_addresses ?? [],
    receivedAt: message.received_at, body: message.body_text,
    direction: (message.from_address ?? "").toLowerCase().includes(GMAIL_CONTRACT_MAILBOX) || (message.from_address ?? "").toLowerCase().includes(resolveAlias()) ? "outgoing" : "incoming",
  }));
}

function resolveAlias() {
  return (process.env.GOOGLE_GMAIL_CONTRACT_REVIEW_FROM ?? "kontrakt@danskfilmklipperselskab.dk").toLowerCase();
}

export async function syncOpenContractReviewThreads(limit = 100) {
  const db = createServiceClient();
  const capped = Math.max(1, Math.min(100, limit));
  const { data: openReviews, error: openReviewError } = await db.from("contract_reviews")
    .select("org_id")
    .not("gmail_contract_message_id", "is", null)
    .neq("status", "afsluttet")
    .neq("intake_status", "deleted")
    .limit(5_000);
  if (openReviewError) throw new Error(openReviewError.message);
  const orgIds = [...new Set((openReviews ?? []).map(review => review.org_id))];
  const sourceResults = await mapWithConcurrency(orgIds, 5, async orgId => {
    const { data, error } = await db.from("gmail_contract_messages")
      .select("id,org_id,mailbox,gmail_thread_id,thread_synced_at,received_at")
      .eq("org_id", orgId)
      .not("gmail_thread_id", "is", null)
      .order("thread_synced_at", { ascending: true, nullsFirst: true })
      .order("received_at", { ascending: true, nullsFirst: true })
      .limit(capped);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
  const sources = sourceResults.flatMap(result => result.status === "fulfilled" ? result.value : []);
  if (sourceResults.some(result => result.status === "rejected")) throw new Error("Gmail-trådkandidater kunne ikke hentes");
  const unique = new Map<string, { orgId: string; threadId: string; sourceIds: string[] }>();
  for (const source of sources ?? []) {
    const key = `${source.org_id}:${source.mailbox}:${source.gmail_thread_id}`;
    const existing = unique.get(key);
    if (existing) existing.sourceIds.push(source.id);
    else unique.set(key, { orgId: source.org_id, threadId: source.gmail_thread_id!, sourceIds: [source.id] });
  }
  const candidates = roundRobinByOrganisation([...unique.values()], capped);
  const sourceIds = candidates.flatMap(candidate => candidate.sourceIds);
  if (!sourceIds.length) return { attempted: 0, succeeded: 0, failed: 0 };
  const { data: reviews, error: reviewError } = await db.from("contract_reviews")
    .select("id,org_id,gmail_contract_message_id")
    .in("gmail_contract_message_id", sourceIds)
    .neq("status", "afsluttet")
    .neq("intake_status", "deleted");
  if (reviewError) throw new Error(reviewError.message);
  const bySource = new Map((reviews ?? []).map(review => [review.gmail_contract_message_id, review]));
  const work = candidates.flatMap(candidate => {
    const review = candidate.sourceIds.map(id => bySource.get(id)).find(Boolean);
    return review ? [{ reviewId: review.id, orgId: review.org_id }] : [];
  }).slice(0, capped);
  const results = await mapWithConcurrency(work, 5, item => syncContractReviewThread(item.reviewId, item.orgId));
  return { attempted: work.length, succeeded: results.filter(result => result.status === "fulfilled").length, failed: results.filter(result => result.status === "rejected").length };
}
