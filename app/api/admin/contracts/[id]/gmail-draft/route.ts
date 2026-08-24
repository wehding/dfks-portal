import { NextRequest, NextResponse } from "next/server";
import { requireStaffModuleApi } from "@/lib/api-auth";
import { normalizeReviewEmailAddress, normalizeReviewEmailAddresses, normalizeReviewMailHeader } from "@/lib/contract-review-email";
import { saveGmailContractReviewDraft } from "@/lib/gmail-contract-draft";
import { createServiceClient } from "@/lib/supabase/service";
import { auditRequestContext } from "@/lib/audit-access-server";
import { recordAuditEvent } from "@/lib/audit-log-server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffModuleApi("contract_reviews", "write");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  let locallySaved: Record<string, unknown> | null = null;
  try {
    const to = normalizeReviewEmailAddress(String(body?.to ?? ""));
    const cc = normalizeReviewEmailAddresses(body?.cc);
    const subject = normalizeReviewMailHeader(body?.subject, 500, "Emnet");
    const text = typeof body?.text === "string" && body.text.length <= 50_000 ? body.text.trim() : null;
    const expectedVersion = Number(body?.expectedVersion);
    if (!text || !Number.isInteger(expectedVersion) || expectedVersion < 0) throw new Error("Mailudkastet er ufuldstændigt.");
    const db = createServiceClient({ audit: { source: "admin", actorUserId: auth.userId, actorOrgId: auth.orgId } });
    const { data: review, error } = await db.from("contract_reviews")
      .select("member_id,gmail_contract_message_id,gmail_response_draft_id,response_draft_version")
      .eq("id", id).eq("org_id", auth.orgId).neq("intake_status", "deleted").maybeSingle();
    if (error || !review) return NextResponse.json({ error: "Sagen blev ikke fundet." }, { status: 404 });
    if (Number(review.response_draft_version) !== expectedVersion) return NextResponse.json({ error: "Mailudkastet er ændret. Genindlæs sagen." }, { status: 409 });
    if (!review.gmail_contract_message_id) throw new Error("Sagen er ikke knyttet til en Gmail-tråd.");
    const { data: source } = await db.from("gmail_contract_messages").select("mailbox,gmail_thread_id")
      .eq("id", review.gmail_contract_message_id).eq("org_id", auth.orgId).maybeSingle();
    if (!source?.gmail_thread_id) throw new Error("Gmail-tråden mangler.");
    const { data: latest } = await db.from("gmail_contract_messages")
      .select("internet_message_id,references_header")
      .eq("org_id", auth.orgId).eq("mailbox", source.mailbox).eq("gmail_thread_id", source.gmail_thread_id)
      .order("received_at", { ascending: false }).limit(1).maybeSingle();
    const savedAt = new Date().toISOString();
    const nextVersion = expectedVersion + 1;
    const { data: savedRow } = await db.from("contract_reviews").update({
      response_draft_to: to, response_draft_cc: cc, response_draft_subject: subject,
      response_draft: text, response_draft_updated_at: savedAt, response_draft_version: nextVersion,
    }).eq("id", id).eq("org_id", auth.orgId).eq("response_draft_version", expectedVersion).select().maybeSingle();
    if (!savedRow) return NextResponse.json({ error: "Mailudkastet blev ændret samtidig. Intet blev overskrevet." }, { status: 409 });
    locallySaved = savedRow;
    const references = [latest?.references_header, latest?.internet_message_id].filter(Boolean).join(" ") || null;
    const gmail = await saveGmailContractReviewDraft({ to, cc, subject, body: text, threadId: source.gmail_thread_id, inReplyTo: latest?.internet_message_id ?? null, references }, review.gmail_response_draft_id);
    const { data: updated } = await db.from("contract_reviews").update({
      gmail_response_draft_id: gmail.id, gmail_response_draft_message_id: gmail.message?.id ?? null,
      gmail_response_draft_updated_at: new Date().toISOString(),
    }).eq("id", id).eq("org_id", auth.orgId).select().maybeSingle();
    await recordAuditEvent({
      context: auditRequestContext(request, { userId: auth.userId, orgId: auth.orgId, role: auth.role }, "admin", "admin.contract-reviews.gmail-draft"),
      action: "update",
      entityType: "contract_reviews",
      entityId: id,
      entityLabel: "Gmail-kladde til kontraktgennemgang",
      targetMemberUuid: review.member_id,
      purposeCode: "contract_review_assistance",
      legalBasis: "GDPR Art. 6(1)(b) og 6(1)(f), Art. 9(2)(d)",
      dataCategories: ["contract_data", "contact_data", "communication_data"],
      orgIds: [auth.orgId],
      metadata: { gmailDraftCreated: true, recipientCount: 1 + cc.length },
    });
    return NextResponse.json({ data: updated ?? locallySaved, gmail: { draftId: gmail.id, url: "https://mail.google.com/mail/u/0/#drafts" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail-kladden kunne ikke oprettes.";
    return NextResponse.json({ error: message, data: locallySaved }, { status: locallySaved ? 502 : 400 });
  }
}
