import { NextRequest, NextResponse } from "next/server";
import { requireStaffModuleApi } from "@/lib/api-auth";
import { getContractReviewThread, syncContractReviewThread } from "@/lib/gmail-contract-thread";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffModuleApi("contract_reviews", "read");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const result = await syncContractReviewThread(id, auth.orgId);
    const messages = await getContractReviewThread(id, auth.orgId);
    return NextResponse.json({ result, messages }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Mailtråden kunne ikke opdateres lige nu." }, { status: 502 });
  }
}
