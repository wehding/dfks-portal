import { NextRequest, NextResponse } from "next/server";
import { requireStaffModuleApi } from "@/lib/api-auth";
import { refreshContractReviewMailSuggestion } from "@/lib/contract-review-mail-suggestion";
import { auditRequestContext } from "@/lib/audit-access-server";
import { recordAuditEvent } from "@/lib/audit-log-server";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffModuleApi("contract_reviews", "write");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await request.json().catch(() => null) as { expectedVersion?: unknown } | null;
  if (!Number.isInteger(body?.expectedVersion) || Number(body?.expectedVersion) < 0) {
    return NextResponse.json({ error: "Mailudkastets version mangler." }, { status: 400 });
  }
  try {
    const db = createServiceClient();
    const { data: review } = await db.from("contract_reviews").select("member_id")
      .eq("id", id).eq("org_id", auth.orgId).neq("intake_status", "deleted").maybeSingle();
    if (!review) return NextResponse.json({ error: "Sagen blev ikke fundet." }, { status: 404 });
    const data = await refreshContractReviewMailSuggestion({ reviewId: id, orgId: auth.orgId, actorUserId: auth.userId, expectedVersion: Number(body!.expectedVersion) });
    await recordAuditEvent({
      context: auditRequestContext(request, { userId: auth.userId, orgId: auth.orgId, role: auth.role }, "admin", "admin.contract-reviews.mail-suggestion"),
      action: "ai_analysis",
      entityType: "contract_reviews",
      entityId: id,
      entityLabel: "AI-mailforslag til kontraktgennemgang",
      targetMemberUuid: review.member_id,
      purposeCode: "contract_review_assistance",
      legalBasis: "GDPR Art. 6(1)(b) og 6(1)(f), Art. 9(2)(d)",
      dataCategories: ["contract_data", "contact_data", "communication_data", "ai_analysis"],
      orgIds: [auth.orgId],
      metadata: { suggestionUpdated: true },
    });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mailforslaget kunne ikke opdateres.";
    const conflict = /ændret|overskrevet/i.test(message);
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 500 });
  }
}
