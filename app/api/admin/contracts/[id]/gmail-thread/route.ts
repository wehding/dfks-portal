import { NextRequest, NextResponse } from "next/server";
import { requireStaffModuleApi } from "@/lib/api-auth";
import { getContractReviewThread, syncContractReviewThread } from "@/lib/gmail-contract-thread";
import { auditRequestContext } from "@/lib/audit-access-server";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffModuleApi("contract_reviews", "read");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const db = createServiceClient();
    const { data: review } = await db.from("contract_reviews").select("member_id")
      .eq("id", id).eq("org_id", auth.orgId).neq("intake_status", "deleted").maybeSingle();
    if (!review) return NextResponse.json({ error: "Sagen blev ikke fundet." }, { status: 404 });
    const result = await syncContractReviewThread(id, auth.orgId);
    const messages = await getContractReviewThread(id, auth.orgId);
    await recordAuditEvent({
      context: auditRequestContext(request, { userId: auth.userId, orgId: auth.orgId, role: auth.role }, "admin", "admin.contract-reviews.gmail-thread"),
      action: "sync",
      entityType: "contract_reviews",
      entityId: id,
      entityLabel: "Gmail-tråd til kontraktgennemgang",
      targetMemberUuid: review.member_id,
      purposeCode: "contract_review_assistance",
      legalBasis: "GDPR Art. 6(1)(b) og 6(1)(f), Art. 9(2)(d)",
      dataCategories: ["contract_data", "contact_data", "communication_data"],
      orgIds: [auth.orgId],
      metadata: { synced: result.synced, messageCount: messages.length },
    });
    return NextResponse.json({ result, messages }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Mailtråden kunne ikke opdateres lige nu." }, { status: 502 });
  }
}
