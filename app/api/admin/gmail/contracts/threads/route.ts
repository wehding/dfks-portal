import { NextRequest, NextResponse } from "next/server";
import { requireCronOrAdminApi } from "@/lib/api-auth";
import { syncOpenContractReviewThreads } from "@/lib/gmail-contract-thread";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = await requireCronOrAdminApi(request, ["superadmin"]);
  if (!auth.ok) return auth.response;
  try {
    const result = await syncOpenContractReviewThreads(100);
    await recordSensitiveFlow({ actor: { userId: "isCron" in auth ? null : auth.userId, orgId: "isCron" in auth ? null : auth.orgId, role: "isCron" in auth ? "integration" : auth.role, source: "isCron" in auth ? "cron" : "admin" }, action: "sync", component: "admin.gmail.contract-threads", entityType: "contract_reviews", orgIds: "isCron" in auth ? [] : [auth.orgId], purposeCode: "contract_review_communication", legalBasis: "GDPR Art. 6(1)(b)/(f) og 9(2)(d)", dataCategories: ["contract_data", "communication_data", "contact_data"] });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Gmail-trådene kunne ikke synkroniseres." }, { status: 500 });
  }
}
