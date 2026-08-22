import { NextRequest, NextResponse } from "next/server";
import { requireCronOrAdminApi } from "@/lib/api-auth";
import { syncOpenContractReviewThreads } from "@/lib/gmail-contract-thread";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = await requireCronOrAdminApi(request, ["superadmin"]);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await syncOpenContractReviewThreads(100));
  } catch {
    return NextResponse.json({ error: "Gmail-trådene kunne ikke synkroniseres." }, { status: 500 });
  }
}
