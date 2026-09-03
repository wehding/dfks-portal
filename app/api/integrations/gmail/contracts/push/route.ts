import { after, NextRequest, NextResponse } from "next/server";
import { verifyPubSubPushToken } from "@/lib/gmail-contract-client";
import { parsePubSubNotificationBody } from "@/lib/gmail-contract-import-core";
import { getSafeGmailContractImportError, syncGmailContractMailbox } from "@/lib/gmail-contract-import";
import { ensureContractReviewWorkerRuns } from "@/lib/contract-review-intake";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

export const dynamic = "force-dynamic";
// Fallback-jobkørslen kan indeholde et fuldt AI-kald når workeren ikke kan startes.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    await verifyPubSubPushToken(req.headers.get("authorization"));
    const notification = parsePubSubNotificationBody(await req.json());
    const origin = req.nextUrl.origin;
    after(async () => {
      try {
        await syncGmailContractMailbox(notification.historyId);
        // Start altid workeren (kør inline hvis den ikke kan trigges). Det
        // reparerer ogsa tidligere modne jobs, hvis Gmail-synkroniseringen
        // ikke fandt en ny mail denne gang.
        await ensureContractReviewWorkerRuns(origin);
      } catch (error) {
        console.error("[gmail-contract-import] Synkronisering fejlede", getSafeGmailContractImportError(error));
      }
    });
    await recordSensitiveFlow({ actor: { role: "integration", source: "import" }, action: "job", component: "integrations.gmail.contracts-push", entityType: "contract_reviews", purposeCode: "contract_review_import", legalBasis: "GDPR Art. 6(1)(b)/(f) og 9(2)(d)", dataCategories: ["contract_data", "communication_data", "contact_data"] });
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) {
    console.warn("[gmail-contract-import] Pub/Sub-kald afvist", error instanceof Error ? error.message : "Ukendt fejl");
    return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 });
  }
}
