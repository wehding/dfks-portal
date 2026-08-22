import { NextRequest, NextResponse } from "next/server";
import { requireStaffModuleApi } from "@/lib/api-auth";
import { refreshContractReviewMailSuggestion } from "@/lib/contract-review-mail-suggestion";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffModuleApi("contract_reviews", "write");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await request.json().catch(() => null) as { expectedVersion?: unknown } | null;
  if (!Number.isInteger(body?.expectedVersion) || Number(body?.expectedVersion) < 0) {
    return NextResponse.json({ error: "Mailudkastets version mangler." }, { status: 400 });
  }
  try {
    const data = await refreshContractReviewMailSuggestion({ reviewId: id, orgId: auth.orgId, actorUserId: auth.userId, expectedVersion: Number(body!.expectedVersion) });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mailforslaget kunne ikke opdateres.";
    const conflict = /ændret|overskrevet/i.test(message);
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 500 });
  }
}
